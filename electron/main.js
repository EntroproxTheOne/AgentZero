import { app, BrowserWindow, ipcMain, desktopCapturer, session } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { initDB } from './db.js';
import { transcribeChunk } from './transcriber.js';
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

  if (process.env.VITE_DEV_SERVER_URL || process.env.NODE_ENV !== 'production') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  initDB();

  createWindow();

  // Enable getDisplayMedia() in renderer by providing screen sources
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      // Provide the first screen source (primary display)
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

ipcMain.handle('save-chunk', async (event, { meetingId, buffer }) => {
  const dir = getRecordingsDir();
  const filePath = path.join(dir, `meeting_${meetingId}.webm`);
  fs.appendFileSync(filePath, Buffer.from(buffer));

  // Trigger transcription asynchronously
  transcribeChunk(meetingId, buffer);

  return filePath;
});

ipcMain.handle('start-meeting', async (event, { title }) => {
  const { getDB } = await import('./db.js');
  const db = getDB();
  const now = new Date();
  const dateStr = now.toISOString();
  const meetingId = Date.now();

  const dir = getRecordingsDir();
  const tempPath = path.join(dir, `meeting_${meetingId}.webm`);

  const stmt = db.prepare('INSERT INTO Meetings (title, date, video_file_path) VALUES (?, ?, ?)');
  const info = stmt.run(title || 'Untitled Meeting', dateStr, tempPath);

  return { meetingId, dbId: info.lastInsertRowid, tempPath };
});

ipcMain.handle('stop-meeting', async (event, { meetingId, dbId, startTime, title }) => {
  const { getDB } = await import('./db.js');
  const db = getDB();
  const dir = getRecordingsDir();
  const tempPath = path.join(dir, `meeting_${meetingId}.webm`);

  // Build final filename: YYYY-MM-DD-HH-MM-SS-DURATION-TITLE.webm
  const start = new Date(startTime);
  const durationMs = Date.now() - startTime;
  const durationMins = Math.round(durationMs / 60000);
  const durationStr = `${durationMins}min`;

  const pad = (n) => String(n).padStart(2, '0');
  const datePrefix = `${start.getFullYear()}-${pad(start.getMonth()+1)}-${pad(start.getDate())}-${pad(start.getHours())}-${pad(start.getMinutes())}-${pad(start.getSeconds())}`;
  const safeTitle = (title || 'Untitled').replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-');
  const finalName = `${datePrefix}-${durationStr}-${safeTitle}.webm`;
  const finalPath = path.join(dir, finalName);

  // Rename temp file to final
  if (fs.existsSync(tempPath)) {
    fs.renameSync(tempPath, finalPath);
  }

  // Update DB record
  db.prepare('UPDATE Meetings SET video_file_path = ? WHERE id = ?').run(finalPath, dbId);

  return { finalPath, finalName };
});

ipcMain.handle('get-meetings', async () => {
  const { getDB } = await import('./db.js');
  const db = getDB();
  return db.prepare('SELECT * FROM Meetings ORDER BY date DESC').all();
});

function getRecordingsDir() {
  const documentsDir = app.getPath('documents');
  const dir = path.join(documentsDir, 'AgentZero', 'Recordings');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
