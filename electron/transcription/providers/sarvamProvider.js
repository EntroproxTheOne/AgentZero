import WebSocket from 'ws';
import {
  buildPersistedEntry,
  createDeferred,
  emitTranscriptEntry,
  getTimestamp,
  wait,
} from '../providerUtils.js';
import { normalizeText } from '../../text/normalize.js';

function downmixStereoToMono(buffer) {
  const sourceBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (sourceBuffer.byteLength < 4) {
    return sourceBuffer;
  }

  const stereoSamples = new Int16Array(
    sourceBuffer.buffer,
    sourceBuffer.byteOffset,
    Math.floor(sourceBuffer.byteLength / 2),
  );

  const monoBuffer = Buffer.allocUnsafe(Math.floor(stereoSamples.length / 2) * 2);
  for (let index = 0; index < stereoSamples.length; index += 2) {
    const left = stereoSamples[index] ?? 0;
    const right = stereoSamples[index + 1] ?? left;
    const mixed = Math.max(-32768, Math.min(32767, Math.round((left + right) / 2)));
    monoBuffer.writeInt16LE(mixed, index);
  }

  return monoBuffer;
}

function createSarvamUrl() {
  const url = new URL('wss://api.sarvam.ai/speech-to-text/ws');
  url.searchParams.set('model', 'saaras:v3');
  url.searchParams.set('mode', 'transcribe');
  url.searchParams.set('language-code', 'unknown');
  url.searchParams.set('sample_rate', '16000');
  url.searchParams.set('input_audio_codec', 'pcm_s16le');
  url.searchParams.set('flush_signal', 'true');
  return url.toString();
}

export async function createSarvamSession(meetingId, { mainWindow, onFinalEntry }) {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    console.warn('[Transcriber] SARVAM_API_KEY not set, Sarvam transcription disabled');
    return null;
  }

  const closeDeferred = createDeferred();
  const openDeferred = createDeferred();

  const socket = new WebSocket(createSarvamUrl(), {
    headers: {
      'Api-Subscription-Key': apiKey,
    },
  });

  const session = {
    meetingId,
    provider: 'sarvam',
    socket,
    mainWindow,
    onFinalEntry,
    closeDeferred,
    openDeferred,
    entries: [],
    chunkQueue: [],
    isOpen: false,
    lastResultAt: 0,
    firstMessageLogged: false,
    firstFinalLogged: false,
    lastCommittedTranscript: '',
    async sendChunk(buffer) {
      const monoBuffer = downmixStereoToMono(buffer);
      const payload = JSON.stringify({
        audio: {
          data: monoBuffer.toString('base64'),
          sample_rate: '16000',
          encoding: 'audio/wav',
        },
      });

      if (session.isOpen && socket.readyState === WebSocket.OPEN) {
        if (session.chunkQueue.length > 0) {
          while (session.chunkQueue.length > 0) {
            socket.send(session.chunkQueue.shift());
          }
        }
        socket.send(payload);
        return;
      }

      if (session.chunkQueue.length < 50) {
        session.chunkQueue.push(payload);
      }
    },
    async stop() {
      if (session.isOpen && socket.readyState === WebSocket.OPEN) {
        try {
          console.log(`[Sarvam] Flush signal sent for meeting ${meetingId}`);
          socket.send(JSON.stringify({ type: 'flush' }));
        } catch (error) {
          console.warn('[Transcriber] Failed to send Sarvam flush signal:', error);
        }
      }

      const finalizeStart = Date.now();
      while (Date.now() - finalizeStart < 5000) {
        const timeSinceLastResult = session.lastResultAt === 0
          ? Date.now() - finalizeStart
          : Date.now() - session.lastResultAt;

        if (timeSinceLastResult >= 1000) {
          break;
        }

        await wait(100);
      }

      try {
        socket.close();
      } catch {
        // ignored
      }

      await Promise.race([
        closeDeferred.promise,
        wait(2000),
      ]);

      return [...session.entries];
    },
  };

  socket.on('open', () => {
    session.isOpen = true;
    console.log(`[Sarvam] Socket open for meeting ${meetingId}`);
    while (session.chunkQueue.length > 0) {
      socket.send(session.chunkQueue.shift());
    }
    openDeferred.resolve();
  });

  socket.on('message', (rawMessage) => {
    let payload;
    try {
      payload = JSON.parse(rawMessage.toString());
    } catch (error) {
      console.warn('[Sarvam] Failed to parse websocket message:', error);
      return;
    }

    if (!session.firstMessageLogged) {
      console.log(`[Sarvam] First message received for meeting ${meetingId}: ${payload?.type ?? 'Unknown'}`);
      session.firstMessageLogged = true;
    }

    if (payload?.type === 'error') {
      console.error('[Sarvam] Streaming error:', payload.data);
      return;
    }

    if (payload?.type !== 'data' || !payload.data?.transcript?.trim()) {
      return;
    }

    session.lastResultAt = Date.now();

    const transcript = normalizeText(payload.data.transcript);
    if (transcript === session.lastCommittedTranscript) {
      return;
    }

    const entry = {
      source: 'meeting',
      speakerId: null,
      transcript,
      timestamp: getTimestamp(),
      isFinal: true,
      interim: false,
      languageCode: payload.data.language_code ?? null,
      languageProbability: payload.data.language_probability ?? null,
    };

    emitTranscriptEntry(mainWindow, entry);

    const persistedEntry = buildPersistedEntry(entry);
    session.entries.push(persistedEntry);
    session.lastCommittedTranscript = transcript;

    if (!session.firstFinalLogged) {
      console.log(`[Sarvam] First final transcript entry received for meeting ${meetingId}`);
      session.firstFinalLogged = true;
    }

    onFinalEntry?.(persistedEntry, [...session.entries]);
  });

  socket.on('error', (error) => {
    console.error('[Transcriber] Sarvam websocket error:', error);
    if (!session.isOpen) {
      openDeferred.reject(error);
    }
  });

  socket.on('close', () => {
    session.isOpen = false;
    closeDeferred.resolve();
  });

  await openDeferred.promise;
  return session;
}
