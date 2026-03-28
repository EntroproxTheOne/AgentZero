import 'dotenv/config';
import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, session, systemPreferences } from 'electron';
import path from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { initDB, getAppSettings, getDB, updateAppSettings } from './db.js';
import { startTranscription, sendChunk, stopTranscription } from './transcriber.js';
import { detectMeetingApps } from './meetingApps.js';
import { AsyncChunkWriter } from './chunkWriter.js';
import { MeetingAiService } from './ai/service.js';
import { readArtifactsFile } from './ai/artifactStore.js';
import { exportMeetingMom } from './exporters/momExport.js';
import { AI_CONFIG } from './ai/config.js';
import { assertAccessAllowed, getAppAccessSnapshot } from './runtimeConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
const meetingSessions = new Map();
const deepgramAudioDiagnostics = new Set();
const videoChunkDiagnostics = new Set();
let accessCheckInterval = null;
let accessShutdownTriggered = false;

function getMeetingSession(meetingId) {
  return meetingSessions.get(meetingId) ?? null;
}

function emitToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function getMacPermissionSnapshot() {
  if (process.platform !== 'darwin') return null;

  return {
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
    screen: systemPreferences.getMediaAccessStatus('screen'),
  };
}

function getRuntimeInfo() {
  const access = getAppAccessSnapshot();
  return {
    platform: process.platform,
    isMac: process.platform === 'darwin',
    access,
    macPermissions: getMacPermissionSnapshot(),
  };
}

async function triggerAccessShutdown(reason) {
  if (accessShutdownTriggered) return;
  accessShutdownTriggered = true;

  console.error('[Access]', reason);
  emitToRenderer('access-state', getRuntimeInfo());

  if (app.isReady()) {
    try {
      await dialog.showMessageBox({
        type: 'error',
        title: 'AgentZero Test Build Expired',
        message: reason,
        buttons: ['Close App'],
        defaultId: 0,
        noLink: true,
      });
    } catch {
      dialog.showErrorBox('AgentZero Test Build Expired', reason);
    }
  }

  if (accessCheckInterval) {
    clearInterval(accessCheckInterval);
    accessCheckInterval = null;
  }

  app.quit();
  setTimeout(() => app.exit(1), 1000);
}

function ensureAppAccess(context) {
  try {
    assertAccessAllowed();
  } catch (error) {
    const message = error instanceof Error ? error.message : `Access blocked while handling ${context}`;
    void triggerAccessShutdown(message);
    throw error;
  }
}

function registerGuardedHandle(channel, handler) {
  ipcMain.handle(channel, async (...args) => {
    ensureAppAccess(channel);
    return handler(...args);
  });
}

function registerGuardedEvent(channel, handler) {
  ipcMain.on(channel, (...args) => {
    try {
      ensureAppAccess(channel);
    } catch {
      return;
    }

    handler(...args);
  });
}

function configureDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      const screenSource = sources.find((source) => source.id.startsWith('screen:')) || sources[0];
      if (screenSource) {
        callback({ video: screenSource, audio: 'loopback' });
      } else {
        callback({});
      }
    });
  }, {
    useSystemPicker: process.platform === 'darwin',
  });
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

  const access = getAppAccessSnapshot();
  if (!access.allowed) {
    void triggerAccessShutdown(access.shutdownMessage);
    return;
  }

  createWindow();
  configureDisplayMediaHandler();

  accessCheckInterval = setInterval(() => {
    const latestAccess = getAppAccessSnapshot();
    if (!latestAccess.allowed) {
      void triggerAccessShutdown(latestAccess.shutdownMessage);
      return;
    }

    emitToRenderer('access-state', getRuntimeInfo());
  }, 30000);

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
      const latestAccess = getAppAccessSnapshot();
      if (!latestAccess.allowed) {
        void triggerAccessShutdown(latestAccess.shutdownMessage);
        return;
      }
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (accessCheckInterval) {
    clearInterval(accessCheckInterval);
    accessCheckInterval = null;
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('get-runtime-info', async () => getRuntimeInfo());
registerGuardedHandle('detect-meeting-apps', async () => detectMeetingApps());

registerGuardedHandle('auth-register', async (_event, payload) => {
  const { registerUser } = await import('./db.js');
  return registerUser(payload.username, payload.email, payload.password);
});

registerGuardedHandle('auth-login', async (_event, payload) => {
  const { loginUser } = await import('./db.js');
  return loginUser(payload.email, payload.password);
});

registerGuardedHandle('auth-reset-password', async (_event, payload) => {
  const { resetPassword } = await import('./db.js');
  return resetPassword(payload.email, payload.newPassword);
});

registerGuardedHandle('update-listener-name', async (_event, payload) => {
  const { updateListenerName } = await import('./db.js');
  return updateListenerName(payload.userId, payload.listenerName);
});

registerGuardedHandle('get-app-settings', async () => getAppSettings());

registerGuardedHandle('update-app-settings', async (_event, payload) => updateAppSettings(payload));

registerGuardedHandle('open-in-explorer', async (_event, filePath) => {
  const { shell } = await import('electron');
  if (fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
  }
});

registerGuardedHandle('get-desktop-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.toDataURL(),
  }));
});

