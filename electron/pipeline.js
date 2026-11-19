// Post-meeting processing that survives the app closing.
//
// State lives in the Meetings row (processing_state, processing_note,
// batch_job_id) and in artifacts.json, so every step is idempotent and
// `resumePendingMeetings()` on launch picks up wherever things stopped:
//   1. Notes mode / uploads: ONE Sarvam batch pass with diarization.
//      Live mode: the streamed transcript is kept; the batch pass runs only if the
//      stream had gaps or the user asks to improve speaker labels.
//   2. Speaker mapping from the mic / computer-sound levels (no API cost).
//   3. ONE extraction call over the full transcript -> highlights, minutes, Ask.
import fs from 'fs/promises';
import path from 'path';
import { getDB } from './db.js';
import { finalizeVideoMp4, pcmToMp3 } from './media.js';
import { initializeArtifactsFile, readArtifactsFile, updateArtifactsFile } from './ai/artifactStore.js';
import { runExtraction } from './ai/extraction.js';
import { submitBatchJob, waitForBatchJob } from './transcription/sarvamBatch.js';
import { getMeetingContextForRow } from './workspace.js';
import { applySpeakerNames, mapSpeakers, readLevels, remoteNameHint, systemWasSilent } from './speakers.js';

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

const getMeeting = (dbId) => getDB().prepare(`
  SELECT m.*, c.name AS client_name FROM Meetings m LEFT JOIN Clients c ON c.id = m.client_id WHERE m.id = ?
`).get(dbId);

export const levelsPathFor = (meeting) => path.join(path.dirname(meeting.transcript_path || meeting.artifacts_path), 'levels.bin');

function setState(dbId, state, note = null) {
  getDB().prepare('UPDATE Meetings SET processing_state = ?, processing_note = ? WHERE id = ?').run(state, note, dbId);
  emitToRenderer('meeting-processing', { dbId, state, note });
}

export function emitArtifacts(meeting) {
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

async function buildSession(meeting, artifacts) {
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
    ownerName: meeting.owner_name || 'You',
    oneSided: Boolean(artifacts?.speakerMap?.oneSided),
  };
}

// One batch pass, always with diarization: every upload and Notes-mode
// recording; Live mode only when the stream had gaps or the user asked for it.
function needsBatch(meeting, artifacts, transcriptEmpty) {
  if (artifacts?.usage?.sttBatch) return false;
  if (meeting.source === 'upload' || meeting.recording_mode !== 'live') return true;
  return Boolean(meeting.batch_diarize) || transcriptEmpty || Boolean(artifacts?.usage?.stt?.incomplete);
}

/** Label diarized speakers from the two capture tracks and save the result. */
export async function mapMeetingSpeakers(meeting, entries) {
  const frames = await readLevels(levelsPathFor(meeting));
  const map = mapSpeakers({
    entries,
    frames,
    ownerName: meeting.owner_name || 'You',
    remoteHint: remoteNameHint({ clientName: meeting.client_name, title: meeting.title }),
  });
  const labelled = applySpeakerNames(entries, map.speakers);
  await fs.writeFile(meeting.transcript_path, JSON.stringify(labelled, null, 2), 'utf8');
  await updateArtifactsFile(meeting.artifacts_path, (current) => ({
    ...current,
    speakerMap: { ...map, mode: 'diarized', hadLevels: frames.length > 0, confirmed: false, updatedAt: new Date().toISOString() },
  }));
  return labelled;
}

/** Live mode: the stream was labelled You / Client as it went; summarise how sure that was. */
async function summariseLiveSpeakers(meeting, entries) {
  const frames = await readLevels(levelsPathFor(meeting));
  const unclear = entries.filter((entry) => entry.liveSide === null || entry.liveSide === undefined).length;
  const unclearShare = entries.length ? unclear / entries.length : 1;
  const names = [...new Set(entries.map((entry) => entry.speakerLabel))];
  await updateArtifactsFile(meeting.artifacts_path, (current) => ({
    ...current,
    speakerMap: {
      mode: 'live',
      oneSided: frames.length > 0 && systemWasSilent(frames),
      names,
      unclearShare: Math.round(unclearShare * 100) / 100,
      // Many utterances the levels could not place: offer the diarization pass.
      needsImprove: unclearShare > 0.2,
      confidence: Math.round((1 - unclearShare) * 100) / 100,
      updatedAt: new Date().toISOString(),
    },
  }));
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
  setState(meeting.id, 'transcribing', 'Uploading audio');
  const jobId = await submitBatchJob(meeting.audio_file_path, { diarize: true });
  getDB().prepare('UPDATE Meetings SET batch_job_id = ? WHERE id = ?').run(jobId, meeting.id);
  return getMeeting(meeting.id);
}

async function applyBatchResult(meeting) {
  setState(meeting.id, 'transcribing', 'Transcribing and identifying speakers');
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
  let entries = result.entries;
  if (entries.length > 0) {
    setState(meeting.id, 'transcribing', 'Matching speakers');
    entries = await mapMeetingSpeakers(meeting, entries);
  }
  const billedAudioSeconds = meeting.start_time_ms && meeting.end_time_ms
    ? (meeting.end_time_ms - meeting.start_time_ms) / 1000
    : result.durationSeconds ?? 0;
  await updateArtifactsFile(meeting.artifacts_path, (current) => ({
    ...current,
    // A new transcript makes any earlier record out of date.
    extractionStale: Boolean(current.extraction) && entries.length > 0 ? true : Boolean(current.extractionStale),
    usage: {
      ...(current.usage ?? {}),
      sttBatch: { diarized: true, billedAudioSeconds, jobId: result.jobId },
    },
  }));
  getDB().prepare('UPDATE Meetings SET batch_job_id = NULL WHERE id = ?').run(meeting.id);
  const updated = getMeeting(meeting.id);
  onTranscriptReady(updated, entries);
  emitArtifacts(updated);
  return updated;
}

function useExtractedTitle(meeting, extraction) {
  const title = extraction?.title?.trim();
  if (!title || meeting.title !== 'Untitled Meeting') return;
  getDB().prepare('UPDATE Meetings SET title = ? WHERE id = ?').run(title, meeting.id);
  emitToRenderer('meeting-title-updated', { dbId: meeting.id, title });
}

async function run(dbId) {
  let meeting = getMeeting(dbId);
  if (!meeting) return;
  try {
    if (meeting.processing_state === 'recording') {
      if (isLiveMeeting(dbId)) return; // still being recorded right now
      meeting = await recoverInterruptedRecording(meeting);
      if (meeting.processing_state === 'error') return;
      meeting = getMeeting(dbId);
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

    if (needsBatch(meeting, artifacts, transcriptEmpty)) {
      meeting = await submitIfNeeded(meeting, artifacts, transcriptEmpty);
      if (meeting.batch_job_id) meeting = await applyBatchResult(meeting);
    } else if (!artifacts?.speakerMap && !transcriptEmpty) {
      await summariseLiveSpeakers(meeting, await readTranscript(meeting));
    }

    artifacts = await readArtifactsFile(meeting.artifacts_path);
    const session = await buildSession(meeting, artifacts);
    if (session.transcriptEntries.length === 0) {
      setState(dbId, 'done', 'No speech was transcribed');
      return;
    }
    if (artifacts?.extraction?.status !== 'ready' || artifacts?.extractionStale) {
      setState(dbId, 'analyzing', 'Writing the meeting record');
      const updated = await runExtraction(session);
      useExtractedTitle(meeting, updated?.extraction);
      emitArtifacts(meeting);
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
