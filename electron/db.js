import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import crypto from 'crypto';

let db;

export function initDB() {
  const dbPath = path.join(app.getPath('userData'), 'agentzero.db');
  db = new Database(dbPath, { verbose: console.log });

  db.exec(`
    CREATE TABLE IF NOT EXISTS Meetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      video_file_path TEXT,
      audio_file_path TEXT,
      transcript_path TEXT
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
  `);

  // Simple migration: ensure transcript_path exists for existing DBs
  const columns = db.prepare("PRAGMA table_info(Meetings)").all();
  const hasTranscriptPath = columns.some(col => col.name === 'transcript_path');
  if (!hasTranscriptPath) {
    db.prepare("ALTER TABLE Meetings ADD COLUMN transcript_path TEXT").run();
    console.log('[DB] Added transcript_path column to Meetings table');
  }
  
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
