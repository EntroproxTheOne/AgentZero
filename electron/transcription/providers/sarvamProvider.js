// Sarvam Saaras v4 over the Realtime Streaming API.
// Docs: https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/realtime-streaming
// Verified live 16 Nov 2026: language_code=auto detects per utterance (en-IN / hi-IN
// in one clip); session.end reports the billed audio_duration_s; the server does not
// close the socket after session.end, so we close it ourselves.
//
// Resilience: if the socket drops mid-meeting we reconnect with backoff and buffer
// audio meanwhile (up to MAX_QUEUE_SECONDS). Any audio that could not be streamed
// marks the transcript `incomplete`; the post-meeting pipeline then rebuilds the
// transcript from the saved recording (Sarvam batch) before writing the minutes.
import WebSocket from 'ws';
import {
  buildPersistedEntry,
  createDeferred,
  emitTranscriptEntry,
  getTimestamp,
  wait,
} from '../providerUtils.js';
import { normalizeText } from '../../text/normalize.js';
import { getSarvamApiKey } from '../../credentials.js';

export const SARVAM_MODEL = 'saaras:v4';
const KEEPALIVE_MS = 20_000;
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 30000];
// 16 kHz mono 16-bit: 32,000 bytes per second.
const MAX_QUEUE_SECONDS = 90;
const MAX_QUEUE_BYTES = MAX_QUEUE_SECONDS * 32_000;

function createSarvamUrl() {
  const url = new URL('wss://api.sarvam.ai/speech-to-text-realtime/ws');
  url.searchParams.set('model', SARVAM_MODEL);
  url.searchParams.set('language_code', 'auto');
  url.searchParams.set('mode', 'transcribe');
  url.searchParams.set('sample_rate', '16000');
  url.searchParams.set('encoding', 'linear16');
  return url.toString();
}

function emitStatus(mainWindow, meetingId, state, detail = null) {
  try {
    mainWindow?.webContents?.send('transcription-status', { meetingId, state, detail });
  } catch {
    // Window gone: nothing to tell.
  }
}

