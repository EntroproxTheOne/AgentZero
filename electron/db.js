import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import crypto from 'crypto';

let db;

const SARVAM_SUPPORTED_LANGUAGES = [
  { code: 'hi-IN', label: 'Hindi' },
  { code: 'bn-IN', label: 'Bengali' },
  { code: 'kn-IN', label: 'Kannada' },
  { code: 'ml-IN', label: 'Malayalam' },
  { code: 'mr-IN', label: 'Marathi' },
  { code: 'od-IN', label: 'Odia' },
  { code: 'pa-IN', label: 'Punjabi' },
  { code: 'ta-IN', label: 'Tamil' },
  { code: 'te-IN', label: 'Telugu' },
  { code: 'en-IN', label: 'English (India)' },
  { code: 'gu-IN', label: 'Gujarati' },
  { code: 'as-IN', label: 'Assamese' },
  { code: 'ur-IN', label: 'Urdu' },
  { code: 'ne-IN', label: 'Nepali' },
  { code: 'kok-IN', label: 'Konkani' },
  { code: 'ks-IN', label: 'Kashmiri' },
  { code: 'sd-IN', label: 'Sindhi' },
  { code: 'sa-IN', label: 'Sanskrit' },
  { code: 'sat-IN', label: 'Santali' },
  { code: 'mni-IN', label: 'Manipuri' },
  { code: 'brx-IN', label: 'Bodo' },
  { code: 'mai-IN', label: 'Maithili' },
  { code: 'doi-IN', label: 'Dogri' },
];

