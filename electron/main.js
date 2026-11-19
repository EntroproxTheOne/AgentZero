import dotenv from 'dotenv';
import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, Notification, session, systemPreferences } from 'electron';
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
import { configurePipeline, emitArtifacts, levelsPathFor, processMeeting, resumePendingMeetings } from './pipeline.js';
import { labelLiveWindow, micShare, remoteNameHint } from './speakers.js';
import { askMeeting, deleteTemplate, listTemplates, runTemplate, saveTemplate } from './ai/meetingAsk.js';
import { editExtractionItem, syncMeetingItems } from './ai/extraction.js';
import { submitBatchJob, waitForBatchJob } from './transcription/sarvamBatch.js';
import { perHourRates } from './ai/cost.js';
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
      const wanted = preferredCaptureSourceId;
      preferredCaptureSourceId = null;
      const preferred = wanted && sources.find((source) => source.id === wanted);
      if (wanted && !preferred) {
        callback({});
        return;
      }
      const videoSource = preferred || sources.find((source) => source.id.startsWith('screen:')) || sources[0];
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

let closingWithRecording = false;

/** Close every open recording's files so the next launch can recover and process it. */
async function saveOpenRecordings() {
  for (const [meetingId, sessionState] of [...meetingSessions.entries()]) {
    await stopTranscription(meetingId, { dbId: sessionState.dbId, transcriptPath: sessionState.mode === 'live' ? sessionState.transcriptPath : null }).catch(() => {});
    await sessionState.levelsWriter?.finalize().catch(() => {});
    await sessionState.writer?.finalize().catch(() => {});
    await sessionState.audioWriter?.finalize().catch(() => {});
    aiService.unregisterMeeting(meetingId);
    meetingSessions.delete(meetingId);
  }
}

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
      // The recording's video is drawn on a timer; keep it running while the app is behind the meeting window.
      backgroundThrottling: false,
    },
    backgroundColor: '#ffffff',
  });

  // Closing the window mid-meeting: ask, then save what was recorded (it is
  // transcribed like any recording) instead of leaving a half-open session.
  mainWindow.on('close', (event) => {
    if (meetingSessions.size === 0 || closingWithRecording) return;
    event.preventDefault();
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['Keep recording', 'Stop and close'],
      defaultId: 0,
      cancelId: 0,
      message: 'A meeting is still recording.',
      detail: 'Stop and close saves what was recorded so far and processes it next time the app opens.',
    });
    if (choice !== 1) return;
    closingWithRecording = true;
    void saveOpenRecordings().finally(() => mainWindow?.close());
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
  const sources = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 160, height: 90 } });
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
  title, recordScreen: requestedRecordScreen, clientId = null, projectId = null, agenda = '', mode: requestedMode, online = true,
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
  // Notes (default): record, then one diarized batch pass. Live: streaming captions.
  const mode = requestedMode === 'live' || requestedMode === 'notes' ? requestedMode : getAppSettings().recordingMode;
  const owner = requireUser();
  const ownerName = (owner.listener_name || owner.username || 'You').trim();
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
      batch_diarize,
      recording_mode,
      owner_name,
      capture_mode
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', 'recording', 0, ?, ?, ?)
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
    mode,
    ownerName,
    online ? 'online' : 'in-person',
  );

  const dbId = Number(info.lastInsertRowid);
  const clientName = clientId ? getDB().prepare('SELECT name FROM Clients WHERE id = ?').get(Number(clientId))?.name ?? null : null;
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
    mode,
    ownerName,
    remoteName: remoteNameHint({ clientName, title }) || 'Client',
    // Mic / computer-sound loudness every 100 ms (speaker mapping). Recent frames stay in memory for Live labels.
    levelsWriter: new AsyncChunkWriter(path.join(meetingFolder, 'levels.bin'), { onError: (error) => console.warn('[Main] levels.bin:', error.message) }),
    recentLevels: [],
    audioStartEpoch: null,
    // The mode the meeting started in (it can switch Notes -> Live later).
    startedMode: mode,
    pcmBytes: 0,
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
    mode,
    title: title || 'Untitled Meeting',
  };
});

