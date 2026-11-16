// Post-meeting processing that survives the app closing.
//
// State lives in the Meetings row (processing_state, processing_note,
// batch_job_id) and in artifacts.json, so every step is idempotent and
// `resumePendingMeetings()` on launch picks up wherever things stopped:
//   1. Sarvam batch job (uploads always; live meetings when speaker detection is on)
//      - submitted once; job_id stored; Sarvam keeps working while we're closed
//   2. Highlights + Minutes of Meeting (started immediately at Stop)
//   3. When the batch result lands: apply transcript/speaker labels, regenerate
import fs from 'fs/promises';
import path from 'path';
import { getDB } from './db.js';
import { finalizeVideoMp4, pcmToMp3 } from './media.js';
import { initializeArtifactsFile, readArtifactsFile, updateArtifactsFile } from './ai/artifactStore.js';
import { generateMeetingHighlights } from './ai/highlights.js';
import { ensureMinutesOfMeeting } from './ai/minutesOfMeeting.js';
import { submitBatchJob, waitForBatchJob } from './transcription/sarvamBatch.js';
import { getMeetingContextForRow } from './workspace.js';

let emitToRenderer = () => {};
let onTranscriptReady = () => {};
let isLiveMeeting = () => false;
const running = new Map();
const retryTimers = new Map();
const attempts = new Map();
const MAX_ATTEMPTS_PER_SESSION = 6;

export function configurePipeline({ emit, onTranscript, isLive }) {
  emitToRenderer = emit;
  if (onTranscript) onTranscriptReady = onTranscript;
  if (isLive) isLiveMeeting = isLive;
}

const getMeeting = (dbId) => getDB().prepare('SELECT * FROM Meetings WHERE id = ?').get(dbId);

function setState(dbId, state, note = null) {
  getDB().prepare('UPDATE Meetings SET processing_state = ?, processing_note = ? WHERE id = ?').run(state, note, dbId);
  emitToRenderer('meeting-processing', { dbId, state, note });
}

function emitArtifacts(meeting) {
  emitToRenderer('meeting-artifacts-updated', { meetingId: meeting.start_time_ms, dbId: meeting.id, payload: null });
}