export function initDB() {
  const dbPath = path.join(app.getPath('userData'), 'agentzero.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS Meetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      start_time_ms INTEGER,
      end_time_ms INTEGER,
      video_file_path TEXT,
      audio_file_path TEXT,
      transcript_path TEXT,
      artifacts_path TEXT
    );

    CREATE TABLE IF NOT EXISTS Transcripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id INTEGER,
      speaker_label TEXT,
      text TEXT,
      timestamp INTEGER,
      FOREIGN KEY (meeting_id) REFERENCES Meetings (id)
    );

    CREATE TABLE IF NOT EXISTS Users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      listener_name TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS AppSettings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      transcription_provider TEXT NOT NULL DEFAULT 'sarvam',
      india_mode_enabled INTEGER NOT NULL DEFAULT 0,
      screen_recording_enabled INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Simple migration: ensure transcript_path exists for existing DBs
  const columns = db.prepare("PRAGMA table_info(Meetings)").all();
  const hasTranscriptPath = columns.some(col => col.name === 'transcript_path');
  const hasArtifactsPath = columns.some(col => col.name === 'artifacts_path');
  const hasStartTimeMs = columns.some(col => col.name === 'start_time_ms');
  const hasEndTimeMs = columns.some(col => col.name === 'end_time_ms');
  if (!hasTranscriptPath) {
    db.prepare("ALTER TABLE Meetings ADD COLUMN transcript_path TEXT").run();
    console.log('[DB] Added transcript_path column to Meetings table');
  }
  if (!hasArtifactsPath) {
    db.prepare("ALTER TABLE Meetings ADD COLUMN artifacts_path TEXT").run();
    console.log('[DB] Added artifacts_path column to Meetings table');
  }
  if (!hasStartTimeMs) {
    db.prepare("ALTER TABLE Meetings ADD COLUMN start_time_ms INTEGER").run();
    console.log('[DB] Added start_time_ms column to Meetings table');
  }
  if (!hasEndTimeMs) {
    db.prepare("ALTER TABLE Meetings ADD COLUMN end_time_ms INTEGER").run();
    console.log('[DB] Added end_time_ms column to Meetings table');
  }

  const appSettingsColumns = db.prepare("PRAGMA table_info(AppSettings)").all();
  const hasTranscriptionProvider = appSettingsColumns.some((col) => col.name === 'transcription_provider');
  const hasIndiaModeEnabled = appSettingsColumns.some((col) => col.name === 'india_mode_enabled');
  const hasScreenRecordingEnabled = appSettingsColumns.some((col) => col.name === 'screen_recording_enabled');
  if (!hasTranscriptionProvider) {
    db.prepare("ALTER TABLE AppSettings ADD COLUMN transcription_provider TEXT NOT NULL DEFAULT 'sarvam'").run();
    console.log('[DB] Added transcription_provider column to AppSettings table');
  }
  if (!hasIndiaModeEnabled) {
    db.prepare("ALTER TABLE AppSettings ADD COLUMN india_mode_enabled INTEGER NOT NULL DEFAULT 0").run();
    console.log('[DB] Added india_mode_enabled column to AppSettings table');
  }
  if (!hasScreenRecordingEnabled) {
    db.prepare("ALTER TABLE AppSettings ADD COLUMN screen_recording_enabled INTEGER NOT NULL DEFAULT 0").run();
    console.log('[DB] Added screen_recording_enabled column to AppSettings table');
  }

  if (!appSettingsColumns.some((col) => col.name === 'show_cost_enabled')) {
    db.prepare('ALTER TABLE AppSettings ADD COLUMN show_cost_enabled INTEGER NOT NULL DEFAULT 1').run();
  }
  if (!appSettingsColumns.some((col) => col.name === 'web_search_enabled')) {
    // Off by default: Google Search grounding runs outside the Mumbai region.
    db.prepare('ALTER TABLE AppSettings ADD COLUMN web_search_enabled INTEGER NOT NULL DEFAULT 0').run();
  }
  if (!appSettingsColumns.some((col) => col.name === 'onboarding_done')) {
    db.prepare('ALTER TABLE AppSettings ADD COLUMN onboarding_done INTEGER NOT NULL DEFAULT 0').run();
  }
  if (!appSettingsColumns.some((col) => col.name === 'live_insights_enabled')) {
    db.prepare('ALTER TABLE AppSettings ADD COLUMN live_insights_enabled INTEGER NOT NULL DEFAULT 1').run();
  }
  if (!appSettingsColumns.some((col) => col.name === 'diarization_enabled')) {
    // Off by default: speaker detection costs ₹0.59/min vs ₹0.49/min.
    db.prepare('ALTER TABLE AppSettings ADD COLUMN diarization_enabled INTEGER NOT NULL DEFAULT 0').run();
  }

  // Meeting context, origin and resumable post-meeting processing.
  const meetingColumnsNow = db.prepare('PRAGMA table_info(Meetings)').all().map((col) => col.name);
  const addMeetingColumn = (name, ddl) => {
    if (!meetingColumnsNow.includes(name)) db.prepare(`ALTER TABLE Meetings ADD COLUMN ${name} ${ddl}`).run();
  };
  addMeetingColumn('client_id', 'INTEGER');
  addMeetingColumn('project_id', 'INTEGER');
  addMeetingColumn('agenda', 'TEXT');
  addMeetingColumn('source', "TEXT NOT NULL DEFAULT 'live'");
  // done | transcribing | analyzing | error
  addMeetingColumn('processing_state', "TEXT NOT NULL DEFAULT 'done'");
  addMeetingColumn('processing_note', 'TEXT');
  addMeetingColumn('batch_job_id', 'TEXT');
  addMeetingColumn('batch_diarize', 'INTEGER NOT NULL DEFAULT 0');

  db.exec(`
    CREATE TABLE IF NOT EXISTS Clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS Projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      client_id INTEGER REFERENCES Clients (id) ON DELETE SET NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ContextDocs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_type TEXT NOT NULL CHECK (owner_type IN ('client', 'project')),
      owner_id INTEGER NOT NULL,
      file_name TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_contextdocs_owner ON ContextDocs (owner_type, owner_id);
  `);

  const userColumns = db.prepare('PRAGMA table_info(Users)').all();
  if (!userColumns.some((col) => col.name === 'is_admin')) {
    db.prepare('ALTER TABLE Users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0').run();
  }
  if (!userColumns.some((col) => col.name === 'must_change_password')) {
    db.prepare('ALTER TABLE Users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0').run();
  }
  // Sign-in compares emails case-insensitively; store them lower-case too.
  db.prepare(`
    UPDATE Users SET email = lower(trim(email))
    WHERE email != lower(trim(email))
      AND NOT EXISTS (SELECT 1 FROM Users other WHERE other.id != Users.id AND lower(trim(other.email)) = lower(trim(Users.email)))
  `).run();

  db.prepare(`
    INSERT INTO AppSettings (id, transcription_provider, india_mode_enabled, screen_recording_enabled)
    VALUES (1, 'sarvam', 1, 0)
    ON CONFLICT(id) DO NOTHING
  `).run();

  ensureAnAdmin();

  console.log('Database initialized at', dbPath);
}

export function getDB() {
  return db;
}

/** Hash password with salt using PBKDF2 */
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