// Mic and computer-sound loudness from the renderer: flat [t, mic, sys, t, mic, sys, ...].
registerGuardedEvent('capture-levels', (_event, { meetingId, startEpoch, frames } = {}) => {
  const sessionState = getMeetingSession(meetingId);
  if (!sessionState || !Array.isArray(frames) || frames.length < 3) return;
  if (startEpoch && !sessionState.audioStartEpoch) sessionState.audioStartEpoch = Number(startEpoch);
  const floats = Float32Array.from(frames.map(Number));
  sessionState.levelsWriter?.enqueue(Buffer.from(floats.buffer));
  for (let index = 0; index + 2 < floats.length; index += 3) {
    sessionState.recentLevels.push([floats[index], floats[index + 1], floats[index + 2]]);
  }
  if (sessionState.recentLevels.length > 1200) sessionState.recentLevels.splice(0, sessionState.recentLevels.length - 600);
});

/** Live mode: label a streamed utterance You / Client from the loudness just before it arrived. */
function labelLiveEntry(sessionState, entry) {
  const words = String(entry.transcript ?? '').split(/\s+/).filter(Boolean).length;
  const offsetMs = sessionState.audioStartEpoch ? Date.now() - sessionState.audioStartEpoch : null;
  // Sarvam finalises ~0.7 s after speech ends; ~2.5 words per second.
  const side = offsetMs === null ? null : labelLiveWindow(sessionState.recentLevels, offsetMs - 700, Math.max(1200, words * 400));
  const last = sessionState.lastLiveSide ?? null;
  const resolved = side ?? last;
  if (side) sessionState.lastLiveSide = side;
  return {
    ...entry,
    source: resolved === 'local' ? 'you' : 'meeting',
    speakerLabel: resolved === 'local' ? sessionState.ownerName : resolved === 'remote' ? sessionState.remoteName : 'Speaker',
    liveSide: side,
    offsetMs,
  };
}

async function startLiveTranscription(meetingId) {
  const sessionState = getMeetingSession(meetingId);
  if (!sessionState) return;
  try {
    await startTranscription(meetingId, {
      mainWindow,
      labelEntry: (entry) => labelLiveEntry(sessionState, entry),
      onFinalEntry: (_entry, allEntries) => {
        sessionState.transcriptEntries = allEntries;
      },
    });
    aiService.startLive(meetingId);
  } catch (error) {
    // The recording itself still works; the transcript is rebuilt from it afterwards.
    console.error('[Main] Live transcription could not start:', error.message);
    sessionState.sttStartFailed = true;
    emitToRenderer('transcription-status', {
      meetingId,
      state: 'lost',
      detail: 'Live transcript unavailable. The recording continues and is transcribed after the meeting.',
    });
  }
}

/**
 * Notes -> Live during a meeting. Streaming starts now; with catchUp the audio
 * recorded so far is transcribed once in batch (no diarization) and placed
 * before the live part, labelled You / Client from the levels.
 */
registerGuardedHandle('go-live', async (_event, { meetingId, catchUp = false } = {}) => {
  const sessionState = getMeetingSession(meetingId);
  if (!sessionState) throw new Error('No meeting is recording.');
  if (sessionState.mode === 'live') return { ok: true };
  sessionState.mode = 'live';
  getDB().prepare("UPDATE Meetings SET recording_mode = 'live' WHERE id = ?").run(sessionState.dbId);
  const liveStart = new Promise((resolve) => { sessionState.resolveLiveStart = resolve; });
  await startLiveTranscription(meetingId);
  if (sessionState.sttStartFailed) return { ok: false };
  // Chunks arrive every ~250 ms; the first streamed one fixes the boundary.
  const cutBytes = await Promise.race([liveStart, new Promise((resolve) => setTimeout(() => resolve(sessionState.pcmBytes), 5000))]);
  await sessionState.audioWriter?.waitForIdle();
  if (catchUp && cutBytes > 32000) {
    sessionState.catchUpPromise = runCatchUp(sessionState, cutBytes).catch((error) => {
      console.warn('[Main] Catch-up failed:', error.message);
      emitToRenderer('transcription-status', { meetingId, state: 'lost', detail: `Could not transcribe the earlier part now; it is transcribed after the meeting. (${error.message})` });
      sessionState.liveGap = true;
      return [];
    });
  } else if (cutBytes > 32000) {
    // No catch-up: the earlier part is only in the recording, so after the meeting
    // the whole recording is transcribed once (the live transcript alone has a gap).
    sessionState.liveGap = true;
  }
  return { ok: true };
});

