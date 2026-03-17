import fs from 'fs/promises';
import { createRequire } from 'module';
import { getDB } from './db.js';

const require = createRequire(import.meta.url);
const { DeepgramClient } = require('@deepgram/sdk');

const sessions = new Map();

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPersistedEntry(entry) {
  const speakerLabel = entry.source === 'you'
    ? 'You'
    : entry.speakerId != null
      ? `Speaker ${entry.speakerId + 1}`
      : 'Meeting';

  return {
    timestamp: entry.timestamp,
    source: entry.source,
    speakerLabel,
    speakerId: entry.speakerId,
    text: entry.transcript,
    isFinal: true,
  };
}

export async function startTranscription(meetingId, { mainWindow, onFinalEntry }) {
  if (sessions.has(meetingId)) return;

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    console.warn('[Transcriber] DEEPGRAM_API_KEY not set, transcription disabled');
    return;
  }

  const deepgram = new DeepgramClient({ apiKey });
  const connection = await deepgram.listen.v1.connect({
    model: 'nova-3',
    language: 'multi',
    multichannel: true,
    channels: 2,
    encoding: 'linear16',
    sample_rate: 16000,
    diarize: true,
    smart_format: true,
    interim_results: true,
    endpointing: 500,
  });

  if (!connection) {
    throw new Error('Failed to create Deepgram connection');
  }

  const closeDeferred = createDeferred();
  const session = {
    meetingId,
    connection,
    mainWindow,
    onFinalEntry,
    keepAlive: null,
    entries: [],
    chunkQueue: [],
    firstChunkReceived: false,
    lastResultAt: 0,
    finalizeSentAt: null,
    closeDeferred,
    isOpen: false,
    firstMessageLogged: false,
    firstFinalLogged: false,
    firstQueuedChunkLogged: false,
  };

  sessions.set(meetingId, session);

  const handleMessage = (data) => {
    if (!session.firstMessageLogged) {
      console.log(`[Deepgram] First message received for meeting ${meetingId}: ${data?.type ?? 'Unknown'}`);
      session.firstMessageLogged = true;
    }

    if (data?.type === 'Metadata') {
      return;
    }

    if (data?.type !== 'Results' || !data.channel) {
      return;
    }

    session.lastResultAt = Date.now();

    const isFinal = Boolean(data.is_final);
    const channelIndex = data.channel_index?.[0] ?? 0;
    const source = channelIndex === 0 ? 'you' : 'meeting';
    const alternative = data.channel?.alternatives?.[0];
    if (!alternative?.transcript?.trim()) {
      return;
    }

    const speakerId = source === 'meeting' && alternative.words?.[0]?.speaker != null
      ? alternative.words[0].speaker
      : null;

    const entry = {
      source,
      speakerId,
      transcript: alternative.transcript.trim(),
      timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
      isFinal,
      interim: !isFinal,
    };

    if (session.mainWindow && !session.mainWindow.isDestroyed()) {
      session.mainWindow.webContents.send('transcript-entry', entry);
    }

    if (!isFinal) {
      return;
    }

    const persistedEntry = buildPersistedEntry(entry);
    session.entries.push(persistedEntry);
    if (!session.firstFinalLogged) {
      console.log(`[Deepgram] First final transcript entry received for meeting ${meetingId}`);
      session.firstFinalLogged = true;
    }
    session.onFinalEntry?.(persistedEntry, [...session.entries]);
  };

  connection.on('open', () => {
    session.isOpen = true;
    console.log(`[Deepgram] Socket open for meeting ${meetingId}`);
    while (session.chunkQueue.length > 0) {
      connection.sendMedia(session.chunkQueue.shift());
    }

    if (session.keepAlive) clearInterval(session.keepAlive);
    session.keepAlive = setInterval(() => {
      if (connection.readyState === 1) {
        connection.sendKeepAlive({ type: 'KeepAlive' });
      }
    }, 3000);
  });

  connection.on('message', handleMessage);
  connection.on('error', (error) => {
    console.error('[Transcriber] Deepgram error:', error);
  });
  connection.on('close', () => {
    session.isOpen = false;
    if (session.keepAlive) clearInterval(session.keepAlive);
    session.closeDeferred.resolve();
  });

  connection.connect();
  await connection.waitForOpen();
}

export function sendChunk(meetingId, buffer) {
  const session = sessions.get(meetingId);
  if (!session) return;

  if (!session.firstChunkReceived) {
    session.firstChunkReceived = true;
  }

  const chunkBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (session.connection.readyState === 1 && session.isOpen) {
    while (session.chunkQueue.length > 0) {
      session.connection.sendMedia(session.chunkQueue.shift());
    }
    session.connection.sendMedia(chunkBuffer);
    return;
  }

  if (session.chunkQueue.length < 50) {
    if (!session.firstQueuedChunkLogged) {
      console.log(`[Deepgram] Audio chunk queued before socket open for meeting ${meetingId}`);
      session.firstQueuedChunkLogged = true;
    }
    session.chunkQueue.push(chunkBuffer);
  }
}

export function getTranscriptEntries(meetingId) {
  return sessions.get(meetingId)?.entries ?? [];
}

export async function stopTranscription(meetingId, { dbId, transcriptPath }) {
  const session = sessions.get(meetingId);
  if (!session) {
    return { transcriptPath: null, entries: [] };
  }

  if (session.keepAlive) clearInterval(session.keepAlive);

  if (session.connection.readyState === 1 && session.isOpen) {
    try {
      session.finalizeSentAt = Date.now();
      console.log(`[Deepgram] Finalize sent for meeting ${meetingId}`);
      session.connection.sendFinalize({ type: 'Finalize' });
    } catch (error) {
      console.warn('[Transcriber] Failed to send finalize:', error);
    }
  }

  const finalizeStart = Date.now();
  let quietPeriodReached = false;

  while (Date.now() - finalizeStart < 5000) {
    const timeSinceLastResult = session.lastResultAt === 0
      ? Date.now() - finalizeStart
      : Date.now() - session.lastResultAt;

    if (timeSinceLastResult >= 1200) {
      quietPeriodReached = true;
      break;
    }

    await wait(100);
  }

  if (!quietPeriodReached) {
    console.warn(`[Transcriber] Finalize timeout reached for meeting ${meetingId}, closing connection`);
  }

  try {
    session.connection.close();
  } catch {
    // ignored
  }

  await Promise.race([
    session.closeDeferred.promise,
    wait(2000),
  ]);

  if (transcriptPath) {
    await fs.writeFile(transcriptPath, JSON.stringify(session.entries, null, 2), 'utf8');
    console.log(`[Deepgram] Transcript saved for meeting ${meetingId}: ${transcriptPath}`);
    try {
      const db = getDB();
      db.prepare('UPDATE Meetings SET transcript_path = ? WHERE id = ?')
        .run(transcriptPath, dbId);
    } catch (error) {
      console.error('[Transcriber] Failed to update transcript path:', error);
    }
  }

  sessions.delete(meetingId);

  return {
    transcriptPath,
    entries: session.entries,
  };
}
