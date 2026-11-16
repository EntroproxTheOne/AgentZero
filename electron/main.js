import dotenv from 'dotenv';
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
import { readArtifactsFile, updateArtifactsFile } from './ai/artifactStore.js';
import { exportMeetingMom } from './exporters/momExport.js';
import { AI_CONFIG } from './ai/config.js';
import { assertAccessAllowed, getAppAccessSnapshot } from './runtimeConfig.js';
import { getCredentialsStatus, updateCredentials } from './credentials.js';
import {
  createFirstAdmin, createUser, deleteUser, getUserById, listUsers, loginUser, needsFirstRunSetup, updateUser,
} from './db.js';
import { computeMeetingCost } from './ai/cost.js';
import { configurePipeline, processMeeting, resumePendingMeetings } from './pipeline.js';
import { finalizeVideoMp4, pcmToMp3, probeMedia, extractSpeechMp3 } from './media.js';
import {
  addDocFromFile, addDocFromText, buildMeetingContext, deleteClient, deleteDoc, deleteProject,
  listClients, listDocs, listProjects, saveClient, saveProject, SUPPORTED_DOC_EXTENSIONS,
} from './workspace.js';
import { askAcrossMeetings } from './ai/askAll.js';
import { testGeminiConnection } from './ai/providers/gemini.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Development only: a local ignored .env can supply GEMINI_PROJECT,
// GOOGLE_APPLICATION_CREDENTIALS and SARVAM_API_KEY. Packaged builds ship no
// .env; users enter credentials in Settings (stored encrypted).
if (!app.isPackaged) {
  dotenv.config({ path: path.join(__dirname, '../.env') });
  dotenv.config();
}

let mainWindow = null;
const meetingSessions = new Map();
const audioDiagnostics = new Set();
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

// Everything except signing in requires a signed-in user, checked here in the
// main process (the renderer hiding screens is not a control).
const PUBLIC_CHANNELS = new Set(['auth-login', 'auth-needs-setup', 'auth-first-run-setup', 'auth-logout', 'auth-me']);

function registerGuardedHandle(channel, handler) {
  ipcMain.handle(channel, async (...args) => {
    ensureAppAccess(channel);
    if (!PUBLIC_CHANNELS.has(channel) && !currentUserId) {
      throw new Error('Please sign in first.');
    }
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
    if (!currentUserId) return;

    handler(...args);
  });
}

// Window/screen the renderer wants for the next capture (matched meeting app), or null for the screen.
let preferredCaptureSourceId = null;

function configureDisplayMediaHandler() {
  // Our own handler (not the macOS system picker) so system audio is always requested:
  // 'loopback' = everything the computer plays, i.e. the other people on the call.
  // Windows: WASAPI loopback. macOS 14.2+: CoreAudio tap (Electron 39+), which needs
  // NSAudioCaptureUsageDescription and the "System Audio Recording" permission.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      const preferred = preferredCaptureSourceId && sources.find((source) => source.id === preferredCaptureSourceId);
      const videoSource = preferred || sources.find((source) => source.id.startsWith('screen:')) || sources[0];
      preferredCaptureSourceId = null;
      if (!videoSource) {
        callback({});
        return;
      }
      callback(request.audioRequested ? { video: videoSource, audio: 'loopback' } : { video: videoSource });
    }).catch(() => callback({}));
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

  configurePipeline({
    emit: emitToRenderer,
    isLive: (dbId) => [...meetingSessions.values()].some((state) => state.dbId === dbId),
    onTranscript: (meeting, entries) => {
      // Uploaded recordings get an AI title once their transcript exists.
      if (meeting.source === 'upload' && /^(Uploaded|Untitled)/.test(meeting.title) && entries.length > 0) {
        void autoGenerateTitle(meeting.id, entries).catch(() => {});
      }
    },
  });
  // Finish anything left mid-way when the app last closed (lid shut, offline...).
  setTimeout(() => void resumePendingMeetings(), 3000);

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

// ── Accounts ──────────────────────────────────────────────────────────────
// The signed-in user lives in the main process; account changes are checked
// against it here, never against what the renderer claims.
let currentUserId = null;