async function runCatchUp(sessionState, cutBytes) {
  const folder = sessionState.meetingFolder;
  const partPcm = path.join(folder, 'catchup.pcm');
  const partMp3 = path.join(folder, 'catchup.mp3');
  const handle = await fsPromises.open(sessionState.pcmPath, 'r');
  try {
    const buffer = Buffer.alloc(cutBytes);
    await handle.read(buffer, 0, cutBytes, 0);
    await fsPromises.writeFile(partPcm, buffer);
  } finally {
    await handle.close();
  }
  await pcmToMp3(partPcm, partMp3);
  await fsPromises.rm(partPcm, { force: true });
  // Diarized output comes back as utterances (not single words), each labelled from the levels below.
  const jobId = await submitBatchJob(partMp3, { diarize: true });
  const result = await waitForBatchJob(jobId);
  await fsPromises.rm(partMp3, { force: true });
  const frames = await readLevelsFile(levelsPathFor({ transcript_path: sessionState.transcriptPath }));
  const slots = new Map(frames.map(([t, mic, sys]) => [Math.round(t / 100), [mic, sys]]));
  const entries = result.entries.map((item) => ({ text: item.text, start: item.startSeconds ?? 0, end: item.endSeconds ?? item.startSeconds ?? 0 })).map((segment) => {
    const { share } = micShare(slots, segment.start * 1000, segment.end * 1000);
    const side = share === null ? null : share >= 0.62 ? 'local' : share <= 0.4 ? 'remote' : null;
    return {
      timestamp: new Date(sessionState.startTime + segment.start * 1000).toLocaleTimeString('en-US', { hour12: false }),
      source: side === 'local' ? 'you' : 'meeting',
      speakerLabel: side === 'local' ? sessionState.ownerName : side === 'remote' ? sessionState.remoteName : 'Speaker',
      speakerId: null,
      text: segment.text,
      isFinal: true,
      liveSide: side,
      offsetMs: Math.round(segment.end * 1000),
      catchUp: true,
    };
  });
  await updateArtifactsFile(sessionState.artifactsPath, (current) => ({
    ...current,
    usage: { ...(current.usage ?? {}), sttCatchUp: { billedAudioSeconds: cutBytes / 32000, jobId } },
  })).catch(() => {});
  for (const entry of entries) {
    mainWindow?.webContents?.send('transcript-entry', {
      source: entry.source, speakerId: null, speakerLabel: entry.speakerLabel, transcript: entry.text,
      timestamp: entry.timestamp, isFinal: true, interim: false, catchUp: true,
    });
  }
  return entries;
}

async function readLevelsFile(filePath) {
  const { readLevels } = await import('./speakers.js');
  return readLevels(filePath);
}

registerGuardedHandle('start-transcription', async (_event, { meetingId }) => {
  const sessionState = getMeetingSession(meetingId);
  // Notes mode never streams: the recording is transcribed once after the meeting.
  if (!sessionState || sessionState.mode !== 'live') return;
  await startLiveTranscription(meetingId);
});

registerGuardedEvent('send-audio-chunk', (_event, message) => {
  if (!message?.buffer) return;
  if (!audioDiagnostics.has(message.meetingId)) {
    audioDiagnostics.add(message.meetingId);
    console.log(`[Audio] First audio chunk received in main for meeting ${message.meetingId}`);
  }
  const streamed = sendChunk(message.meetingId, message.buffer);
  const sessionState = getMeetingSession(message.meetingId);
  if (!sessionState) return;
  const bytes = message.buffer.byteLength ?? message.buffer.length ?? 0;
  // Go live: the first streamed chunk marks exactly where the catch-up part ends,
  // so the earlier batch part and the live part neither overlap nor leave a gap.
  if (streamed && sessionState.liveStartByte === undefined) {
    sessionState.liveStartByte = sessionState.pcmBytes;
    sessionState.resolveLiveStart?.(sessionState.liveStartByte);
  }
  sessionState.pcmBytes += bytes;
  if (sessionState.audioWriter && !sessionState.audioWriter.finalizing) {
    sessionState.audioWriter.enqueue(message.buffer);
  }
});