async function readTranscript(meeting) {
  try {
    const entries = JSON.parse(await fs.readFile(meeting.transcript_path, 'utf8'));
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

async function buildSession(meeting) {
  return {
    meetingId: meeting.start_time_ms,
    dbId: meeting.id,
    title: meeting.title,
    startTime: meeting.start_time_ms,
    endTime: meeting.end_time_ms,
    transcriptEntries: await readTranscript(meeting),
    transcriptPath: meeting.transcript_path,
    artifactsPath: meeting.artifacts_path,
    contextText: getMeetingContextForRow(meeting).text,
  };
}

// Batch transcription runs for uploads, for speaker detection, and as the fallback
// whenever a live meeting ended up with no transcript (STT outage, crash, quit).
function needsBatch(meeting, artifacts, transcriptEmpty) {
  if (artifacts?.usage?.sttBatch) return false;
  const liveIncomplete = transcriptEmpty || Boolean(artifacts?.usage?.stt?.incomplete);
  return meeting.source === 'upload' || Boolean(meeting.batch_diarize) || (liveIncomplete && Boolean(meeting.audio_file_path));
}

async function fileSize(filePath) {
  try {
    return (await fs.stat(filePath)).size;
  } catch {
    return 0;
  }
}

/**
 * A live meeting whose app quit or crashed mid-recording: turn the raw capture
 * files into a normal MP3/MP4 so batch transcription can rebuild the transcript.
 */
async function recoverInterruptedRecording(meeting) {
  const folder = path.dirname(meeting.transcript_path || meeting.artifacts_path);
  const base = path.basename(folder);
  const pcmPath = path.join(folder, 'meeting_audio.pcm');
  const tempVideo = meeting.video_file_path && /temp_video\.(bin|webm)$/.test(meeting.video_file_path) ? meeting.video_file_path : null;
  let audioPath = meeting.audio_file_path;
  let videoPath = tempVideo ? null : meeting.video_file_path;
  let endTime = meeting.end_time_ms;

  const pcmBytes = await fileSize(pcmPath);
  if (!audioPath && pcmBytes > 0) {
    audioPath = path.join(folder, `${base}.mp3`);
    await pcmToMp3(pcmPath, audioPath);
    await fs.rm(pcmPath, { force: true });
    // 16 kHz mono 16-bit = 32,000 bytes per second.
    endTime = endTime || meeting.start_time_ms + Math.round((pcmBytes / 32000) * 1000);
  }
  if (tempVideo && (await fileSize(tempVideo)) > 0) {
    videoPath = path.join(folder, `${base}.mp4`);
    try {
      await finalizeVideoMp4(tempVideo, videoPath);
      await fs.rm(tempVideo, { force: true });
    } catch {
      videoPath = tempVideo; // keep the raw file rather than lose it
    }
  }

  getDB().prepare(`
    UPDATE Meetings SET audio_file_path = ?, video_file_path = ?, end_time_ms = ?, processing_state = ?, processing_note = ? WHERE id = ?
  `).run(
    audioPath ?? null,
    videoPath ?? null,
    endTime || meeting.start_time_ms,
    audioPath ? 'transcribing' : 'error',
    audioPath ? 'Recovered after the app closed during recording' : 'The app closed during recording and no audio was saved',
    meeting.id,
  );
  return getMeeting(meeting.id);
}

function isTransient(error) {
  if (error?.permanent) return false;
  const message = String(error?.message ?? error);
  if (/\((4\d\d)\)/.test(message) && !/\((408|429)\)/.test(message)) return false;
  if (/not set|not a service account|Unsupported|ffmpeg failed/i.test(message)) return false;
  return true; // network drops, timeouts, 5xx, 429
}

/** Run (or join) processing for one meeting. Safe to call repeatedly. */
export function processMeeting(dbId) {
  if (running.has(dbId)) return running.get(dbId);
  clearTimeout(retryTimers.get(dbId));
  const promise = run(dbId).finally(() => running.delete(dbId));
  running.set(dbId, promise);
  return promise;
}

export async function resumePendingMeetings() {
  const pending = getDB().prepare("SELECT id FROM Meetings WHERE processing_state != 'done' AND processing_state != 'error' ORDER BY id").all();
  for (const { id } of pending) {
    await processMeeting(id).catch(() => {});
  }
}

async function submitIfNeeded(meeting, artifacts, transcriptEmpty) {
  if (!needsBatch(meeting, artifacts, transcriptEmpty) || meeting.batch_job_id) return meeting;
  if (!meeting.audio_file_path) {
    // Nothing to send (e.g. capture failed): skip speaker detection gracefully.
    await updateArtifactsFile(meeting.artifacts_path, (current) => ({
      ...current, usage: { ...(current.usage ?? {}), sttBatch: { skipped: true, billedAudioSeconds: 0 } },
    }));
    return getMeeting(meeting.id);
  }
  setState(meeting.id, 'transcribing', meeting.batch_diarize ? 'Uploading audio for speaker detection' : 'Uploading recording');
  const jobId = await submitBatchJob(meeting.audio_file_path, { diarize: Boolean(meeting.batch_diarize) });
  getDB().prepare('UPDATE Meetings SET batch_job_id = ? WHERE id = ?').run(jobId, meeting.id);
  return getMeeting(meeting.id);
}

async function applyBatchResult(meeting, { regenerate }) {
  setState(meeting.id, 'transcribing', meeting.batch_diarize ? 'Identifying speakers' : 'Transcribing recording');
  let result;
  try {
    result = await waitForBatchJob(meeting.batch_job_id, {
      onProgress: (note) => setState(meeting.id, 'transcribing', note),
    });
  } catch (error) {
    // A job Sarvam marked as failed (or no longer knows) never recovers:
    // forget it so Retry submits a new one.
    if (!isTransient(error)) getDB().prepare('UPDATE Meetings SET batch_job_id = NULL WHERE id = ?').run(meeting.id);
    throw error;
  }
  if (result.entries.length > 0) {
    await fs.writeFile(meeting.transcript_path, JSON.stringify(result.entries, null, 2), 'utf8');
  }
  const billedAudioSeconds = meeting.start_time_ms && meeting.end_time_ms
    ? (meeting.end_time_ms - meeting.start_time_ms) / 1000
    : result.durationSeconds ?? 0;
  // Recorded together with the batch result, so a quit before regeneration
  // finishes is picked up on the next launch (see `regenerationPending` in run()).
  await updateArtifactsFile(meeting.artifacts_path, (current) => ({
    ...current,
    regenerationPending: Boolean(regenerate && result.entries.length > 0) || Boolean(current.regenerationPending),
    usage: {
      ...(current.usage ?? {}),
      sttBatch: { diarized: Boolean(meeting.batch_diarize), billedAudioSeconds, jobId: result.jobId },
    },
  }));
  getDB().prepare('UPDATE Meetings SET batch_job_id = NULL WHERE id = ?').run(meeting.id);
  const updated = getMeeting(meeting.id);
  onTranscriptReady(updated, result.entries);
  emitArtifacts(updated);
  return updated;
}

async function regenerateIfPending(meeting) {
  const artifacts = await readArtifactsFile(meeting.artifacts_path);
  if (!artifacts?.regenerationPending) return;
  // Speaker labels changed the transcript: refresh highlights and minutes.
  setState(meeting.id, 'analyzing', 'Updating minutes with speaker names');
  const session = await buildSession(meeting);
  await generateMeetingHighlights(session);
  await ensureMinutesOfMeeting(session, { force: true }).catch(() => null);
  const after = await readArtifactsFile(meeting.artifacts_path);
  if (after?.highlights?.status === 'ready' && after?.minutesOfMeeting?.status === 'ready' && after.minutesOfMeeting.source !== 'fallback') {
    await updateArtifactsFile(meeting.artifacts_path, (current) => ({ ...current, regenerationPending: false }));
  }
  emitArtifacts(meeting);
}

async function run(dbId) {
  let meeting = getMeeting(dbId);
  if (!meeting) return;
  try {
    if (meeting.processing_state === 'recording') {
      if (isLiveMeeting(dbId)) return; // still being recorded right now
      meeting = await recoverInterruptedRecording(meeting);
      if (meeting.processing_state === 'error') return;
    }
    await initializeArtifactsFile(meeting.artifacts_path, {
      meetingId: meeting.start_time_ms,
      dbId: meeting.id,
      title: meeting.title,
      transcriptPath: meeting.transcript_path,
      artifactsPath: meeting.artifacts_path,
    });
    let artifacts = await readArtifactsFile(meeting.artifacts_path);
    const transcriptEmpty = (await readTranscript(meeting)).length === 0;
    meeting = await submitIfNeeded(meeting, artifacts, transcriptEmpty);

    // Uploads, recovered recordings and live transcripts with gaps are rebuilt
    // from the recording first, so the minutes are never written from a partial transcript.
    const liveIncomplete = Boolean(artifacts?.usage?.stt?.incomplete);
    if (meeting.batch_job_id && (liveIncomplete || (await readTranscript(meeting)).length === 0)) {
      meeting = await applyBatchResult(meeting, { regenerate: false });
    }

    // Highlights + minutes (skipped when already done).
    let session = await buildSession(meeting);
    if (session.transcriptEntries.length === 0) {
      setState(dbId, 'done', 'No speech was transcribed');
      return;
    }
    artifacts = await readArtifactsFile(meeting.artifacts_path);
    if (artifacts?.highlights?.status !== 'ready') {
      setState(dbId, 'analyzing', 'Writing highlights');
      await generateMeetingHighlights(session);
      emitArtifacts(meeting);
    }
    artifacts = await readArtifactsFile(meeting.artifacts_path);
    if (artifacts?.minutesOfMeeting?.status !== 'ready' || artifacts.minutesOfMeeting.source === 'fallback') {
      setState(dbId, 'analyzing', 'Writing minutes of meeting');
      await ensureMinutesOfMeeting(session).catch(() => null);
      emitArtifacts(meeting);
    }

    // Live meeting with speaker detection: labels arrive after the first pass.
    meeting = getMeeting(dbId);
    if (meeting.batch_job_id) {
      meeting = await applyBatchResult(meeting, { regenerate: true });
    }
    await regenerateIfPending(meeting);

    artifacts = await readArtifactsFile(meeting.artifacts_path);
    const unfinished = artifacts?.highlights?.status !== 'ready'
      || artifacts?.minutesOfMeeting?.status !== 'ready'
      || artifacts.minutesOfMeeting.source === 'fallback'
      || Boolean(artifacts?.regenerationPending);
    if (unfinished) {
      const reason = artifacts?.highlights?.error || artifacts?.minutesOfMeeting?.error || 'AI step did not finish';
      throw Object.assign(new Error(reason), { permanent: !isTransient(new Error(reason)) });
    }
    attempts.delete(dbId);
    setState(dbId, 'done', null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Pipeline] Meeting ${dbId}:`, message);
    const tries = (attempts.get(dbId) ?? 0) + 1;
    attempts.set(dbId, tries);
    if (isTransient(error) && tries < MAX_ATTEMPTS_PER_SESSION) {
      // Not an error to the user: it finishes when the network is back (or next launch).
      setState(dbId, getMeeting(dbId)?.batch_job_id ? 'transcribing' : 'analyzing', 'Finishing up, will continue automatically');
      retryTimers.set(dbId, setTimeout(() => void processMeeting(dbId), Math.min(30_000 * 2 ** (tries - 1), 10 * 60_000)));
    } else if (isTransient(error)) {
      setState(dbId, 'analyzing', 'Finishing up when the app next starts');
    } else {
      setState(dbId, 'error', message.slice(0, 300));
    }
  }
}
