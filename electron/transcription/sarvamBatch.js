// Sarvam Saaras v4 Batch API: transcribe a recorded file with speaker diarization.
// Flow (docs.sarvam.ai/api-reference/speech-to-text/stt/job/*), live-tested 16 Nov 2026:
//   POST /speech-to-text/job/v1                 -> job_id
//   POST /speech-to-text/job/v1/upload-files    -> upload_urls[file].file_url (signed URL; AWS or Azure)
//   PUT  file_url  (real audio content-type; x-ms-blob-type only for Azure URLs)
//   POST /speech-to-text/job/v1/{job_id}/start
//   GET  /speech-to-text/job/v1/{job_id}/status -> job_details[].outputs[].file_name
//   POST /speech-to-text/job/v1/download-files  -> download_urls[file].file_url
// Limits: 2 hours per file. Diarization is batch-only (₹0.59/min vs ₹0.49/min plain).
import fs from 'fs/promises';
import path from 'path';
import { getSarvamApiKey } from '../credentials.js';

const BASE = 'https://api.sarvam.ai/speech-to-text/job/v1';
// A 30 s clip finishes in ~3 s, so poll briskly at first.
const POLL_MS = 3000;
const AUDIO_MIME = {
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.ogg': 'audio/ogg', '.opus': 'audio/opus', '.flac': 'audio/flac', '.webm': 'audio/webm',
};
const TIMEOUT_MS = 45 * 60 * 1000;
const JOB_VISIBLE_GRACE_MS = 90 * 1000;

async function sarvamJson(url, { method = 'POST', body } = {}) {
  const apiKey = getSarvamApiKey();
  if (!apiKey) throw new Error('Sarvam API key is not set. Add it in Settings → AI & Transcription.');
  const response = await fetch(url, {
    method,
    headers: { 'api-subscription-key': apiKey, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!response.ok) {
    const message = json?.error?.message ?? json?.message ?? text.slice(0, 300);
    throw new Error(`Sarvam ${method} ${new URL(url).pathname} failed (${response.status}): ${message}`);
  }
  return json;
}

/**
 * Create, upload and start a batch job. Returns as soon as Sarvam has the file,
 * so the job_id can be saved and the job resumed later even if the app closes.
 */
export async function submitBatchJob(audioPath, { diarize = false, numSpeakers, onProgress = () => {} } = {}) {
  onProgress('Creating transcription job');
  const job = await sarvamJson(BASE, {
    body: {
      job_parameters: {
        model: 'saaras:v4',
        mode: 'transcribe',
        language_code: 'unknown',
        with_timestamps: true,
        with_diarization: Boolean(diarize),
        ...(diarize && numSpeakers ? { num_speakers: numSpeakers } : {}),
      },
    },
  });
  const jobId = job.job_id;
  const fileName = path.basename(audioPath);

  onProgress('Uploading audio');
  const upload = await sarvamJson(`${BASE}/upload-files`, { body: { job_id: jobId, files: [fileName] } });
  const uploadUrl = upload.upload_urls?.[fileName]?.file_url;
  if (!uploadUrl) throw new Error('Sarvam did not return an upload URL');
  // The real audio content type matters: with application/octet-stream Sarvam
  // treated an MP3 as WAV and returned an empty transcript (verified 16 Nov 2026).
  // Storage may be AWS or Azure; Azure blob URLs additionally need x-ms-blob-type.
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'content-type': AUDIO_MIME[path.extname(audioPath).toLowerCase()] ?? 'audio/mpeg',
      ...(/\.blob\.core\.windows\.net/i.test(uploadUrl) ? { 'x-ms-blob-type': 'BlockBlob' } : {}),
    },
    body: await fs.readFile(audioPath),
  });
  if (!put.ok) throw new Error(`Audio upload failed (${put.status}): ${(await put.text()).slice(0, 200)}`);

  await sarvamJson(`${BASE}/${jobId}/start`);
  return jobId;
}