ipcMain.on('log-from-renderer', (_event, level, ...args) => {
  console.log(`[Renderer-${level}]`, ...args);
});

registerGuardedHandle('stop-transcription', async (_event, { meetingId, dbId }) => {
  const sessionState = getMeetingSession(meetingId);
  if (!sessionState) return { transcriptPath: null };
  if (sessionState.mode !== 'live') return { transcriptPath: sessionState.transcriptPath };

  const result = await stopTranscription(meetingId, {
    dbId,
    transcriptPath: sessionState.transcriptPath,
  });

  audioDiagnostics.delete(meetingId);

  if (sessionState.artifactsPath) {
    // Sarvam reports the billed audio duration at session end; the cost view uses it.
    // `incomplete` makes the pipeline rebuild the transcript from the recording.
    const stt = { ...(result.stt ?? { provider: 'sarvam', billedAudioSeconds: 0 }), incomplete: Boolean(result.incomplete || sessionState.sttStartFailed || sessionState.liveGap) };
    await updateArtifactsFile(sessionState.artifactsPath, (current) => ({
      ...current,
      usage: { ...(current.usage ?? {}), stt },
    })).catch((error) => console.warn('[Main] Could not record STT usage:', error?.message || error));
  }

  let entries = result.entries;
  if (sessionState.catchUpPromise) {
    const earlier = await sessionState.catchUpPromise;
    if (earlier.length > 0) {
      entries = [...earlier, ...entries];
      await fsPromises.writeFile(sessionState.transcriptPath, JSON.stringify(entries, null, 2), 'utf8');
    }
  }
  sessionState.transcriptEntries = entries;
  sessionState.sttHealthy = result.healthy === true;
  // The extraction after the meeting also writes the title (no separate call).

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
  await sessionState.levelsWriter?.finalize().catch(() => {});
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
  const confirmedSilent = sessionState.startedMode === 'live' && spokenWords === 0 && sessionState.sttHealthy === true;
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

  // The meeting ends now (not after the file conversions below).
  sessionState.endTime = Date.now();
  sessionState.status = 'stopped';
  await sessionState.levelsWriter?.finalize().catch(() => {});

  // Video -> MP4 and meeting audio -> MP3 run side by side, so Stop returns sooner.
  const convertVideo = async () => {
    if (!(sessionState.tempPath && finalPath && fs.existsSync(sessionState.tempPath))) return;
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
  };
  let audioPath = null;
  const convertAudio = async () => {
    if (!sessionState.audioWriter) return;
    try {
      await sessionState.audioWriter.finalize();
      audioPath = path.join(sessionState.meetingFolder, `${nameBase}.mp3`);
      await pcmToMp3(sessionState.pcmPath, audioPath);
      await fsPromises.rm(sessionState.pcmPath, { force: true });
    } catch (error) {
      console.error('[Main] Could not prepare meeting audio for speaker detection:', error.message);
      audioPath = null;
    }
  };
  await Promise.all([convertVideo(), convertAudio()]);

  getDB().prepare(`
    UPDATE Meetings
    SET video_file_path = ?, audio_file_path = ?, end_time_ms = ?, transcript_path = ?, artifacts_path = ?,
        processing_state = 'transcribing', processing_note = 'Preparing the recording'
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
  getDB().prepare('UPDATE MeetingItems SET client_id = ? WHERE meeting_id = ?').run(clientId ? Number(clientId) : null, dbId);
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
  const { filePath, title, clientId = null, projectId = null, agenda = '' } = payload;
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

  const uploader = requireUser();
  const transcriptPath = path.join(meetingFolder, 'transcript.json');
  const artifactsPath = path.join(meetingFolder, 'artifacts.json');
  const meetingInfo = getDB().prepare(`
    INSERT INTO Meetings (
      title, date, start_time_ms, end_time_ms, video_file_path, audio_file_path, transcript_path, artifacts_path,
      client_id, project_id, agenda, source, processing_state, processing_note, batch_diarize, owner_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'upload', 'transcribing', 'Preparing recording', 1, ?)
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
    (uploader.listener_name || uploader.username || 'You').trim(),
  );
  const dbId = Number(meetingInfo.lastInsertRowid);
  void processMeeting(dbId);
  return { dbId, title: cleanTitle };
}));

