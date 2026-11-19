import fs from 'fs/promises';
import { getDB } from './db.js';
import { createSarvamSession } from './transcription/providers/sarvamProvider.js';

const sessions = new Map();

// Sarvam (India-hosted) is the only transcription provider in this build.
function getProviderFactory() {
  return createSarvamSession;
}

export async function startTranscription(meetingId, { mainWindow, onFinalEntry, labelEntry }) {
  if (sessions.has(meetingId)) return;

  const createSession = getProviderFactory();
  const session = await createSession(meetingId, {
    mainWindow,
    onFinalEntry,
    labelEntry,
  });

  if (!session) {
    return;
  }

  sessions.set(meetingId, session);
}

export function sendChunk(meetingId, buffer) {
  const session = sessions.get(meetingId);
  if (!session) return;
  void session.sendChunk(buffer);
}

export function getTranscriptEntries(meetingId) {
  return sessions.get(meetingId)?.entries ?? [];
}

export async function stopTranscription(meetingId, { dbId, transcriptPath }) {
  const session = sessions.get(meetingId);
  if (!session) {
    return { transcriptPath: null, entries: [], stt: null, healthy: false, incomplete: true };
  }

  const entries = await session.stop();

  if (transcriptPath) {
    await fs.writeFile(transcriptPath, JSON.stringify(entries, null, 2), 'utf8');
    console.log(`[Transcriber] Transcript saved for meeting ${meetingId}: ${transcriptPath}`);
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
    entries,
    // Live STT connected and reported no errors: an empty transcript then really means silence.
    healthy: Boolean(!session.lastError && !session.incomplete && (session.billedAudioSeconds ?? 0) > 0),
    // Some audio never reached Sarvam (dropped connection): rebuild from the recording.
    incomplete: Boolean(session.incomplete),
    stt: {
      provider: session.provider,
      model: session.model ?? null,
      billedAudioSeconds: session.billedAudioSeconds ?? null,
      incomplete: Boolean(session.incomplete),
      reconnects: session.reconnects ?? 0,
    },
  };
}