/** Poll a started job until it finishes, then download and convert the result. */
export async function waitForBatchJob(jobId, { onProgress = () => {}, timeoutMs = TIMEOUT_MS } = {}) {
  onProgress(`Transcribing (job ${jobId.slice(0, 8)})`);
  const startedAt = Date.now();
  let status;
  for (;;) {
    try {
      status = await sarvamJson(`${BASE}/${jobId}/status`, { method: 'GET' });
    } catch (error) {
      // A just-started job can briefly report "does not exist" (seen 16 Nov 2026).
      if (/does not exist/i.test(error.message) && Date.now() - startedAt < JOB_VISIBLE_GRACE_MS) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        continue;
      }
      throw error;
    }
    if (status.job_state === 'Completed' || status.job_state === 'Failed') break;
    if (Date.now() - startedAt > timeoutMs) throw new Error('Sarvam transcription timed out');
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  const detail = status.job_details?.[0];
  if (status.job_state === 'Failed' || !detail || detail.state !== 'Success') {
    const error = new Error(`Sarvam transcription failed: ${detail?.error_message || status.error_message || status.job_state}`);
    error.permanent = true;
    throw error;
  }

  onProgress('Downloading transcript');
  const outputName = detail.outputs?.[0]?.file_name;
  const download = await sarvamJson(`${BASE}/download-files`, { body: { job_id: jobId, files: [outputName] } });
  const downloadUrl = download.download_urls?.[outputName]?.file_url;
  if (!downloadUrl) throw new Error('Sarvam did not return a download URL');
  const result = await (await fetch(downloadUrl)).json();
  return { ...toEntries(result), jobId };
}

export async function transcribeFile(audioPath, options = {}) {
  const jobId = await submitBatchJob(audioPath, options);
  return waitForBatchJob(jobId, options);
}

function formatOffset(seconds) {
  const s = Math.max(0, Math.round(seconds ?? 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((part) => String(part).padStart(2, '0')).join(':');
}

/** Sarvam output -> our persisted transcript entries (speaker ids are 0-based strings). */
export function toEntries(result) {
  const diarized = result?.diarized_transcript?.entries;
  const languageCode = result?.language_code ?? null;
  let entries;
  if (Array.isArray(diarized) && diarized.length > 0) {
    entries = diarized
      .filter((item) => item.transcript?.trim())
      .map((item) => {
        const speakerId = Number.parseInt(item.speaker_id, 10);
        const id = Number.isFinite(speakerId) ? speakerId : null;
        return {
          timestamp: formatOffset(item.start_time_seconds),
          source: 'meeting',
          speakerLabel: id === null ? 'Speaker' : `Speaker ${id + 1}`,
          speakerId: id,
          text: item.transcript.trim(),
          isFinal: true,
          languageCode,
          languageProbability: null,
          startSeconds: item.start_time_seconds ?? null,
          endSeconds: item.end_time_seconds ?? null,
        };
      });
  } else {
    entries = String(result?.transcript ?? '').trim()
      ? [{
        timestamp: '00:00:00',
        source: 'meeting',
        speakerLabel: 'Speaker',
        speakerId: null,
        text: result.transcript.trim(),
        isFinal: true,
        languageCode,
        languageProbability: null,
      }]
      : [];
  }
  const ends = entries.map((entry) => entry.endSeconds).filter((value) => typeof value === 'number');
  return { entries, languageCode, durationSeconds: ends.length ? Math.max(...ends) : null, segments: toSegments(result, entries) };
}

/**
 * Timed text chunks (used by the "Go live" catch-up, which runs without
 * diarization): Sarvam's timestamps when present, else the whole transcript.
 */
function toSegments(result, entries) {
  const ts = result?.timestamps;
  const words = Array.isArray(ts?.words) ? ts.words : null;
  const starts = Array.isArray(ts?.start_time_seconds) ? ts.start_time_seconds : null;
  const ends = Array.isArray(ts?.end_time_seconds) ? ts.end_time_seconds : null;
  if (words && starts && ends && words.length === starts.length) {
    return words.map((text, index) => ({ text: String(text).trim(), start: Number(starts[index]) || 0, end: Number(ends[index]) || 0 }))
      .filter((segment) => segment.text);
  }
  if (entries.some((entry) => typeof entry.startSeconds === 'number')) {
    return entries.map((entry) => ({ text: entry.text, start: entry.startSeconds ?? 0, end: entry.endSeconds ?? entry.startSeconds ?? 0 }));
  }
  const text = String(result?.transcript ?? '').trim();
  return text ? [{ text, start: 0, end: 0 }] : [];
}