// ── After the meeting: Ask, templates, edits, speakers, export ─────────────
function meetingRow(dbId) {
  const meeting = getDB().prepare(`
    SELECT m.*, c.name AS client_name FROM Meetings m LEFT JOIN Clients c ON c.id = m.client_id WHERE m.id = ?
  `).get(Number(dbId));
  if (!meeting) throw new Error('Meeting not found');
  return meeting;
}

registerGuardedHandle('ask-meeting', async (_event, payload = {}) => workspaceResult(() => askMeeting(payload)));
registerGuardedHandle('templates-list', async () => listTemplates());
registerGuardedHandle('template-save', async (_event, payload = {}) => workspaceResult(() => saveTemplate(payload)));
registerGuardedHandle('template-delete', async (_event, { id } = {}) => workspaceResult(() => deleteTemplate(Number(id))));
registerGuardedHandle('template-run', async (_event, payload = {}) => workspaceResult(() => runTemplate(payload)));

registerGuardedHandle('edit-meeting-item', async (_event, { dbId, kind, id, patch } = {}) => workspaceResult(async () => {
  const meeting = meetingRow(dbId);
  const updated = await editExtractionItem({ dbId: meeting.id, artifactsPath: meeting.artifacts_path, title: meeting.title, kind, id, patch });
  emitArtifacts(meeting);
  return updated.extraction;
}));

async function rewriteSpeakerNames(meeting, rename) {
  const entries = await readJsonFile(meeting.transcript_path);
  if (!Array.isArray(entries)) return;
  await fsPromises.writeFile(meeting.transcript_path, JSON.stringify(entries.map(rename), null, 2), 'utf8');
}

/** Rename a speaker once; applied to the transcript, the speaker map and the meeting record. */
registerGuardedHandle('rename-speaker', async (_event, { dbId, from, to } = {}) => workspaceResult(async () => {
  const meeting = meetingRow(dbId);
  const oldName = String(from ?? '').trim();
  const newName = String(to ?? '').trim();
  if (!oldName || !newName || oldName === newName) return true;
  if (meeting.owner_name === oldName) getDB().prepare('UPDATE Meetings SET owner_name = ? WHERE id = ?').run(newName, meeting.id);
  await rewriteSpeakerNames(meeting, (entry) => (entry.speakerLabel === oldName ? { ...entry, speakerLabel: newName } : entry));
  const swap = (value) => (value === oldName ? newName : value);
  const updated = await updateArtifactsFile(meeting.artifacts_path, (current) => {
    const speakers = current.speakerMap?.speakers
      ? Object.fromEntries(Object.entries(current.speakerMap.speakers).map(([id, person]) => [id, { ...person, name: swap(person.name) }]))
      : undefined;
    const extraction = current.extraction ? {
      ...current.extraction,
      decisions: current.extraction.decisions.map((d) => ({ ...d, evidence: d.evidence.map((ev) => ({ ...ev, speaker: swap(ev.speaker) })) })),
      action_items: current.extraction.action_items.map((a) => ({ ...a, owner: swap(a.owner) })),
      documents_requested: current.extraction.documents_requested.map((doc) => ({ ...doc, from: swap(doc.from) })),
    } : current.extraction;
    const speakerMap = current.speakerMap
      ? { ...current.speakerMap, ...(speakers ? { speakers } : {}), ...(current.speakerMap.names ? { names: current.speakerMap.names.map(swap) } : {}) }
      : current.speakerMap;
    return { ...current, speakerMap, extraction };
  });
  // The summary text may still use the old name: show "Update summary".
  if (updated.extraction) await updateArtifactsFile(meeting.artifacts_path, (current) => ({ ...current, extractionStale: true }));
  if (updated.extraction) {
    await editExtractionItem({ dbId: meeting.id, artifactsPath: meeting.artifacts_path, title: meeting.title, kind: 'task', id: '__none__', patch: { delete: true } });
  }
  emitArtifacts(meeting);
  return true;
}));

/**
 * "Is this you?" answer (or a correction from "Wrong speaker?"). Logged for
 * accuracy tracking. A changed owner relabels the transcript and re-runs the record.
 */