function requireUser() {
  const user = currentUserId ? getUserById(currentUserId) : null;
  if (!user) throw new Error('Please sign in again.');
  return user;
}

// Return { success, error } instead of throwing so the UI shows the real reason.
function accountResult(fn) {
  try {
    return { success: true, ...fn() };
  } catch (error) {
    console.error('[Accounts]', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

registerGuardedHandle('auth-login', async (_event, payload) => accountResult(() => {
  const result = loginUser(payload?.email, payload?.password);
  if (!result.success) throw new Error(result.error);
  currentUserId = result.user.id;
  return { user: result.user };
}));

registerGuardedHandle('auth-needs-setup', async () => needsFirstRunSetup());

registerGuardedHandle('auth-first-run-setup', async (_event, payload) => accountResult(() => {
  const user = createFirstAdmin(payload ?? {});
  currentUserId = user.id;
  return { user };
}));

registerGuardedHandle('auth-logout', async () => {
  if (meetingSessions.size > 0) {
    throw new Error('Stop the recording before signing out.');
  }
  currentUserId = null;
  return { success: true };
});

registerGuardedHandle('auth-me', async () => accountResult(() => ({ user: requireUser() })));

registerGuardedHandle('users-list', async () => accountResult(() => {
  if (!requireUser().isAdmin) throw new Error('Only an admin can view all accounts.');
  return { users: listUsers() };
}));

registerGuardedHandle('users-create', async (_event, payload) => accountResult(() => {
  if (!requireUser().isAdmin) throw new Error('Only an admin can create accounts.');
  return { user: createUser(payload ?? {}) };
}));

registerGuardedHandle('users-update', async (_event, { userId, ...changes } = {}) => accountResult(() => (
  { user: updateUser(requireUser(), Number(userId), changes) }
)));

registerGuardedHandle('users-delete', async (_event, { userId } = {}) => accountResult(() => {
  const actor = requireUser();
  deleteUser(actor, Number(userId));
  if (actor.id === Number(userId)) currentUserId = null;
  return {};
}));

registerGuardedHandle('update-listener-name', async (_event, payload) => {
  const { updateListenerName } = await import('./db.js');
  return updateListenerName(payload.userId, payload.listenerName);
});

registerGuardedHandle('get-app-settings', async () => getAppSettings());

registerGuardedHandle('update-app-settings', async (_event, payload) => updateAppSettings(payload));

// Credentials: the renderer can write secrets but only ever reads a masked status.
registerGuardedHandle('get-credentials-status', async () => getCredentialsStatus());

registerGuardedHandle('update-credentials', async (_event, payload) => {
  if (!requireUser().isAdmin) throw new Error('Only an admin can change AI credentials.');
  const patch = {};
  for (const key of ['gcpProjectId', 'serviceAccountJson', 'sarvamApiKey', 'geminiApiKey']) {
    if (typeof payload?.[key] === 'string') patch[key] = payload[key];
  }
  return updateCredentials(patch);
});

// macOS permissions (walkthrough). No-ops elsewhere.
registerGuardedHandle('request-microphone-access', async () => {
  if (process.platform !== 'darwin') return true;
  return systemPreferences.askForMediaAccess('microphone');
});

async function openMacPrivacyPane(pane) {
  const { shell } = await import('electron');
  // "Screen & System Audio Recording" (macOS 15) lives under the screen-capture anchor.
  const anchor = pane === 'microphone' ? 'Privacy_Microphone' : 'Privacy_ScreenCapture';
  await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${anchor}`);
}

registerGuardedHandle('open-mac-privacy-settings', async (_event, pane) => {
  if (process.platform !== 'darwin') return false;
  await openMacPrivacyPane(pane);
  return true;
});

// Current macOS permission state, for the startup alert and Settings.
registerGuardedHandle('get-mac-permissions', async () => {
  if (process.platform !== 'darwin') return { isMac: false };
  return {
    isMac: true,
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
    screen: systemPreferences.getMediaAccessStatus('screen'),
  };
});

// Ask macOS for its own pop-up where it still allows one; otherwise open the right
// System Settings pane. `promptOnly` never opens System Settings (used at startup).
registerGuardedHandle('request-mac-permission', async (_event, kind, { promptOnly = false } = {}) => {
  if (process.platform !== 'darwin') return { granted: true, openedSettings: false };
  if (kind === 'microphone') {
    const before = systemPreferences.getMediaAccessStatus('microphone');
    if (before === 'not-determined') {
      return { granted: await systemPreferences.askForMediaAccess('microphone'), openedSettings: false };
    }
    if (before === 'granted') return { granted: true, openedSettings: false };
    if (!promptOnly) await openMacPrivacyPane('microphone');
    return { granted: false, openedSettings: !promptOnly };
  }
  if (systemPreferences.getMediaAccessStatus('screen') === 'granted') return { granted: true, openedSettings: false };
  // Listing screens makes macOS show its Screen Recording prompt the first time.
  try {
    await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
  } catch {
    // Ignored: the status check below decides.
  }
  const granted = systemPreferences.getMediaAccessStatus('screen') === 'granted';
  if (!granted && !promptOnly) await openMacPrivacyPane('screen');
  return { granted, openedSettings: !granted && !promptOnly };
});

registerGuardedHandle('relaunch-app', async () => {
  app.relaunch();
  app.exit(0);
});

registerGuardedHandle('get-meeting-cost', async (_event, { dbId } = {}) => {
  const meeting = getDB().prepare('SELECT * FROM Meetings WHERE id = ?').get(dbId);
  if (!meeting) return null;
  const artifacts = await readArtifactsFile(meeting.artifacts_path);
  return computeMeetingCost({
    artifacts,
    startTimeMs: meeting.start_time_ms,
    endTimeMs: meeting.end_time_ms,
  });
});

registerGuardedHandle('test-ai-connection', async () => {
  try {
    return { ok: true, ...(await testGeminiConnection()) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

registerGuardedHandle('open-in-explorer', async (_event, filePath) => {
  const { shell } = await import('electron');
  if (fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
  }
});

registerGuardedHandle('set-capture-source', async (_event, sourceId) => {
  preferredCaptureSourceId = typeof sourceId === 'string' && sourceId ? sourceId : null;
  return true;
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
  if (!sessionState?.writer || !buffer) return;

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
  if (!sessionState?.writer) return;
  await sessionState.writer.waitForIdle();
});

registerGuardedHandle('start-meeting', async (_event, {
  title, recordScreen: requestedRecordScreen, clientId = null, projectId = null, agenda = '', diarize: requestedDiarize,
}) => {
  const db = getDB();
  // Per-meeting choice (in person = audio only) wins over the Settings default.
  const recordScreen = typeof requestedRecordScreen === 'boolean'
    ? requestedRecordScreen
    : getAppSettings().screenRecordingEnabled;
  const startTime = Date.now();
  const dateIso = new Date(startTime).toISOString();
  const meetingId = startTime;

  const nameBase = getFinalFileName(startTime, title);
  const meetingFolder = path.join(getRecordingsDir(), nameBase);
  if (!fs.existsSync(meetingFolder)) {
    fs.mkdirSync(meetingFolder, { recursive: true });
  }

  const tempPath = recordScreen ? path.join(meetingFolder, 'temp_video.bin') : null;
  // Per-meeting choice from the start sheet; Settings is only the default.
  const diarize = typeof requestedDiarize === 'boolean' ? requestedDiarize : getAppSettings().diarizationEnabled;
  // Meeting audio (mic + computer sound) is always kept as an MP3: it is the
  // playable recording for in-person meetings and the input for speaker detection.
  const pcmPath = path.join(meetingFolder, 'meeting_audio.pcm');
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
      artifacts_path,
      client_id,
      project_id,
      agenda,
      source,
      processing_state,
      batch_diarize
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', 'recording', ?)
  `).run(
    title || 'Untitled Meeting',
    dateIso,
    startTime,
    null,
    tempPath,
    null,
    transcriptPath,
    artifactsPath,
    clientId ? Number(clientId) : null,
    projectId ? Number(projectId) : null,
    String(agenda ?? '').trim() || null,
    diarize ? 1 : 0,
  );

  const dbId = Number(info.lastInsertRowid);
  const meetingContext = { clientId, projectId, agenda };
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
    writer: recordScreen ? new AsyncChunkWriter(tempPath, { onError: (error) => reportWriteFailure(meetingId, 'screen video', error) }) : null,
    pcmPath,
    audioWriter: pcmPath ? new AsyncChunkWriter(pcmPath, { onError: (error) => reportWriteFailure(meetingId, 'meeting audio', error) }) : null,
    diarize,
    recordScreen,
    transcriptEntries: [],
    status: 'recording',
    contextText: buildMeetingContext(meetingContext).text,
    liveContextText: buildMeetingContext(meetingContext, { maxChars: AI_CONFIG.liveContextMaxChars }).text,
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
    recordScreen,
    title: title || 'Untitled Meeting',
  };
});

