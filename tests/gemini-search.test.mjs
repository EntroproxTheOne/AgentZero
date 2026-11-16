import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wasGoogleSearchUsed } from '../electron/ai/searchGrounding.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quickLookSource = fs.readFileSync(path.join(repoRoot, 'electron', 'ai', 'quickLook.js'), 'utf8');

// Data residency: Google Search grounding runs outside the Mumbai region, so
// QuickLook only uses it when the user has turned web search on in Settings.
test('QuickLook searches the web only in web mode, and then sends no meeting or client data', () => {
  // Meeting answers never use Search.
  assert.match(quickLookSource, /useSearch:\s*false/);
  assert.match(quickLookSource, /if \(webSearch\) return answerFromWeb\(session, question\)/);
  const webBody = quickLookSource.slice(quickLookSource.indexOf('async function answerFromWeb'));
  assert.match(webBody, /useSearch:\s*true/);
  assert.doesNotMatch(webBody, /context\s*:/);
  assert.doesNotMatch(webBody, /transcript(Entries|Text)/);
  assert.doesNotMatch(webBody, /history/);
});

test('web search is off by default in the settings schema', () => {
  const dbSource = fs.readFileSync(path.join(repoRoot, 'electron', 'db.js'), 'utf8');
  assert.match(dbSource, /web_search_enabled INTEGER NOT NULL DEFAULT 0/);
});

test('Gemini client is pinned to Vertex AI in Mumbai, API key included', () => {
  const credentialsSource = fs.readFileSync(path.join(repoRoot, 'electron', 'credentials.js'), 'utf8');
  const geminiSource = fs.readFileSync(path.join(repoRoot, 'electron', 'ai', 'providers', 'gemini.js'), 'utf8');
  assert.match(credentialsSource, /VERTEX_LOCATION = 'asia-south1'/);
  assert.doesNotMatch(geminiSource, /vertexai:\s*false/);
  // Never the Gemini Developer API or the global Vertex host.
  assert.doesNotMatch(geminiSource, /generativelanguage\.googleapis\.com/);
  assert.doesNotMatch(geminiSource, /['"`]https:\/\/aiplatform\.googleapis\.com/);
  // The API-key client sets the regional host and project path explicitly.
  assert.match(geminiSource, /baseUrl: `https:\/\/\$\{location\}-aiplatform\.googleapis\.com\/`/);
  assert.match(geminiSource, /apiVersion: `v1\/projects\/\$\{encodeURIComponent\(project\)\}\/locations\/\$\{location\}`/);
});

test('detects actual web grounding in a Gemini response', () => {
  assert.equal(
    wasGoogleSearchUsed({
      candidates: [{
        groundingMetadata: {
          groundingChunks: [{ web: { uri: 'https://example.com/source' } }],
        },
      }],
    }),
    true,
  );
});

test('does not claim search was used when the response has no web grounding', () => {
  assert.equal(wasGoogleSearchUsed({ candidates: [{ groundingMetadata: {} }] }), false);
  assert.equal(
    wasGoogleSearchUsed({
      candidates: [{
        groundingMetadata: {
          groundingChunks: [{ maps: { title: 'A place' } }],
        },
      }],
    }),
    false,
  );
});