registerGuardedHandle('confirm-owner', async (_event, { dbId, speakerId, isOwner } = {}) => workspaceResult(async () => {
  const meeting = meetingRow(dbId);
  const artifacts = await readArtifactsFile(meeting.artifacts_path);
  const map = artifacts?.speakerMap;
  if (!map?.speakers?.[String(speakerId)]) throw new Error('Unknown speaker.');
  const predicted = map.ownerId === String(speakerId);
  getDB().prepare('INSERT INTO SpeakerFeedback (meeting_id, speaker_id, predicted_owner, answer, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(meeting.id, String(speakerId), predicted ? 1 : 0, isOwner ? 'yes' : 'no', map.confidence ?? null, new Date().toISOString());
  // The chosen speaker becomes the owner (named); anyone who had the owner's name gets a neutral one.
  const ownerName = meeting.owner_name || 'You';
  const speakers = { ...map.speakers };
  const newOwnerId = isOwner ? String(speakerId) : null;
  const unchanged = isOwner === predicted && speakers[String(speakerId)]?.isOwner === isOwner;
  let counter = Object.keys(speakers).length + 1;
  for (const [id, person] of Object.entries(speakers)) {
    if (id === newOwnerId) speakers[id] = { ...person, name: ownerName, isOwner: true, side: 'local' };
    else if (person.isOwner || person.name === ownerName || (!isOwner && id === String(speakerId))) {
      const remote = person.side === 'remote' || (typeof person.share === 'number' && person.share <= 0.4);
      speakers[id] = { ...person, side: remote ? 'remote' : person.side, name: remote ? (remoteNameHint({ clientName: meeting.client_name, title: meeting.title }) || 'Client') : `Speaker ${counter}`, isOwner: false };
      counter += 1;
    }
  }
  if (unchanged) {
    await updateArtifactsFile(meeting.artifacts_path, (current) => ({ ...current, speakerMap: { ...current.speakerMap, confirmed: true, needsConfirmation: false } }));
    emitArtifacts(meeting);
    return { changed: false };
  }
  await rewriteSpeakerNames(meeting, (entry) => {
    const person = entry.speakerId === null || entry.speakerId === undefined ? null : speakers[String(entry.speakerId)];
    return person ? { ...entry, speakerLabel: person.name, source: person.isOwner ? 'you' : 'meeting' } : entry;
  });
  await updateArtifactsFile(meeting.artifacts_path, (current) => ({
    ...current,
    speakerMap: { ...current.speakerMap, speakers, ownerId: newOwnerId, confirmed: true, needsConfirmation: false },
    extractionStale: true,
  }));
  getDB().prepare("UPDATE Meetings SET processing_state = 'analyzing', processing_note = 'Updating the record with the corrected speaker' WHERE id = ?").run(meeting.id);
  void processMeeting(meeting.id);
  return { changed: true };
}));

/** "Wrong speaker?" on one transcript line. */
registerGuardedHandle('reassign-line', async (_event, { dbId, lineId, speakerLabel } = {}) => workspaceResult(async () => {
  const meeting = meetingRow(dbId);
  const entries = await readJsonFile(meeting.transcript_path);
  const index = Number(lineId) - 1;
  if (!Array.isArray(entries) || !entries[index]) throw new Error('Line not found.');
  const label = String(speakerLabel ?? '').trim();
  if (!label) throw new Error('Choose a speaker.');
  entries[index] = { ...entries[index], speakerLabel: label, source: label === meeting.owner_name ? 'you' : 'meeting', corrected: true };
  await fsPromises.writeFile(meeting.transcript_path, JSON.stringify(entries, null, 2), 'utf8');
  await updateArtifactsFile(meeting.artifacts_path, (current) => ({ ...current, extractionStale: true }));
  emitArtifacts(meeting);
  return true;
}));

/** Re-run the meeting record (after speaker corrections). */
registerGuardedHandle('refresh-meeting-record', async (_event, { dbId } = {}) => {
  getDB().prepare("UPDATE Meetings SET processing_state = 'analyzing', processing_note = 'Updating the meeting record' WHERE id = ?").run(Number(dbId));
  await updateArtifactsFile(meetingRow(dbId).artifacts_path, (current) => ({ ...current, extractionStale: true })).catch(() => {});
  void processMeeting(Number(dbId));
  return { success: true };
});

/** Live meeting: run the diarization pass on the full recording ("Improve speaker labels"). */
registerGuardedHandle('improve-speakers', async (_event, { dbId } = {}) => workspaceResult(async () => {
  const meeting = meetingRow(dbId);
  if (!meeting.audio_file_path) throw new Error('This meeting has no saved audio.');
  getDB().prepare("UPDATE Meetings SET batch_diarize = 1, processing_state = 'transcribing', processing_note = 'Identifying speakers' WHERE id = ?").run(meeting.id);
  await updateArtifactsFile(meeting.artifacts_path, (current) => {
    const usage = { ...(current.usage ?? {}) };
    delete usage.sttBatch;
    return { ...current, usage, speakerMap: null };
  });
  void processMeeting(meeting.id);
  return true;
}));

registerGuardedHandle('get-cost-rates', async () => perHourRates());

// Recording left running with nobody speaking: bring the app to the front and notify.
registerGuardedHandle('request-attention', async (_event, { title, body } = {}) => {
  if (!mainWindow) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.setAlwaysOnTop(true);
  setTimeout(() => mainWindow?.setAlwaysOnTop(false), 15_000);
  mainWindow.flashFrame(true);
  if (Notification.isSupported()) new Notification({ title: String(title ?? 'AgentZero'), body: String(body ?? '') }).show();
  return true;
});

/** Structured record of one meeting (CRM-ready: client, decisions, tasks with owner/due/status and source lines). */
registerGuardedHandle('export-meeting-json', async (_event, { dbId } = {}) => workspaceResult(async () => {
  const meeting = meetingRow(dbId);
  const artifacts = await readArtifactsFile(meeting.artifacts_path);
  if (!artifacts?.extraction) throw new Error('The meeting record is not ready yet.');
  syncMeetingItems(meeting.id, artifacts.extraction);
  const record = buildMeetingRecord(meeting, artifacts);
  const filePath = path.join(path.dirname(meeting.artifacts_path), `${getFinalFileName(meeting.start_time_ms, meeting.title)}.record.json`);
  await fsPromises.writeFile(filePath, JSON.stringify(record, null, 2), 'utf8');
  return { filePath };
}));

/**
 * The shape a future CRM sync will push (one call per meeting). Kept here so the
 * export and the sync stay identical.
 */
function buildMeetingRecord(meeting, artifacts) {
  const extraction = artifacts.extraction;
  const items = getDB().prepare('SELECT * FROM MeetingItems WHERE meeting_id = ? ORDER BY kind, id').all(meeting.id);
  return {
    schema: 'agentzero.meeting/1',
    meeting: {
      id: meeting.id,
      title: meeting.title,
      startedAt: meeting.start_time_ms ? new Date(meeting.start_time_ms).toISOString() : null,
      endedAt: meeting.end_time_ms ? new Date(meeting.end_time_ms).toISOString() : null,
      owner: meeting.owner_name,
      clientId: meeting.client_id ?? null,
      clientName: meeting.client_name ?? null,
      onlyOwnerSideRecorded: Boolean(artifacts.speakerMap?.oneSided),
    },
    summary: extraction.summary,
    keyPoints: extraction.key_points,
    decisions: items.filter((item) => item.kind === 'decision').map((item) => ({
      id: item.ext_id, topic: item.topic, statement: item.text, status: item.status, clientId: item.client_id, sourceLineId: item.line_id,
    })),
    tasks: items.filter((item) => item.kind === 'task').map((item) => ({
      id: item.ext_id, task: item.text, owner: item.owner, due: item.due, status: item.status, clientId: item.client_id, sourceLineId: item.line_id,
    })),
    figures: extraction.figures,
    documentsRequested: extraction.documents_requested,
    openQuestions: extraction.open_questions,
  };
}

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

  // Through the write queue, so a rename during processing cannot undo the record.
  const meeting = db.prepare('SELECT artifacts_path FROM Meetings WHERE id = ?').get(dbId);
  if (meeting?.artifacts_path && fs.existsSync(meeting.artifacts_path)) {
    await updateArtifactsFile(meeting.artifacts_path, (current) => ({ ...current, title })).catch(() => {});
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

