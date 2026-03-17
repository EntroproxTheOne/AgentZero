import fs from 'fs/promises';
import { getDB, getAppSettings } from './db.js';
import { createDeepgramSession } from './transcription/providers/deepgramProvider.js';
import { createSarvamSession } from './transcription/providers/sarvamProvider.js';

const sessions = new Map();

function getProviderFactory() {
  const settings = getAppSettings();
  if (settings.transcriptionProvider === 'sarvam') {
    return createSarvamSession;
  }
  return createDeepgramSession;
}

export async function startTranscription(meetingId, { mainWindow, onFinalEntry }) {
  if (sessions.has(meetingId)) return;

  const createSession = getProviderFactory();
  const session = await createSession(meetingId, {
    mainWindow,
    onFinalEntry,
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
    return { transcriptPath: null, entries: [] };
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
  };
}