registerGuardedHandle('start-transcription', async (_event, { meetingId }) => {
  try {
    await startTranscription(meetingId, {
      mainWindow,
      onFinalEntry: (_entry, allEntries) => {
        const sessionState = getMeetingSession(meetingId);
        if (!sessionState) return;
        sessionState.transcriptEntries = allEntries;
        aiService.handleTranscriptEntry(meetingId);
      },
    });
  } catch (error) {
    // The recording itself still works; the transcript is rebuilt from it afterwards.
    console.error('[Main] Live transcription could not start:', error.message);
    const sessionState = getMeetingSession(meetingId);
    if (sessionState) sessionState.sttStartFailed = true;
    emitToRenderer('transcription-status', {
      meetingId,
      state: 'lost',
      detail: 'Live transcript unavailable. The recording continues and is transcribed after the meeting.',
    });
  }
});

registerGuardedEvent('send-audio-chunk', (_event, message) => {
  if (!message?.buffer) return;
  if (!audioDiagnostics.has(message.meetingId)) {
    audioDiagnostics.add(message.meetingId);
    console.log(`[Audio] First audio chunk received in main for meeting ${message.meetingId}`);
  }
  sendChunk(message.meetingId, message.buffer);
  const sessionState = getMeetingSession(message.meetingId);
  if (sessionState?.audioWriter && !sessionState.audioWriter.finalizing) {
    sessionState.audioWriter.enqueue(message.buffer);
  }
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

  audioDiagnostics.delete(meetingId);

  if (sessionState.artifactsPath) {
    // Sarvam reports the billed audio duration at session end; the cost view uses it.
    // `incomplete` makes the pipeline rebuild the transcript from the recording.
    const stt = { ...(result.stt ?? { provider: 'sarvam', billedAudioSeconds: 0 }), incomplete: Boolean(result.incomplete || sessionState.sttStartFailed) };
    await updateArtifactsFile(sessionState.artifactsPath, (current) => ({
      ...current,
      usage: { ...(current.usage ?? {}), stt },
    })).catch((error) => console.warn('[Main] Could not record STT usage:', error?.message || error));
  }

  sessionState.transcriptEntries = result.entries;
  sessionState.sttHealthy = result.healthy === true;
  // Highlights and minutes start in stop-meeting via the resumable pipeline.

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

// Disk full / permission errors while recording: tell the UI, keep what was written.
function reportWriteFailure(meetingId, what, error) {
  emitToRenderer('transcription-status', {
    meetingId,
    state: 'lost',
    detail: `Could not save the ${what} to disk (${error.code || error.message}). Everything recorded so far is kept; free up space and start a new recording.`,
  });
}

// Recordings shorter than this, or with no speech at all, are not kept.
const MIN_MEETING_MS = 15_000;

async function discardMeeting(sessionState, meetingId, dbId) {
  await sessionState.writer?.finalize().catch(() => {});
  await sessionState.audioWriter?.finalize().catch(() => {});
  meetingSessions.delete(meetingId);
  aiService.unregisterMeeting(meetingId);
  videoChunkDiagnostics.delete(meetingId);
  getDB().prepare('DELETE FROM Meetings WHERE id = ?').run(dbId);
  await fsPromises.rm(sessionState.meetingFolder, { recursive: true, force: true }).catch((error) => {
    console.warn('[Main] Could not remove the discarded meeting folder:', error.message);
  });
}

// Start failed part-way: close everything opened for it and remove the meeting.
registerGuardedHandle('cancel-meeting', async (_event, { meetingId, dbId } = {}) => {
  const sessionState = getMeetingSession(meetingId);
  await stopTranscription(meetingId, { dbId, transcriptPath: null }).catch(() => {});
  audioDiagnostics.delete(meetingId);
  if (sessionState) {
    await discardMeeting(sessionState, meetingId, dbId);
  } else if (dbId) {
    getDB().prepare("DELETE FROM Meetings WHERE id = ? AND processing_state = 'recording'").run(dbId);
  }
  return true;
});

registerGuardedHandle('stop-meeting', async (_event, { meetingId, dbId, startTime, title }) => {
  const sessionState = getMeetingSession(meetingId);
  if (!sessionState) {
    return null;
  }

  const durationMs = Date.now() - sessionState.startTime;
  const spokenWords = (sessionState.transcriptEntries ?? [])
    .reduce((count, entry) => count + String(entry.text ?? '').trim().split(/\s+/).filter(Boolean).length, 0);
  // "Silent" only counts when live transcription actually worked and no second
  // pass is coming. Otherwise the audio is kept and transcribed in batch.
  const confirmedSilent = spokenWords === 0 && sessionState.sttHealthy === true && !sessionState.diarize;
  if (durationMs < MIN_MEETING_MS || confirmedSilent) {
    await discardMeeting(sessionState, meetingId, dbId);
    return {
      discarded: true,
      discardReason: durationMs < MIN_MEETING_MS
        ? `That recording was under ${Math.round(MIN_MEETING_MS / 1000)} seconds, so it was not saved.`
        : 'No speech was picked up, so the recording was not saved. Check the microphone and try again.',
    };
  }

  if (sessionState.writer) {
    await sessionState.writer.finalize();
  }
  if (sessionState.tempPath && fs.existsSync(sessionState.tempPath)) {
    await fsyncFile(sessionState.tempPath);
  }

  const nameBase = getFinalFileName(startTime, title);
  const finalName = sessionState.recordScreen ? `${nameBase}.mp4` : null;
  let finalPath = sessionState.recordScreen
    ? path.join(sessionState.meetingFolder, finalName)
    : null;

  if (sessionState.tempPath && finalPath && fs.existsSync(sessionState.tempPath)) {
    try {
      await finalizeVideoMp4(sessionState.tempPath, finalPath);
      fs.unlinkSync(sessionState.tempPath);
    } catch (error) {
      // Keep the raw recording rather than lose it; it still plays inside the app.
      console.error('[Main] Could not convert the recording to MP4:', error.message);
      const fallbackPath = finalPath.replace(/\.mp4$/, '.webm');
      fs.renameSync(sessionState.tempPath, fallbackPath);
      finalPath = fallbackPath;
    }
  }

  sessionState.endTime = Date.now();
  sessionState.status = 'stopped';

  // Meeting audio -> compact MP3 (playable everywhere, used for speaker detection).
  let audioPath = null;
  if (sessionState.audioWriter) {
    try {
      await sessionState.audioWriter.finalize();
      audioPath = path.join(sessionState.meetingFolder, `${nameBase}.mp3`);
      await pcmToMp3(sessionState.pcmPath, audioPath);
      await fsPromises.rm(sessionState.pcmPath, { force: true });
    } catch (error) {
      console.error('[Main] Could not prepare meeting audio for speaker detection:', error.message);
      audioPath = null;
    }
  }

  getDB().prepare(`
    UPDATE Meetings
    SET video_file_path = ?, audio_file_path = ?, end_time_ms = ?, transcript_path = ?, artifacts_path = ?,
        processing_state = 'analyzing', processing_note = 'Writing highlights'
    WHERE id = ?
  `).run(
    finalPath,
    audioPath,
    sessionState.endTime,
    sessionState.transcriptPath,
    sessionState.artifactsPath,
    dbId,
  );

  meetingSessions.delete(meetingId);
  aiService.unregisterMeeting(meetingId);

  // Highlights + minutes start now; speaker detection (if on) follows.
  // Interrupted work resumes on the next launch.
  if (getAppAccessSnapshot().allowed) {
    void processMeeting(dbId);
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
    recordScreen: sessionState.recordScreen,
    endTime: sessionState.endTime,
    title: sessionState.title,
  };
});

registerGuardedHandle('get-meetings', async () => {
  const db = getDB();
  return db.prepare(`
    SELECT m.*, c.name AS client_name, p.name AS project_name
    FROM Meetings m
    LEFT JOIN Clients c ON c.id = m.client_id
    LEFT JOIN Projects p ON p.id = m.project_id
    ORDER BY m.date DESC
  `).all();
});

registerGuardedHandle('retry-meeting-processing', async (_event, { dbId } = {}) => {
  getDB().prepare("UPDATE Meetings SET processing_state = 'analyzing', processing_note = 'Retrying' WHERE id = ?").run(dbId);
  void processMeeting(Number(dbId));
  return { success: true };
});

registerGuardedHandle('update-meeting-context', async (_event, { dbId, clientId = null, projectId = null, agenda = '' } = {}) => {
  getDB().prepare('UPDATE Meetings SET client_id = ?, project_id = ?, agenda = ? WHERE id = ?')
    .run(clientId ? Number(clientId) : null, projectId ? Number(projectId) : null, String(agenda ?? '').trim() || null, dbId);
  return { success: true };
});

// ── Clients, projects, documents ───────────────────────────────────────────
function workspaceResult(fn) {
  return Promise.resolve().then(fn).then(
    (value) => ({ success: true, value }),
    (error) => ({ success: false, error: error instanceof Error ? error.message : String(error) }),
  );
}

registerGuardedHandle('workspace-list', async () => ({ clients: listClients(), projects: listProjects() }));
registerGuardedHandle('client-save', async (_event, payload) => workspaceResult(() => saveClient(payload ?? {})));
registerGuardedHandle('client-delete', async (_event, { id }) => workspaceResult(() => deleteClient(Number(id))));
registerGuardedHandle('project-save', async (_event, payload) => workspaceResult(() => saveProject(payload ?? {})));
registerGuardedHandle('project-delete', async (_event, { id }) => workspaceResult(() => deleteProject(Number(id))));
registerGuardedHandle('docs-list', async (_event, { ownerType, ownerId }) => listDocs(ownerType, Number(ownerId)));
registerGuardedHandle('doc-delete', async (_event, { id }) => workspaceResult(() => deleteDoc(Number(id))));
registerGuardedHandle('doc-add-note', async (_event, { ownerType, ownerId, title, text }) => (
  workspaceResult(() => addDocFromText(ownerType, Number(ownerId), title, text))
));
registerGuardedHandle('doc-add-files', async (_event, { ownerType, ownerId }) => workspaceResult(async () => {
  const picked = await dialog.showOpenDialog(mainWindow, {
    title: 'Add documents',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Documents', extensions: SUPPORTED_DOC_EXTENSIONS.map((ext) => ext.slice(1)) }],
  });
  if (picked.canceled) return { added: [], failed: [] };
  const added = [];
  const failed = [];
  for (const filePath of picked.filePaths) {
    try {
      added.push(await addDocFromFile(ownerType, Number(ownerId), filePath));
    } catch (error) {
      failed.push({ fileName: path.basename(filePath), error: error.message });
    }
  }
  return { added, failed };
}));

// ── Upload a recorded meeting (audio only, or video with audio) ────────────
const MEDIA_EXTENSIONS = ['mp3', 'm4a', 'wav', 'aac', 'ogg', 'opus', 'flac', 'wma', 'amr', 'mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'];

registerGuardedHandle('pick-recording-file', async () => {
  const picked = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a meeting recording',
    properties: ['openFile'],
    filters: [{ name: 'Audio or video', extensions: MEDIA_EXTENSIONS }],
  });
  if (picked.canceled || !picked.filePaths[0]) return null;
  const filePath = picked.filePaths[0];
  const info = await probeMedia(filePath);
  return { filePath, fileName: path.basename(filePath), ...info };
});

