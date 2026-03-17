import 'dotenv/config';
import { app, BrowserWindow, ipcMain, desktopCapturer, session } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { initDB } from './db.js';
import { transcribeChunk, startTranscription, sendChunk, stopTranscription } from './transcriber.js';
import { detectMeetingApps } from './meetingApps.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#ffffff',
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  } else {
    const url = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    mainWindow.loadURL(url);
  }
}

app.whenReady().then(() => {
  initDB();

  createWindow();

  // Enable getDisplayMedia() in renderer by providing screen sources
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      const screenSource = sources.find(s => s.id.startsWith('screen:')) || sources[0];
      if (screenSource) {
        callback({ video: screenSource, audio: 'loopback' });
      } else {
        callback({});
      }
    });
  });

  // Window control IPC handlers
  ipcMain.on('window-minimize', () => mainWindow?.minimize());
  ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.on('window-close', () => mainWindow?.close());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('detect-meeting-apps', async () => {
  return await detectMeetingApps();
});

// Auth IPC handlers
ipcMain.handle('auth-register', async (event, { username, email, password }) => {
  const { registerUser } = await import('./db.js');
  return registerUser(username, email, password);
});

ipcMain.handle('auth-login', async (event, { email, password }) => {
  const { loginUser } = await import('./db.js');
  return loginUser(email, password);
});

ipcMain.handle('auth-reset-password', async (event, { email, newPassword }) => {
  const { resetPassword } = await import('./db.js');
  return resetPassword(email, newPassword);
});

ipcMain.handle('update-listener-name', async (event, { userId, listenerName }) => {
  const { updateListenerName } = await import('./db.js');
  return updateListenerName(userId, listenerName);
});

// Open file in explorer
ipcMain.handle('open-in-explorer', async (event, filePath) => {
  const { shell } = await import('electron');
  if (fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
  }
});

ipcMain.handle('get-desktop-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
  return sources.map(source => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.toDataURL()
  }));
});

// Active recording metadata: Map<meetingId, { tempPath, dbId, folder }>
const activeMeetings = new Map();

// ─── Streaming: append each chunk to the temp file on disk immediately ───
ipcMain.handle('save-chunk', async (event, { meetingId, buffer }) => {
  const meta = activeMeetings.get(meetingId);
  if (meta) {
    fs.appendFileSync(meta.tempPath, Buffer.from(buffer));
  }

  // Trigger transcription asynchronously
  transcribeChunk(meetingId, buffer);

  return meta?.tempPath;
});

ipcMain.handle('start-meeting', async (event, { title }) => {
  const { getDB } = await import('./db.js');
  const db = getDB();
  const now = new Date();
  const startTime = now.getTime();
  const meetingId = startTime;
  const dateStr = now.toISOString();

  // Create meeting-specific folder
  const nameBase = getFinalFileName(startTime, title);
  const rootDir = getRecordingsDir();
  const meetingFolder = path.join(rootDir, nameBase);
  if (!fs.existsSync(meetingFolder)) fs.mkdirSync(meetingFolder, { recursive: true });

  const tempPath = path.join(meetingFolder, `temp_video.webm`);
  
  activeMeetings.set(meetingId, { tempPath, dbId: 0 /* updated below */, folder: meetingFolder });

  const stmt = db.prepare('INSERT INTO Meetings (title, date, video_file_path, audio_file_path, transcript_path) VALUES (?, ?, ?, ?, ?)');
  const info = stmt.run(title || 'Untitled Meeting', dateStr, tempPath, null, null);
  
  const dbId = info.lastInsertRowid;
  activeMeetings.get(meetingId).dbId = dbId;

  return { meetingId, dbId, tempPath, meetingFolder, nameBase };
});