registerGuardedEvent('save-chunk-buffer', (_event, message) => {
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

registerGuardedHandle('flush-meeting-writes', async (_event, { meetingId }) => {
  const sessionState = getMeetingSession(meetingId);
  if (!sessionState) return;
  await sessionState.writer.waitForIdle();
});

registerGuardedHandle('start-meeting', async (_event, { title }) => {
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

registerGuardedHandle('start-transcription', async (_event, { meetingId }) => {
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

registerGuardedEvent('send-audio-chunk', (_event, message) => {
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

registerGuardedHandle('stop-transcription', async (_event, { meetingId, dbId }) => {
  const sessionState = getMeetingSession(meetingId);
  if (!sessionState) return { transcriptPath: null };

  const result = await stopTranscription(meetingId, {
    dbId,
    transcriptPath: sessionState.transcriptPath,
  });

  deepgramAudioDiagnostics.delete(meetingId);

  sessionState.transcriptEntries = result.entries;
  if (getAppAccessSnapshot().allowed) {
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
  }

  // Fire-and-forget: auto-generate title if still "Untitled Meeting"
  if (getAppAccessSnapshot().allowed && sessionState.title === 'Untitled Meeting' && result.entries.length > 0) {
    autoGenerateTitle(dbId, result.entries).catch((err) => {
      console.error('[Main] Auto-title generation failed (non-critical):', err?.message || err);
    });
  }

  return {
    transcriptPath: sessionState.transcriptPath,
  };
});

registerGuardedHandle('stop-meeting', async (_event, { meetingId, dbId, startTime, title }) => {
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

registerGuardedHandle('get-meetings', async () => {
  const db = getDB();
  return db.prepare('SELECT * FROM Meetings ORDER BY date DESC').all();
});

registerGuardedHandle('get-meeting-artifacts', async (_event, { dbId }) => {
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

registerGuardedHandle('quicklook-ask', async (_event, payload) => {
  const answer = await aiService.answerQuickLook(payload.meetingId, {
    question: payload.question,
    history: payload.history,
  });

  return answer;
});

registerGuardedHandle('export-meeting-mom', async (_event, { dbId, format }) => {
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

registerGuardedHandle('rename-meeting', async (_event, { dbId, title }) => {
  const db = getDB();
  db.prepare('UPDATE Meetings SET title = ? WHERE id = ?').run(title, dbId);

  // Also update the artifacts.json title if it exists
  const meeting = db.prepare('SELECT artifacts_path FROM Meetings WHERE id = ?').get(dbId);
  if (meeting?.artifacts_path && fs.existsSync(meeting.artifacts_path)) {
    try {
      const raw = await fsPromises.readFile(meeting.artifacts_path, 'utf8');
      const artifacts = JSON.parse(raw);
      artifacts.title = title;
      await fsPromises.writeFile(meeting.artifacts_path, JSON.stringify(artifacts, null, 2), 'utf8');
    } catch {
      // Non-critical — DB is already updated
    }
  }

  return { success: true };
});

registerGuardedHandle('delete-meetings', async (_event, { dbIds }) => {
  const db = getDB();
  let deletedCount = 0;

  for (const dbId of dbIds) {
    const meeting = db.prepare('SELECT * FROM Meetings WHERE id = ?').get(dbId);
    if (!meeting) continue;

    // Delete from DB
    db.prepare('DELETE FROM Meetings WHERE id = ?').run(dbId);
    db.prepare('DELETE FROM Transcripts WHERE meeting_id = ?').run(dbId);
    deletedCount++;

    // Delete meeting folder from disk
    const folderPath = meeting.video_file_path
      ? path.dirname(meeting.video_file_path)
      : meeting.transcript_path
        ? path.dirname(meeting.transcript_path)
        : null;

    if (folderPath && fs.existsSync(folderPath)) {
      try {
        await fsPromises.rm(folderPath, { recursive: true, force: true });
      } catch (err) {
        console.error(`[Main] Failed to delete meeting folder ${folderPath}:`, err);
      }
    }
  }

  return { success: true, deletedCount };
});

registerGuardedHandle('auto-title-meeting', async (_event, { dbId }) => {
  const db = getDB();
  const meeting = db.prepare('SELECT * FROM Meetings WHERE id = ?').get(dbId);
  if (!meeting) throw new Error('Meeting not found');

  const transcriptEntries = await readJsonFile(meeting.transcript_path);
  if (!Array.isArray(transcriptEntries) || transcriptEntries.length === 0) {
    throw new Error('Transcript is not available');
  }

  // Take first ~50 lines for title generation (enough context, not too much)
  const sampleLines = transcriptEntries
    .filter((e) => e.text && e.text.trim())
    .slice(0, 50)
    .map((e) => `${e.speakerLabel || 'Speaker'}: ${e.text}`)
    .join('\n');

  const { generateGeminiJson } = await import('./ai/providers/gemini.js');
  const response = await generateGeminiJson({
    model: AI_CONFIG.models.liveGujarati,
    prompt: [
      'Generate a short, professional meeting title from this transcript excerpt.',
      'Return JSON only: {"title": "string"}',
      'Title: 3-8 words, main topic, professional language, no dates.',
      '',
      'Transcript:',
      sampleLines,
    ].join('\n'),
    maxOutputTokens: 100,
  });

  const parsed = JSON.parse(response.text);
  const newTitle = typeof parsed?.title === 'string' && parsed.title.trim()
    ? parsed.title.trim()
    : 'Untitled Meeting';

  // Update DB
  db.prepare('UPDATE Meetings SET title = ? WHERE id = ?').run(newTitle, dbId);

  // Update artifacts.json
  if (meeting.artifacts_path && fs.existsSync(meeting.artifacts_path)) {
    try {
      const raw = await fsPromises.readFile(meeting.artifacts_path, 'utf8');
      const artifacts = JSON.parse(raw);
      artifacts.title = newTitle;
      await fsPromises.writeFile(meeting.artifacts_path, JSON.stringify(artifacts, null, 2), 'utf8');
    } catch {
      // Non-critical
    }
  }

  return { title: newTitle };
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

async function autoGenerateTitle(dbId, transcriptEntries) {
  const sampleLines = transcriptEntries
    .filter((e) => e.text && e.text.trim())
    .slice(0, 50)
    .map((e) => `${e.speakerLabel || 'Speaker'}: ${e.text}`)
    .join('\n');

  if (!sampleLines) return;

  const { generateGeminiJson } = await import('./ai/providers/gemini.js');
  const response = await generateGeminiJson({
    model: AI_CONFIG.models.liveGujarati,
    prompt: [
      'Generate a short, professional meeting title from this transcript excerpt.',
      'Return JSON only: {"title": "string"}',
      'Title: 3-8 words, main topic, professional language, no dates.',
      '',
      'Transcript:',
      sampleLines,
    ].join('\n'),
    maxOutputTokens: 100,
  });

  const parsed = JSON.parse(response.text);
  const newTitle = typeof parsed?.title === 'string' && parsed.title.trim()
    ? parsed.title.trim()
    : null;

  if (!newTitle) return;

  const db = getDB();
  db.prepare('UPDATE Meetings SET title = ? WHERE id = ?').run(newTitle, dbId);

  // Update artifacts.json title
  const meeting = db.prepare('SELECT artifacts_path FROM Meetings WHERE id = ?').get(dbId);
  if (meeting?.artifacts_path && fs.existsSync(meeting.artifacts_path)) {
    try {
      const raw = await fsPromises.readFile(meeting.artifacts_path, 'utf8');
      const artifacts = JSON.parse(raw);
      artifacts.title = newTitle;
      await fsPromises.writeFile(meeting.artifacts_path, JSON.stringify(artifacts, null, 2), 'utf8');
    } catch { /* non-critical */ }
  }

  // Notify renderer so PostMeetingDashboard can update
  emitToRenderer('meeting-title-updated', { dbId, title: newTitle });
  console.log(`[Main] Auto-generated title for meeting ${dbId}: "${newTitle}"`);
}