registerGuardedHandle('upload-recording', async (_event, payload = {}) => workspaceResult(async () => {
  const { filePath, title, clientId = null, projectId = null, agenda = '', diarize } = payload;
  if (!filePath || !fs.existsSync(filePath)) throw new Error('Recording file not found.');
  const info = await probeMedia(filePath);
  if (!info.hasAudio) throw new Error('That file has no audio track.');
  if (info.durationSeconds && info.durationSeconds > 2 * 3600) {
    throw new Error('Recordings longer than 2 hours are not supported yet. Trim the file and try again.');
  }

  const durationMs = Math.round((info.durationSeconds ?? 0) * 1000);
  const fileStat = await fsPromises.stat(filePath);
  // Date the meeting by when the recording was made (file time), not upload time.
  const endTime = Math.round(Math.min(fileStat.mtimeMs || Date.now(), Date.now()));
  const startTime = endTime - durationMs;
  const cleanTitle = String(title ?? '').trim() || `Uploaded: ${path.parse(filePath).name}`;
  const nameBase = getFinalFileName(startTime, cleanTitle);
  // Each import gets its own folder, even when the same file is imported twice.
  let meetingFolder = path.join(getRecordingsDir(), nameBase);
  for (let n = 2; fs.existsSync(meetingFolder); n += 1) {
    meetingFolder = path.join(getRecordingsDir(), `${nameBase}-${n}`);
  }
  await fsPromises.mkdir(meetingFolder, { recursive: true });

  // Keep the original (a video stays playable), plus a compact speech MP3 for Sarvam.
  const originalCopy = path.join(meetingFolder, `original${path.extname(filePath).toLowerCase()}`);
  await fsPromises.copyFile(filePath, originalCopy);
  const audioPath = path.join(meetingFolder, `${nameBase}.mp3`);
  await extractSpeechMp3(originalCopy, audioPath);

  const useDiarization = typeof diarize === 'boolean' ? diarize : getAppSettings().diarizationEnabled;
  const transcriptPath = path.join(meetingFolder, 'transcript.json');
  const artifactsPath = path.join(meetingFolder, 'artifacts.json');
  const meetingInfo = getDB().prepare(`
    INSERT INTO Meetings (
      title, date, start_time_ms, end_time_ms, video_file_path, audio_file_path, transcript_path, artifacts_path,
      client_id, project_id, agenda, source, processing_state, processing_note, batch_diarize
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'upload', 'transcribing', 'Preparing recording', ?)
  `).run(
    cleanTitle,
    new Date(startTime).toISOString(),
    startTime,
    endTime,
    info.hasVideo ? originalCopy : null,
    audioPath,
    transcriptPath,
    artifactsPath,
    clientId ? Number(clientId) : null,
    projectId ? Number(projectId) : null,
    String(agenda ?? '').trim() || null,
    useDiarization ? 1 : 0,
  );
  const dbId = Number(meetingInfo.lastInsertRowid);
  void processMeeting(dbId);
  return { dbId, title: cleanTitle };
}));

