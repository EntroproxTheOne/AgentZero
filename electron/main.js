import 'dotenv/config';
import { app, BrowserWindow, desktopCapturer, ipcMain, session } from 'electron';
import path from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { initDB, getDB } from './db.js';
import { startTranscription, sendChunk, stopTranscription } from './transcriber.js';
import { detectMeetingApps } from './meetingApps.js';
import { AsyncChunkWriter } from './chunkWriter.js';
import { MeetingAiService } from './ai/service.js';
import { readArtifactsFile } from './ai/artifactStore.js';
import { exportMeetingMom } from './exporters/momExport.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
const meetingSessions = new Map();
const deepgramAudioDiagnostics = new Set();
const videoChunkDiagnostics = new Set();

function getMeetingSession(meetingId) {
  return meetingSessions.get(meetingId) ?? null;
}

function emitToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

const aiService = new MeetingAiService({
  getSession: getMeetingSession,
  emitToRenderer,
});

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

  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      const screenSource = sources.find((source) => source.id.startsWith('screen:')) || sources[0];
      if (screenSource) {
        callback({ video: screenSource, audio: 'loopback' });
      } else {
        callback({});
      }
    });
  });

  ipcMain.on('window-minimize', () => mainWindow?.minimize());
  ipcMain.on('window-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
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

ipcMain.handle('detect-meeting-apps', async () => detectMeetingApps());

ipcMain.handle('auth-register', async (_event, payload) => {
  const { registerUser } = await import('./db.js');
  return registerUser(payload.username, payload.email, payload.password);
});

ipcMain.handle('auth-login', async (_event, payload) => {
  const { loginUser } = await import('./db.js');
  return loginUser(payload.email, payload.password);
});

ipcMain.handle('auth-reset-password', async (_event, payload) => {
  const { resetPassword } = await import('./db.js');
  return resetPassword(payload.email, payload.newPassword);
});

ipcMain.handle('update-listener-name', async (_event, payload) => {
  const { updateListenerName } = await import('./db.js');
  return updateListenerName(payload.userId, payload.listenerName);
});

ipcMain.handle('open-in-explorer', async (_event, filePath) => {
  const { shell } = await import('electron');
  if (fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
  }
});

ipcMain.handle('get-desktop-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.toDataURL(),
  }));
});

ipcMain.on('save-chunk-buffer', (_event, message) => {
  const { meetingId, buffer } = message;
  const sessionState = getMeetingSession(meetingId);
  if (!sessionState || !buffer) return;

  try {
    const normalizedBuffer = Buffer.isBuffer(buffer)
      ? buffer
      : ArrayBuffer.isView(buffer)
        ? Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        : Buffer.from(buffer);

    if (!videoChunkDiagnostics.has(meetingId)) {
      videoChunkDiagnostics.add(meetingId);
      console.log(
        `[Recorder] First video chunk received in main for meeting ${meetingId} (${normalizedBuffer.byteLength} bytes)`,
      );
    }

    sessionState.writer.enqueue(normalizedBuffer);
  } catch (error) {
    console.error('[Main] Failed to enqueue video chunk:', error);
  }
});

ipcMain.handle('flush-meeting-writes', async (_event, { meetingId }) => {
  const sessionState = getMeetingSession(meetingId);
  if (!sessionState) return;
  await sessionState.writer.waitForIdle();
});