// ── Accounts ────────────────────────────────────────────────────────────────
// Local accounts only. No credentials are built in: on first launch the person
// installing the app creates the root admin account. Admins create/edit/delete
// accounts and grant admin; every user can edit or delete their own account.

const MIN_PASSWORD_LENGTH = 8;

function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

function publicUser(row) {
  return row ? {
    id: row.id,
    username: row.username,
    email: row.email,
    listener_name: row.listener_name,
    isAdmin: Boolean(row.is_admin),
    mustChangePassword: Boolean(row.must_change_password),
  } : null;
}

function setPassword(userId, password, { mustChange = false } = {}) {
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE Users SET password_hash = ?, salt = ?, must_change_password = ? WHERE id = ?')
    .run(hashPassword(password, salt), salt, mustChange ? 1 : 0, userId);
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
}

function validateEmail(email) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
}

function adminCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM Users WHERE is_admin = 1').get().n;
}

// Databases from older builds have accounts but no admin: promote the oldest.
function ensureAnAdmin() {
  if (adminCount() > 0) return;
  const oldest = db.prepare('SELECT id FROM Users ORDER BY created_at LIMIT 1').get();
  if (oldest) db.prepare('UPDATE Users SET is_admin = 1 WHERE id = ?').run(oldest.id);
}

export function needsFirstRunSetup() {
  return db.prepare('SELECT COUNT(*) AS n FROM Users').get().n === 0;
}

/** Only allowed while no account exists: creates the root admin. */
export function createFirstAdmin({ username, email, password }) {
  if (!needsFirstRunSetup()) throw new Error('Setup is already complete. Sign in instead.');
  const user = createUser({ username, email, password, isAdmin: true });
  db.prepare('UPDATE Users SET must_change_password = 0 WHERE id = ?').run(user.id);
  return getUserById(user.id);
}

export function getUserById(id) {
  return publicUser(db.prepare('SELECT * FROM Users WHERE id = ?').get(id));
}

export function loginUser(email, password) {
  // Case-insensitive, so accounts created before emails were normalised still work.
  const candidates = db.prepare('SELECT * FROM Users WHERE lower(trim(email)) = ?').all(normalizeEmail(email));
  const user = candidates.find((row) => hashPassword(String(password ?? ''), row.salt) === row.password_hash);
  if (!user) {
    return { success: false, error: 'Invalid email or password' };
  }
  return { success: true, user: publicUser(user) };
}

export function listUsers() {
  return db.prepare('SELECT * FROM Users ORDER BY created_at').all().map(publicUser);
}

