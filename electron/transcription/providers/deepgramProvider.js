import { createRequire } from 'module';
import {
  buildPersistedEntry,
  createDeferred,
  emitTranscriptEntry,
  getTimestamp,
  wait,
} from '../providerUtils.js';
import { normalizeText } from '../../text/normalize.js';
import { getConfiguredSecret } from '../../runtimeConfig.js';

const require = createRequire(import.meta.url);
const { DeepgramClient } = require('@deepgram/sdk');

export async function createDeepgramSession(meetingId, { mainWindow, onFinalEntry }) {
  const apiKey = getConfiguredSecret('DEEPGRAM_API_KEY');
  if (!apiKey) {
    console.warn('[Transcriber] DEEPGRAM_API_KEY not set, transcription disabled');
    return null;
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
    provider: 'deepgram',
    connection,
    mainWindow,
    onFinalEntry,
    keepAlive: null,
    entries: [],
    chunkQueue: [],
    lastResultAt: 0,
    closeDeferred,
    isOpen: false,
    firstMessageLogged: false,
    firstFinalLogged: false,
    firstQueuedChunkLogged: false,
    async sendChunk(buffer) {
      const chunkBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

      if (connection.readyState === 1 && session.isOpen) {
        while (session.chunkQueue.length > 0) {
          connection.sendMedia(session.chunkQueue.shift());
        }
        connection.sendMedia(chunkBuffer);
        return;
      }

      if (session.chunkQueue.length < 50) {
        if (!session.firstQueuedChunkLogged) {
          console.log(`[Deepgram] Audio chunk queued before socket open for meeting ${meetingId}`);
          session.firstQueuedChunkLogged = true;
        }
        session.chunkQueue.push(chunkBuffer);
      }
    },
    async stop() {
      if (session.keepAlive) clearInterval(session.keepAlive);

      if (connection.readyState === 1 && session.isOpen) {
        try {
          console.log(`[Deepgram] Finalize sent for meeting ${meetingId}`);
          connection.sendFinalize({ type: 'Finalize' });
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
        connection.close();
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
      transcript: normalizeText(alternative.transcript),
      timestamp: getTimestamp(),
      isFinal,
      interim: !isFinal,
      languageCode: null,
      languageProbability: null,
    };

    emitTranscriptEntry(mainWindow, entry);

    if (!isFinal) {
      return;
    }

    const persistedEntry = buildPersistedEntry(entry);
    session.entries.push(persistedEntry);
    if (!session.firstFinalLogged) {
      console.log(`[Deepgram] First final transcript entry received for meeting ${meetingId}`);
      session.firstFinalLogged = true;
    }
    onFinalEntry?.(persistedEntry, [...session.entries]);
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
    closeDeferred.resolve();
  });

  connection.connect();
  await connection.waitForOpen();

  return session;
}
