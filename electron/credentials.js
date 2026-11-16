// User-editable credentials, encrypted at rest with Electron safeStorage
// (macOS Keychain / Windows DPAPI). Secrets never leave the main process:
// the renderer only ever sees a masked status.
import { app, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';

// All AI processing is pinned to Vertex AI in Mumbai. Not user-editable.
export const VERTEX_LOCATION = 'asia-south1';

let cache = null;
const listeners = new Set();

// Keys built into a client-specific build (written by CI from GitHub secrets,
// never committed). Order of use: Settings > built-in > .env (dev only).
// AGENTZERO_PROVISIONED_FILE lets a dev run point at a local copy for testing.
let provisionedCache;
function readProvisioned() {
  if (provisionedCache !== undefined) return provisionedCache;
  provisionedCache = {};
  const file = process.env.AGENTZERO_PROVISIONED_FILE
    || (app.isPackaged ? path.join(process.resourcesPath, 'provisioned.json') : null);
  try {
    if (file && fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const key of ['geminiApiKey', 'gcpProjectId', 'sarvamApiKey']) {
        if (typeof raw?.[key] === 'string' && raw[key].trim()) provisionedCache[key] = raw[key].trim();
      }
    }
  } catch (error) {
    console.error('[Credentials] Built-in key file is unreadable:', error.message);
  }
  return provisionedCache;
}

function sourceOf(storeValue, provisionedValue, envValue) {
  if (storeValue) return 'settings';
  if (provisionedValue) return 'built-in';
  if (envValue) return 'environment';
  return null;
}

function storePath() {
  return path.join(app.getPath('userData'), 'credentials.bin');
}

function readStore() {
  if (cache) return cache;
  cache = {};
  try {
    const file = storePath();
    if (fs.existsSync(file) && safeStorage.isEncryptionAvailable()) {
      cache = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
    }
  } catch (error) {
    console.error('[Credentials] Could not read stored credentials:', error.message);
    cache = {};
  }
  return cache;
}

function writeStore(next) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is not available on this machine.');
  }
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(storePath(), safeStorage.encryptString(JSON.stringify(next)), { mode: 0o600 });
  cache = next;
  for (const listener of listeners) listener();
}

export function onCredentialsChanged(listener) {
  listeners.add(listener);
}

function parseServiceAccount(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Service account key must be the JSON file downloaded from Google Cloud.');
  }
  if (parsed?.type !== 'service_account' || !parsed.client_email || !parsed.private_key) {
    throw new Error('That JSON is not a service account key (needs type, client_email and private_key).');
  }
  return parsed;
}

/** Dev fallback: GOOGLE_APPLICATION_CREDENTIALS pointing at a key file. */
function serviceAccountFromEnv() {
  const file = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!file) return null;
  try {
    return parseServiceAccount(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    console.warn('[Credentials] GOOGLE_APPLICATION_CREDENTIALS ignored:', error.message);
    return null;
  }
}

export function getVertexConfig() {
  const store = readStore();
  const serviceAccount = store.serviceAccountJson
    ? parseServiceAccount(store.serviceAccountJson)
    : serviceAccountFromEnv();
  const built = readProvisioned();
  const project = (store.gcpProjectId || built.gcpProjectId || process.env.GEMINI_PROJECT || serviceAccount?.project_id || '').trim();
  // A Vertex API key is used only against the Mumbai regional endpoint of this project.
  const apiKey = (store.geminiApiKey || built.geminiApiKey || process.env.GEMINI_API_KEY || '').trim();
  return { project, location: VERTEX_LOCATION, serviceAccount, apiKey };
}

export function getSarvamApiKey() {
  return (readStore().sarvamApiKey || readProvisioned().sarvamApiKey || process.env.SARVAM_API_KEY || '').trim();
}

export function getCredentialsStatus() {
  const store = readStore();
  let serviceAccountEmail = null;
  let serviceAccountSource = null;
  try {
    const { serviceAccount } = getVertexConfig();
    serviceAccountEmail = serviceAccount?.client_email ?? null;
    serviceAccountSource = store.serviceAccountJson ? 'settings' : serviceAccount ? 'environment' : null;
  } catch {
    serviceAccountSource = 'invalid';
  }
  const sarvamKey = getSarvamApiKey();
  const built = readProvisioned();
  const geminiKey = getVertexConfig().apiKey;
  return {
    geminiKeySet: Boolean(geminiKey),
    geminiKeyHint: geminiKey ? `…${geminiKey.slice(-4)}` : null,
    geminiKeySource: sourceOf(store.geminiApiKey, built.geminiApiKey, process.env.GEMINI_API_KEY),
    sarvamKeySource: sourceOf(store.sarvamApiKey, built.sarvamApiKey, process.env.SARVAM_API_KEY),
    builtInKeys: Object.keys(built).length > 0,
    location: VERTEX_LOCATION,
    gcpProjectId: getVertexConfig().project || null,
    serviceAccountEmail,
    serviceAccountSource,
    sarvamKeySet: Boolean(sarvamKey),
    sarvamKeyHint: sarvamKey ? `…${sarvamKey.slice(-4)}` : null,
    secureStorageAvailable: safeStorage.isEncryptionAvailable(),
  };
}

/**
 * Patch semantics: undefined = leave unchanged, '' = clear, value = set.
 */
export function updateCredentials({ gcpProjectId, serviceAccountJson, sarvamApiKey, geminiApiKey } = {}) {
  const next = { ...readStore() };
  if (typeof serviceAccountJson === 'string') {
    if (serviceAccountJson.trim()) {
      const parsed = parseServiceAccount(serviceAccountJson.trim());
      next.serviceAccountJson = serviceAccountJson.trim();
      if (!next.gcpProjectId && parsed.project_id) next.gcpProjectId = parsed.project_id;
    } else {
      delete next.serviceAccountJson;
    }
  }
  if (typeof gcpProjectId === 'string') {
    if (gcpProjectId.trim()) next.gcpProjectId = gcpProjectId.trim();
    else delete next.gcpProjectId;
  }
  if (typeof geminiApiKey === 'string') {
    if (geminiApiKey.trim()) next.geminiApiKey = geminiApiKey.trim();
    else delete next.geminiApiKey;
  }
  if (typeof sarvamApiKey === 'string') {
    if (sarvamApiKey.trim()) next.sarvamApiKey = sarvamApiKey.trim();
    else delete next.sarvamApiKey;
  }
  writeStore(next);
  return getCredentialsStatus();
}