ipcMain.handle('start-meeting', async (_event, { title }) => {
  const db = getDB();
  const startTime = Date.now();
  const dateIso = new Date(startTime).toISOString();
  const meetingId = startTime;

  const nameBase = getFinalFileName(startTime, title);
  const meetingFolder = path.join(getRecordingsDir(), nameBase);
  if (!fs.existsSync(meetingFolder)) {
    fs.mkdirSync(meetingFolder, { recursive: true });
  }

  const tempPath = path.join(meetingFolder, 'temp_video.webm');
  const transcriptPath = path.join(meetingFolder, 'transcript.json');
  const artifactsPath = path.join(meetingFolder, 'artifacts.json');

  const info = db.prepare(`
    INSERT INTO Meetings (
      title,
      date,
      start_time_ms,
      end_time_ms,
      video_file_path,
      audio_file_path,
      transcript_path,
      artifacts_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    title || 'Untitled Meeting',
    dateIso,
    startTime,
    null,
    tempPath,
    null,
    transcriptPath,
    artifactsPath,
  );

  const dbId = Number(info.lastInsertRowid);
  const sessionState = {
    meetingId,
    dbId,
    title: title || 'Untitled Meeting',
    startTime,
    endTime: null,
    meetingFolder,
    tempPath,
    transcriptPath,
    artifactsPath,
    writer: new AsyncChunkWriter(tempPath),
    transcriptEntries: [],
    highlightPromise: null,
    status: 'recording',
  };

  meetingSessions.set(meetingId, sessionState);
  await aiService.registerMeeting(sessionState);

  return {
    meetingId,
    dbId,
    tempPath,
    meetingFolder,
    nameBase,
    transcriptPath,
    artifactsPath,
    startTime,
    title: title || 'Untitled Meeting',
  };
});

ipcMain.handle('start-transcription', async (_event, { meetingId }) => {
  await startTranscription(meetingId, {
    mainWindow,
    onFinalEntry: (_entry, allEntries) => {
      const sessionState = getMeetingSession(meetingId);
      if (!sessionState) return;
      sessionState.transcriptEntries = allEntries;
      aiService.handleTranscriptEntry(meetingId);
    },
  });
});

ipcMain.on('send-audio-chunk', (_event, message) => {
  if (!message?.buffer) return;
  if (!deepgramAudioDiagnostics.has(message.meetingId)) {
    deepgramAudioDiagnostics.add(message.meetingId);
    console.log(`[Deepgram] First audio chunk received in main for meeting ${message.meetingId}`);
  }
  sendChunk(message.meetingId, message.buffer);
});

ipcMain.on('log-from-renderer', (_event, level, ...args) => {
  console.log(`[Renderer-${level}]`, ...args);
});

ipcMain.handle('stop-transcription', async (_event, { meetingId, dbId }) => {
  const sessionState = getMeetingSession(meetingId);
  if (!sessionState) return { transcriptPath: null };

  const result = await stopTranscription(meetingId, {
    dbId,
    transcriptPath: sessionState.transcriptPath,
  });

  deepgramAudioDiagnostics.delete(meetingId);

  sessionState.transcriptEntries = result.entries;
  sessionState.highlightPromise = aiService.generateHighlights(meetingId)
    .catch((error) => {
      console.error('[Main] Failed to generate meeting highlights:', error);
      return null;
    })
    .finally(() => {
      const latestSession = getMeetingSession(meetingId);
      if (!latestSession) return;
      latestSession.highlightPromise = null;
      if (latestSession.status === 'stopped') {
        meetingSessions.delete(meetingId);
        aiService.unregisterMeeting(meetingId);
      }
    });

  return {
    transcriptPath: sessionState.transcriptPath,
  };
});

ipcMain.handle('stop-meeting', async (_event, { meetingId, dbId, startTime, title }) => {
  const sessionState = getMeetingSession(meetingId);
  if (!sessionState) {
    return null;
  }

  await sessionState.writer.finalize();
  if (fs.existsSync(sessionState.tempPath)) {
    await fsyncFile(sessionState.tempPath);
  }

  const nameBase = getFinalFileName(startTime, title);
  const finalName = `${nameBase}.webm`;
  const finalPath = path.join(sessionState.meetingFolder, finalName);

  if (fs.existsSync(sessionState.tempPath)) {
    try {
      await runFFmpegRemux(sessionState.tempPath, finalPath);
      fs.unlinkSync(sessionState.tempPath);
    } catch (error) {
      console.error('FFmpeg remux failed:', error);
      fs.renameSync(sessionState.tempPath, finalPath);
    }
  }

  sessionState.endTime = Date.now();
  sessionState.status = 'stopped';

  getDB().prepare(`
    UPDATE Meetings
    SET video_file_path = ?, end_time_ms = ?, transcript_path = ?, artifacts_path = ?
    WHERE id = ?
  `).run(
    finalPath,
    sessionState.endTime,
    sessionState.transcriptPath,
    sessionState.artifactsPath,
    dbId,
  );

  if (!sessionState.highlightPromise) {
    meetingSessions.delete(meetingId);
    aiService.unregisterMeeting(meetingId);
  }

  videoChunkDiagnostics.delete(meetingId);

  return {
    finalPath,
    finalName,
    nameBase,
    meetingFolder: sessionState.meetingFolder,
    transcriptPath: sessionState.transcriptPath,
    artifactsPath: sessionState.artifactsPath,
    meetingId,
    dbId,
    startTime: sessionState.startTime,
    endTime: sessionState.endTime,
    title: sessionState.title,
  };
});

ipcMain.handle('get-meetings', async () => {
  const db = getDB();
  return db.prepare('SELECT * FROM Meetings ORDER BY date DESC').all();
});

ipcMain.handle('get-meeting-artifacts', async (_event, { dbId }) => {
  const db = getDB();
  const meeting = db.prepare('SELECT * FROM Meetings WHERE id = ?').get(dbId);
  if (!meeting) {
    return null;
  }

  const transcriptEntries = await readJsonFile(meeting.transcript_path);
  const artifacts = await readArtifactsFile(meeting.artifacts_path);

  return {
    meeting,
    transcriptEntries: Array.isArray(transcriptEntries) ? transcriptEntries : [],
    artifacts,
  };
});

ipcMain.handle('quicklook-ask', async (_event, payload) => {
  const answer = await aiService.answerQuickLook(payload.meetingId, {
    question: payload.question,
    history: payload.history,
  });

  return answer;
});

ipcMain.handle('export-meeting-mom', async (_event, { dbId, format }) => {
  const db = getDB();
  const meeting = db.prepare('SELECT * FROM Meetings WHERE id = ?').get(dbId);
  if (!meeting) {
    throw new Error('Meeting not found');
  }

  const transcriptEntries = await readJsonFile(meeting.transcript_path);
  if (!Array.isArray(transcriptEntries) || transcriptEntries.length === 0) {
    throw new Error('Transcript is not available for export');
  }

  return exportMeetingMom({
    meeting,
    transcriptEntries,
    format,
  });
});

function getFinalFileName(startTime, title) {
  const start = new Date(startTime);
  const durationMs = Date.now() - startTime;
  const durationMins = Math.max(1, Math.round(durationMs / 60000));
  const durationStr = `${durationMins}min`;

  const pad = (value) => String(value).padStart(2, '0');
  const datePrefix = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}-${pad(start.getHours())}-${pad(start.getMinutes())}-${pad(start.getSeconds())}`;
  const safeTitle = (title || 'Untitled').replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-');
  return `${datePrefix}-${durationStr}-${safeTitle}`;
}

function getRecordingsDir() {
  const dir = path.join(app.getPath('documents'), 'AgentZero', 'Recordings');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

async function readJsonFile(filePath) {
  if (!filePath) return null;
  try {
    const raw = await fsPromises.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function fsyncFile(filePath) {
  return new Promise((resolve, reject) => {
    fs.open(filePath, 'r+', (openError, fd) => {
      if (openError) return reject(openError);
      fs.fsync(fd, (syncError) => {
        fs.close(fd, (closeError) => {
          if (syncError) return reject(syncError);
          if (closeError) return reject(closeError);
          resolve();
        });
      });
    });
  });
}

function getFFmpegBinaryPath() {
  if (app.isPackaged) {
    return ffmpegPath.replace('app.asar', 'app.asar.unpacked');
  }
  return ffmpegPath;
}

function runFFmpegRemux(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const command = `"${getFFmpegBinaryPath()}" -y -i "${inputPath}" -c copy "${outputPath}"`;
    exec(command, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}