export async function createSarvamSession(meetingId, { mainWindow, onFinalEntry, connect = defaultConnect }) {
  const apiKey = getSarvamApiKey();
  if (!apiKey) {
    console.warn('[Transcriber] Sarvam API key not set (Settings → AI), transcription disabled');
    emitStatus(mainWindow, meetingId, 'lost', 'Sarvam API key is not set');
    return null;
  }

  const session = {
    meetingId,
    provider: 'sarvam',
    model: SARVAM_MODEL,
    entries: [],
    queue: [], // { payload, bytes }
    queueBytes: 0,
    socket: null,
    isOpen: false,
    stopping: false,
    lastActivityAt: Date.now(),
    billedAudioSeconds: null,
    lastError: null,
    keepAlive: null,
    reconnects: 0,
    droppedSeconds: 0,
    /** True when some audio never reached Sarvam: the live transcript has gaps. */
    incomplete: false,
    sessionEnd: null,
    closed: null,

    async sendChunk(buffer) {
      const pcm = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
      const payload = JSON.stringify({ event: 'audio_input', audio: pcm.toString('base64') });
      if (session.isOpen && session.socket?.readyState === WebSocket.OPEN) {
        flushQueue();
        session.socket.send(payload);
        session.lastActivityAt = Date.now();
        return;
      }
      // Opening or reconnecting: buffer, dropping the oldest audio past the cap.
      session.queue.push({ payload, bytes: pcm.length });
      session.queueBytes += pcm.length;
      while (session.queueBytes > MAX_QUEUE_BYTES && session.queue.length > 0) {
        const dropped = session.queue.shift();
        session.queueBytes -= dropped.bytes;
        session.droppedSeconds += dropped.bytes / 32_000;
        session.incomplete = true;
      }
    },

    async stop() {
      session.stopping = true;
      clearInterval(session.keepAlive);
      const socket = session.socket;
      if (session.queue.length > 0) session.incomplete = true; // buffered audio never sent
      if (session.isOpen && socket?.readyState === WebSocket.OPEN) {
        try {
          flushQueue();
          socket.send(JSON.stringify({ event: 'end' }));
        } catch (error) {
          console.warn('[Sarvam] Failed to send end event:', error);
        }
        // Wait for the last transcript.final and session.end (carries billed duration).
        await Promise.race([session.sessionEnd.promise, wait(8000)]);
      }
      try {
        socket?.close();
      } catch {
        // ignored
      }
      await Promise.race([session.closed?.promise ?? Promise.resolve(), wait(2000)]);
      return [...session.entries];
    },
  };

  function flushQueue() {
    while (session.queue.length > 0 && session.socket?.readyState === WebSocket.OPEN) {
      const item = session.queue.shift();
      session.queueBytes -= item.bytes;
      session.socket.send(item.payload);
    }
  }

  function handleMessage(rawMessage) {
    let payload;
    try {
      payload = JSON.parse(rawMessage.toString());
    } catch (error) {
      console.warn('[Sarvam] Failed to parse websocket message:', error);
      return;
    }
    switch (payload?.event) {
      case 'transcript.partial': {
        const text = normalizeText(payload.text ?? '');
        if (!text) return;
        emitTranscriptEntry(mainWindow, {
          source: 'meeting', speakerId: null, transcript: text, timestamp: getTimestamp(),
          isFinal: false, interim: true, languageCode: payload.language ?? null, languageProbability: null,
        });
        return;
      }
      case 'transcript.final': {
        const text = normalizeText(payload.text ?? '');
        if (!text) return;
        const entry = {
          source: 'meeting', speakerId: null, transcript: text, timestamp: getTimestamp(),
          isFinal: true, interim: false, languageCode: payload.language ?? null,
          languageProbability: payload.language_confidence ?? null,
        };
        emitTranscriptEntry(mainWindow, entry);
        const persistedEntry = buildPersistedEntry(entry);
        session.entries.push(persistedEntry);
        onFinalEntry?.(persistedEntry, [...session.entries]);
        return;
      }
      case 'session.end':
        if (typeof payload.audio_duration_s === 'number') {
          session.billedAudioSeconds = (session.billedAudioSeconds ?? 0) + payload.audio_duration_s;
        }
        session.sessionEnd?.resolve();
        return;
      case 'error':
        session.lastError = payload.message ?? String(payload.code ?? 'unknown error');
        console.error('[Sarvam] Streaming error:', payload.code, payload.message, payload.is_fatal ? '(fatal)' : '');
        return;
      default:
        // session.begin, vad.*, pong, config.updated
    }
  }

  /** Open one socket. Resolves when open; rejects if it cannot connect. */
  function open() {
    const opened = createDeferred();
    session.sessionEnd = createDeferred();
    session.closed = createDeferred();
    const socket = connect(createSarvamUrl(), apiKey);
    session.socket = socket;

    socket.on('open', () => {
      session.isOpen = true;
      session.lastError = null;
      console.log(`[Sarvam] Realtime socket open for meeting ${meetingId} (${SARVAM_MODEL})`);
      flushQueue();
      clearInterval(session.keepAlive);
      // Keep the session alive across long silences (close code 1008 = inactivity).
      session.keepAlive = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN && Date.now() - session.lastActivityAt > KEEPALIVE_MS) {
          try { socket.send(JSON.stringify({ event: 'ping' })); } catch { /* ignored */ }
        }
      }, KEEPALIVE_MS);
      opened.resolve();
    });
    socket.on('unexpected-response', (_request, response) => {
      const error = new Error(`Sarvam rejected the connection (HTTP ${response.statusCode}). Check the Sarvam API key in Settings.`);
      error.status = response.statusCode;
      session.lastError = error.message;
      opened.reject(error);
    });
    socket.on('message', handleMessage);
    socket.on('error', (error) => {
      console.error('[Transcriber] Sarvam websocket error:', error.message);
      if (!session.isOpen) opened.reject(error);
    });
    socket.on('close', (code, reason) => {
      const wasOpen = session.isOpen;
      session.isOpen = false;
      clearInterval(session.keepAlive);
      session.sessionEnd.resolve();
      session.closed.resolve();
      if (!session.stopping && wasOpen) {
        console.warn(`[Sarvam] Socket closed unexpectedly for meeting ${meetingId}: ${code} ${reason}`);
        void reconnect();
      }
    });
    return opened.promise;
  }

  async function reconnect() {
    emitStatus(mainWindow, meetingId, 'reconnecting');
    for (const delay of RECONNECT_DELAYS_MS) {
      if (session.stopping) return;
      await wait(delay);
      if (session.stopping) return;
      try {
        session.reconnects += 1;
        await open();
        console.log(`[Sarvam] Reconnected for meeting ${meetingId} (attempt ${session.reconnects})`);
        emitStatus(mainWindow, meetingId, 'live');
        return;
      } catch (error) {
        console.warn(`[Sarvam] Reconnect failed for meeting ${meetingId}:`, error.message);
        // A rejected key will not fix itself; stop trying.
        if (error.status && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) break;
      }
    }
    // Live transcript stopped. Audio is still being saved, so the full transcript
    // is rebuilt from the recording after the meeting.
    session.incomplete = true;
    emitStatus(mainWindow, meetingId, 'lost', 'The live transcript stopped. The full transcript will be rebuilt from the recording after the meeting.');
  }

  await open();
  emitStatus(mainWindow, meetingId, 'live');
  return session;
}

function defaultConnect(url, apiKey) {
  return new WebSocket(url, { headers: { 'api-subscription-key': apiKey } });
}
