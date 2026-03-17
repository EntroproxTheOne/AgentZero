/**
 * transcriber.js — Deepgram Nova-3 Multilingual live transcription manager.
 *
 * Uses @deepgram/sdk v5 API:
 *   - createClient / DeepgramClient
 *   - deepgram.listen.live({ ... })   ← v3 API path still valid in v5
 *   - Plain string events: 'open', 'transcript', 'error', 'close'
 *
 * Architecture:
 *  - One Deepgram WebSocket per meeting session (opened on `start-transcription`)
 *  - Receives raw 2-channel interleaved PCM (linear16, 16 kHz) from renderer
 *  - channel 0 = user microphone  → source: "you"
 *  - channel 1 = meeting audio    → source: "meeting" (+ diarize speaker IDs)
 *  - Fires `transcript-entry` events to the renderer window on every is_final result
 *  - On stop: saves all final entries to JSON, updates DB
 */

import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { createRequire } from 'module';
import { getDB } from './db.js';

// Use CJS require to load @deepgram/sdk — the ESM entrypoint in v5
// does not re-export DeepgramClient correctly in Electron's Node ESM context.
const require = createRequire(import.meta.url);
const { DeepgramClient } = require('@deepgram/sdk');

// Active sessions: Map<meetingId, { connection, entries[], mainWindow }>
const sessions = new Map();

function getRecordingsDir() {
  const dir = path.join(app.getPath('documents'), 'AgentZero', 'Recordings');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Open a Deepgram WebSocket for the given meeting.
 * @param {number} meetingId
 * @param {Electron.BrowserWindow} mainWindow
 */
export async function startTranscription(meetingId, mainWindow) {
  if (sessions.has(meetingId)) return;

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    console.warn('[Transcriber] DEEPGRAM_API_KEY not set — transcription disabled');
    return;
  }

  const deepgram = new DeepgramClient({ apiKey });

  // SDK v5: more robust connection method
  console.log('[Transcriber] Connecting to Deepgram...');
  const connection = await deepgram.listen.v1.connect({
    model:           'nova-3',
    language:        'multi',       // Nova-3 multilingual
    multichannel:    true,          // transcribe ch0 and ch1 independently
    channels:        2,             // ch0=mic, ch1=meeting
    encoding:        'linear16',
    sample_rate:     16000,
    diarize:         true,
    smart_format:    true,
    interim_results: true,
    endpointing:     500,
  });

  if (!connection) {
    console.error('[Transcriber] Failed to create Deepgram connection');
    return;
  }

  const entries = [];
  let keepAlive;
  let hasReceivedResponse = false;

  const handleDeepgramMessage = (data) => {
    if (!hasReceivedResponse) {
      console.log(`[Transcriber] First data received from Deepgram for meeting ${meetingId}: ${data.type}`);
      hasReceivedResponse = true;
    }

    // Log Metadata for confirmation
    if (data.type === 'Metadata') {
      console.log('[Transcriber] Metadata received:', JSON.stringify(data));
      return;
    }

    if (data.type !== 'Results' || !data.channel) return;

    const isFinal     = data.is_final;
    const channelIdx  = data.channel_index?.[0] ?? 0;
    const source      = channelIdx === 0 ? 'you' : 'meeting';
    const alt         = data.channel?.alternatives?.[0];
    if (!alt) return;

    const transcript = alt.transcript;
    if (!transcript || transcript.trim() === '') return;

    const words       = alt.words ?? [];
    const speakerId   = (source === 'meeting' && words[0]?.speaker != null)
      ? words[0].speaker
      : null;

    const entry = {
      source,
      speakerId,
      transcript,
      timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
      isFinal,
      interim: !isFinal,
    };

    // Push to renderer for live display
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('transcript-entry', entry);
    }

    // Accumulate final entries for saving
    if (isFinal) {
      const speakerLabel = source === 'you'
        ? 'You'
        : speakerId != null
          ? `Speaker ${speakerId + 1}`
          : 'Meeting';

      entries.push({
        timestamp:   entry.timestamp,
        source, 
        speakerLabel,
        speakerId,
        text:        transcript,
        isFinal:     true,
      });
    }
  };

  // SDK v5 events ─────────────────────────────────────────────────────────
  connection.on('open', () => {
    console.log(`[Transcriber] Deepgram connection open for meeting ${meetingId}`);
    
    // Flush any chunks queued before connection was open
    const session = sessions.get(meetingId);
    if (session && session.chunkQueue.length > 0) {
      console.log(`[Transcriber] Flushing ${session.chunkQueue.length} queued chunks...`);
      while (session.chunkQueue.length > 0) {
        const chunk = session.chunkQueue.shift();
        connection.sendMedia(chunk);
      }
    }
    
    // Start keep-alive interval
    if (keepAlive) clearInterval(keepAlive);
    keepAlive = setInterval(() => {
      if (connection.readyState === 1) { // OPEN
        connection.sendKeepAlive({ type: 'KeepAlive' });
      }
    }, 3000);
  });

  // Listen to the primary 'message' event for all data
  connection.on('message', handleDeepgramMessage);

  connection.on('error', (err) => {
    console.error('[Transcriber] Deepgram error:', err);
  });

  connection.on('close', () => {
    console.log(`[Transcriber] Deepgram connection closed for meeting ${meetingId}`);
    if (keepAlive) clearInterval(keepAlive);
  });

  // CRITICAL: In SDK v5, we must explicitly call connect() to start the stream
  connection.connect();

  sessions.set(meetingId, { 
    connection, 
    entries, 
    mainWindow, 
    keepAlive,
    firstChunkReceived: false,
    chunkQueue: [] 
  });
}