ipcMain.handle('stop-meeting', async (event, { meetingId, dbId, startTime, title, finalName, meetingFolder }) => {
  const { getDB } = await import('./db.js');
  const db = getDB();
  const tempPath = path.join(meetingFolder, `temp_video.webm`);

  // Build final name with updated duration
  const nameBase = getFinalFileName(startTime, title);
  const fileName = `${nameBase}.webm`;
  const finalPath = path.join(meetingFolder, fileName);

  // Use ffmpeg to remux the temp file
  if (fs.existsSync(tempPath)) {
    try {
      await fsyncFile(tempPath);
      await runFFmpegRemux(tempPath, finalPath);
      fs.unlinkSync(tempPath);
    } catch (err) {
      console.error('FFmpeg remux failed:', err);
      fs.renameSync(tempPath, finalPath);
    }
  }

  // Update DB record
  db.prepare('UPDATE Meetings SET video_file_path = ? WHERE id = ?').run(finalPath, dbId);

  // Cleanup session
  activeMeetings.delete(meetingId);

  return { finalPath, finalName: fileName, nameBase, meetingFolder };
});

ipcMain.handle('get-meetings', async () => {
  const { getDB } = await import('./db.js');
  const db = getDB();
  return db.prepare('SELECT * FROM Meetings ORDER BY date DESC').all();
});

// ─── Live Transcription IPC ───────────────────────────────────────────────────

// Start a Deepgram session for this meeting
ipcMain.handle('start-transcription', async (_event, { meetingId }) => {
  await startTranscription(meetingId, mainWindow);
});

// Receive zero-copy PCM ArrayBuffer from renderer via postMessage
// ipcRenderer.postMessage sends: message={meetingId}, transfer=[buffer]
// In main, the event.data contains both the message object and
// Electron delivers postMessage via a special MessageEvent on the channel
ipcMain.on('send-audio-chunk', (_event, message) => {
  const { meetingId, buffer } = message;
  // buffer might be an ArrayBuffer or a Buffer (depending on IPC serialization)
  if (buffer) {
    sendChunk(meetingId, buffer);
  }
});

ipcMain.on('log-from-renderer', (_event, level, ...args) => {
  console.log(`[Renderer-${level}]`, ...args);
});

ipcMain.handle('stop-transcription', async (_event, { meetingId, dbId, finalName, meetingFolder }) => {
  await stopTranscription(meetingId, dbId, finalName, meetingFolder);
});

// ─── Helpers ───

function getFinalFileName(startTime, title) {
  const start = new Date(startTime);
  const durationMs = Date.now() - startTime;
  const durationMins = Math.round(durationMs / 60000);
  const durationStr = `${durationMins}min`;

  const pad = (n) => String(n).padStart(2, '0');
  const datePrefix = `${start.getFullYear()}-${pad(start.getMonth()+1)}-${pad(start.getDate())}-${pad(start.getHours())}-${pad(start.getMinutes())}-${pad(start.getSeconds())}`;
  const safeTitle = (title || 'Untitled').replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-');
  return `${datePrefix}-${durationStr}-${safeTitle}`;
}

function getRecordingsDir() {
  const documentsDir = app.getPath('documents');
  const dir = path.join(documentsDir, 'AgentZero', 'Recordings');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Force the OS to flush all buffered writes for a file to disk.
 * Prevents ffmpeg from reading a partially-written file.
 */
function fsyncFile(filePath) {
  return new Promise((resolve, reject) => {
    fs.open(filePath, 'r+', (openErr, fd) => {
      if (openErr) return reject(openErr);
      fs.fsync(fd, (syncErr) => {
        fs.close(fd, (closeErr) => {
          if (syncErr) return reject(syncErr);
          if (closeErr) return reject(closeErr);
          resolve();
        });
      });
    });
  });
}

/**
 * Resolve the correct ffmpeg binary path for both dev and packaged builds.
 *
 * electron-builder packs the app into app.asar. Executables inside ASAR
 * cannot be spawned by the OS. The asarUnpack config tells electron-builder
 * to copy ffmpeg-static into app.asar.unpacked/ alongside the archive.
 * We replace 'app.asar' with 'app.asar.unpacked' so exec() can find it.
 */
function getFFmpegBinaryPath() {
  if (app.isPackaged) {
    return ffmpegPath.replace('app.asar', 'app.asar.unpacked');
  }
  return ffmpegPath;
}

/**
 * Remux a webm file using ffmpeg to fix duration metadata.
 * Uses `-c copy` so it's near-instant (no transcoding).
 */
function runFFmpegRemux(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const binary = getFFmpegBinaryPath();
    const cmd = `"${binary}" -y -i "${inputPath}" -c copy "${outputPath}"`;
    exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}