// ── Ask across meetings ────────────────────────────────────────────────────
registerGuardedHandle('ask-all-meetings', async (_event, payload = {}) => workspaceResult(() => askAcrossMeetings(payload)));

registerGuardedHandle('get-meeting-artifacts', async (_event, { dbId }) => {
  const db = getDB();
  const meeting = db.prepare(`
    SELECT m.*, c.name AS client_name, p.name AS project_name
    FROM Meetings m LEFT JOIN Clients c ON c.id = m.client_id LEFT JOIN Projects p ON p.id = m.project_id
    WHERE m.id = ?
  `).get(dbId);
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
    webSearch: payload.webSearch === true,
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
    tier: 'fast',
    prompt: [
      'Generate a short, professional meeting title from this transcript excerpt.',
      'Return JSON only: {"title": "string"}',
      'Title: 3-8 words, main topic, professional language, no dates.',
      '',
      'Transcript:',
      sampleLines,
    ].join('\n'),
    maxOutputTokens: 1024, // headroom for reasoning tokens; 100 truncated the JSON
    usageFile: meeting.artifacts_path,
    purpose: 'title',
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
    tier: 'fast',
    prompt: [
      'Generate a short, professional meeting title from this transcript excerpt.',
      'Return JSON only: {"title": "string"}',
      'Title: 3-8 words, main topic, professional language, no dates.',
      '',
      'Transcript:',
      sampleLines,
    ].join('\n'),
    maxOutputTokens: 1024,
    usageFile: getDB().prepare('SELECT artifacts_path FROM Meetings WHERE id = ?').get(dbId)?.artifacts_path ?? null,
    purpose: 'title',
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