/**
 * Send raw 2-channel interleaved PCM buffer to Deepgram.
 * @param {number} meetingId
 * @param {ArrayBuffer} buffer  — Int16 interleaved [mic0, mtg0, mic1, mtg1, ...]
 */
export function sendChunk(meetingId, buffer) {
  const session = sessions.get(meetingId);
  if (!session) {
    // Silent fail or occasional log to avoid spam
    return;
  }

  if (!session.firstChunkReceived) {
    console.log(`[Transcriber] First audio chunk received for meeting ${meetingId}. Streaming started...`);
    session.firstChunkReceived = true;
  }

  try {
    // SDK v5: handle connection not ready yet (e.g. initial handshake)
    if (session.connection.readyState === 1) { // OPEN
      // Flush queue if any (should already be handled by 'open' event, but defensive)
      while (session.chunkQueue.length > 0) {
        session.connection.sendMedia(session.chunkQueue.shift());
      }
      session.connection.sendMedia(Buffer.from(buffer));
    } else {
      // Buffer the chunk briefly while connecting
      if (session.chunkQueue.length < 50) { // Safety cap (~5-10s of audio)
        session.chunkQueue.push(Buffer.from(buffer));
      }
    }
  } catch (err) {
    console.error('[Transcriber] Error sending chunk:', err);
  }
}

/**
 * Gracefully close Deepgram and save the transcript JSON.
 * @param {number} meetingId
 * @param {number} dbId
 * @param {string} [finalName]
 */
export async function stopTranscription(meetingId, dbId, finalName) {
  const session = sessions.get(meetingId);
  if (!session) return;

  const { connection, entries, keepAlive } = session;

  if (keepAlive) clearInterval(keepAlive);

  try {
    connection.close();
  } catch {
    // already closed
  }

  // Give Deepgram a moment to flush any final results
  await new Promise((resolve) => setTimeout(resolve, 1500));

  if (entries.length > 0) {
    const dir      = getRecordingsDir();
    const filePath = path.join(dir, finalName || `transcript_${meetingId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(entries, null, 2), 'utf-8');
    console.log(`[Transcriber] Transcript saved: ${filePath}`);

    try {
      const db = getDB();
      db.prepare('UPDATE Meetings SET transcript_path = ? WHERE id = ?')
        .run(filePath, dbId);
    } catch (err) {
      console.error('[Transcriber] DB update error:', err);
    }
  }

  sessions.delete(meetingId);
}

/**
 * Stub — WebM chunks are NOT sent to Deepgram (raw PCM pipeline handles transcription).
 */
export async function transcribeChunk(_meetingId, _buffer) {
  // no-op
}
