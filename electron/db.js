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
  db = new Database(dbPath, { verbose: console.log });

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
      transcription_provider TEXT NOT NULL DEFAULT 'deepgram',
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
    db.prepare("ALTER TABLE AppSettings ADD COLUMN transcription_provider TEXT NOT NULL DEFAULT 'deepgram'").run();
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

  db.prepare(`
    INSERT INTO AppSettings (id, transcription_provider, india_mode_enabled, screen_recording_enabled)
    VALUES (1, 'deepgram', 0, 0)
    ON CONFLICT(id) DO NOTHING
  `).run();
  
  console.log('Database initialized at', dbPath);
}

export function getDB() {
  return db;
}

/** Hash password with salt using PBKDF2 */
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

export function registerUser(username, email, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  const createdAt = new Date().toISOString();

  try {
    const stmt = db.prepare(
      'INSERT INTO Users (username, email, password_hash, salt, listener_name, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const info = stmt.run(username, email, passwordHash, salt, username, createdAt);
    return { success: true, userId: info.lastInsertRowid };
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return { success: false, error: 'Username or email already exists' };
    }
    return { success: false, error: err.message };
  }
}

export function loginUser(email, password) {
  const user = db.prepare('SELECT * FROM Users WHERE email = ?').get(email);
  if (!user) {
    return { success: false, error: 'Invalid email or password' };
  }
  const hash = hashPassword(password, user.salt);
  if (hash !== user.password_hash) {
    return { success: false, error: 'Invalid email or password' };
  }
  return {
    success: true,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      listener_name: user.listener_name,
    },
  };
}

export function resetPassword(email, newPassword) {
  const user = db.prepare('SELECT * FROM Users WHERE email = ?').get(email);
  if (!user) {
    return { success: false, error: 'Email not found' };
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(newPassword, salt);
  db.prepare('UPDATE Users SET password_hash = ?, salt = ? WHERE email = ?').run(passwordHash, salt, email);
  return { success: true };
}

export function updateListenerName(userId, listenerName) {
  db.prepare('UPDATE Users SET listener_name = ? WHERE id = ?').run(listenerName, userId);
  return { success: true };
}

export function getAppSettings() {
  const row = db.prepare(`
    SELECT transcription_provider, india_mode_enabled, screen_recording_enabled
    FROM AppSettings
    WHERE id = 1
  `).get();

  const transcriptionProvider = row?.transcription_provider === 'sarvam' ? 'sarvam' : 'deepgram';
  const nativeIndiaMode = Boolean(row?.india_mode_enabled);
  const screenRecordingEnabled = Boolean(row?.screen_recording_enabled);

  return {
    transcriptionProvider,
    nativeIndiaMode,
    screenRecordingEnabled,
    sarvam: {
      isBeta: true,
      model: 'saaras:v3',
      mode: 'transcribe',
      autoDetectLanguage: true,
      supportedLanguages: SARVAM_SUPPORTED_LANGUAGES,
    },
  };
}

export function updateAppSettings({ nativeIndiaMode, screenRecordingEnabled } = {}) {
  const current = getAppSettings();
  const nextNativeIndiaMode = typeof nativeIndiaMode === 'boolean'
    ? nativeIndiaMode
    : current.nativeIndiaMode;
  const nextScreenRecordingEnabled = typeof screenRecordingEnabled === 'boolean'
    ? screenRecordingEnabled
    : current.screenRecordingEnabled;
  const transcriptionProvider = nextNativeIndiaMode ? 'sarvam' : 'deepgram';
  db.prepare(`
    UPDATE AppSettings
    SET transcription_provider = ?, india_mode_enabled = ?, screen_recording_enabled = ?
    WHERE id = 1
  `).run(
    transcriptionProvider,
    nextNativeIndiaMode ? 1 : 0,
    nextScreenRecordingEnabled ? 1 : 0,
  );

  return getAppSettings();
}