export function createUser({ username, email, password, isAdmin = false }) {
  const cleanEmail = normalizeEmail(email);
  const cleanName = String(username ?? '').trim() || cleanEmail.split('@')[0];
  validateEmail(cleanEmail);
  validatePassword(password);
  if (db.prepare('SELECT 1 FROM Users WHERE lower(trim(email)) = ?').get(cleanEmail)) {
    throw new Error('That username or email is already in use.');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  try {
    // New accounts set their own password on first sign-in.
    const info = db.prepare(`
      INSERT INTO Users (username, email, password_hash, salt, listener_name, created_at, is_admin, must_change_password)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run(cleanName, cleanEmail, hashPassword(password, salt), salt, cleanName, new Date().toISOString(), isAdmin ? 1 : 0);
    return getUserById(Number(info.lastInsertRowid));
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new Error('That username or email is already in use.');
    throw err;
  }
}

/**
 * actor edits target. Self: username, email, password (needs currentPassword).
 * Admin: any field on anyone, including isAdmin and a password reset.
 */
export function updateUser(actor, targetId, { username, email, password, currentPassword, isAdmin } = {}) {
  const target = db.prepare('SELECT * FROM Users WHERE id = ?').get(targetId);
  if (!target) throw new Error('Account not found.');
  const isSelf = actor.id === target.id;
  if (!isSelf && !actor.isAdmin) throw new Error('Only an admin can edit other accounts.');

  // 1. Validate every requested change before touching anything.
  const changes = {};
  if (typeof username === 'string' && username.trim() && username.trim() !== target.username) {
    const clash = db.prepare('SELECT 1 FROM Users WHERE username = ? AND id != ?').get(username.trim(), target.id);
    if (clash) throw new Error('That username is already in use.');
    changes.username = username.trim();
  }
  if (typeof email === 'string' && email.trim()) {
    const cleanEmail = normalizeEmail(email);
    validateEmail(cleanEmail);
    if (cleanEmail !== target.email) {
      const clash = db.prepare('SELECT 1 FROM Users WHERE lower(trim(email)) = ? AND id != ?').get(cleanEmail, target.id);
      if (clash) throw new Error('That email is already in use.');
      changes.email = cleanEmail;
    }
  }
  if (typeof password === 'string' && password) {
    validatePassword(password);
    if (isSelf && !target.must_change_password
      && hashPassword(String(currentPassword ?? ''), target.salt) !== target.password_hash) {
      throw new Error('Current password is incorrect.');
    }
    changes.password = password;
  }
  if (typeof isAdmin === 'boolean' && isAdmin !== Boolean(target.is_admin)) {
    if (!actor.isAdmin) throw new Error('Only an admin can change admin access.');
    if (!isAdmin && adminCount() <= 1) throw new Error('At least one admin account must remain.');
    changes.isAdmin = isAdmin;
  }

  // 2. Apply them all or none.
  db.transaction(() => {
    if (changes.username) db.prepare('UPDATE Users SET username = ? WHERE id = ?').run(changes.username, target.id);
    if (changes.email) db.prepare('UPDATE Users SET email = ? WHERE id = ?').run(changes.email, target.id);
    // An admin resetting someone else's password forces them to choose a new one.
    if (changes.password) setPassword(target.id, changes.password, { mustChange: !isSelf });
    if (typeof changes.isAdmin === 'boolean') db.prepare('UPDATE Users SET is_admin = ? WHERE id = ?').run(changes.isAdmin ? 1 : 0, target.id);
  })();
  return getUserById(target.id);
}

export function deleteUser(actor, targetId) {
  const target = db.prepare('SELECT * FROM Users WHERE id = ?').get(targetId);
  if (!target) throw new Error('Account not found.');
  if (actor.id !== target.id && !actor.isAdmin) throw new Error('Only an admin can delete other accounts.');
  if (target.is_admin && adminCount() <= 1) throw new Error('The last admin account cannot be deleted.');
  db.prepare('DELETE FROM Users WHERE id = ?').run(target.id);
  return { success: true };
}

export function updateListenerName(userId, listenerName) {
  db.prepare('UPDATE Users SET listener_name = ? WHERE id = ?').run(listenerName, userId);
  return { success: true };
}

export function getAppSettings() {
  const row = db.prepare(`
    SELECT screen_recording_enabled, show_cost_enabled, onboarding_done, web_search_enabled,
           live_insights_enabled, diarization_enabled
    FROM AppSettings
    WHERE id = 1
  `).get();

  // Sarvam is the only transcription provider; the legacy columns are ignored.
  const screenRecordingEnabled = Boolean(row?.screen_recording_enabled);

  return {
    transcriptionProvider: 'sarvam',
    nativeIndiaMode: true,
    screenRecordingEnabled,
    showCost: row?.show_cost_enabled === undefined ? true : Boolean(row.show_cost_enabled),
    onboardingDone: Boolean(row?.onboarding_done),
    webSearchEnabled: Boolean(row?.web_search_enabled),
    liveInsightsEnabled: row?.live_insights_enabled === undefined ? true : Boolean(row.live_insights_enabled),
    diarizationEnabled: Boolean(row?.diarization_enabled),
    sarvam: {
      isBeta: true,
      model: 'saaras:v4',
      mode: 'transcribe',
      autoDetectLanguage: true,
      supportedLanguages: SARVAM_SUPPORTED_LANGUAGES,
    },
  };
}

export function updateAppSettings({
  screenRecordingEnabled, showCost, onboardingDone, webSearchEnabled, liveInsightsEnabled, diarizationEnabled,
} = {}) {
  const current = getAppSettings();
  const pick = (value, fallback) => (typeof value === 'boolean' ? value : fallback) ? 1 : 0;
  db.prepare(`
    UPDATE AppSettings
    SET transcription_provider = 'sarvam', india_mode_enabled = 1,
        screen_recording_enabled = ?, show_cost_enabled = ?, onboarding_done = ?, web_search_enabled = ?,
        live_insights_enabled = ?, diarization_enabled = ?
    WHERE id = 1
  `).run(
    pick(screenRecordingEnabled, current.screenRecordingEnabled),
    pick(showCost, current.showCost),
    pick(onboardingDone, current.onboardingDone),
    pick(webSearchEnabled, current.webSearchEnabled),
    pick(liveInsightsEnabled, current.liveInsightsEnabled),
    pick(diarizationEnabled, current.diarizationEnabled),
  );

  return getAppSettings();
}
