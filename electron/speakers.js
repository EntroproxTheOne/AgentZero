// Who said what, from the two local capture tracks (no API cost).
//
// While recording, the renderer measures the loudness (RMS) of the microphone
// and of the computer sound every 100 ms and the main process stores the
// frames in levels.bin as Float32 triples: [ms since audio start, mic, system].
// The mixed audio goes to Sarvam for diarization (Speaker 1..N); here each
// diarized speaker is placed on the local side (their voice is in the mic, not
// in the computer sound) or the remote side (the call audio). With laptop
// speakers the remote voices also reach the mic, but quieter than in the
// computer-sound track, so the decision uses the per-frame mic share
// mic / (mic + system), not raw mic presence.
import fs from 'fs/promises';

export const FRAME_MS = 100;
const VOICE_RMS = 0.012; // frames quieter than this on both tracks are silence
const SYSTEM_ACTIVE_RMS = 0.01;
const LOCAL_SHARE = 0.62;
const REMOTE_SHARE = 0.4;
export const CONFIRM_BELOW = 0.6;

export async function readLevels(filePath) {
  try {
    const buffer = await fs.readFile(filePath);
    const floats = new Float32Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.byteLength / 4));
    const frames = [];
    for (let index = 0; index + 2 < floats.length; index += 3) {
      frames.push([floats[index], floats[index + 1], floats[index + 2]]);
    }
    return frames;
  } catch {
    return [];
  }
}

/** Frames indexed by 100 ms slot for quick range lookups. */
function indexFrames(frames) {
  const slots = new Map();
  for (const [t, mic, sys] of frames) slots.set(Math.round(t / FRAME_MS), [mic, sys]);
  return slots;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Median mic share over the voiced frames between two times (ms). */
export function micShare(slots, startMs, endMs) {
  const shares = [];
  for (let slot = Math.floor(startMs / FRAME_MS); slot <= Math.ceil(endMs / FRAME_MS); slot += 1) {
    const frame = slots.get(slot);
    if (!frame) continue;
    const [mic, sys] = frame;
    if (Math.max(mic, sys) < VOICE_RMS) continue;
    shares.push(mic / (mic + sys + 1e-6));
  }
  return { share: median(shares), voicedFrames: shares.length };
}

export function systemWasSilent(frames) {
  if (frames.length === 0) return false;
  const active = frames.filter(([, , sys]) => sys > SYSTEM_ACTIVE_RMS).length;
  return active / frames.length < 0.02;
}

/** A name for the other side from the tagged client or the meeting title. */
export function remoteNameHint({ clientName, title }) {
  if (clientName && clientName.trim()) return clientName.trim().split(/\s+/)[0];
  const match = String(title ?? '').match(/\b(?:with|w\/|and|<>|x)\s+([A-Z][a-zA-Z.'-]+)/);
  return match ? match[1] : null;
}

/**
 * Map diarized speakers to people.
 * entries: transcript entries with speakerId and startSeconds/endSeconds.
 * Returns { speakers: {id: {name, side, share, isOwner, seconds}}, ownerId, confidence, oneSided, needsConfirmation }.
 */
export function mapSpeakers({ entries, frames, ownerName, remoteHint }) {
  const owner = (ownerName || 'You').trim();
  const slots = indexFrames(frames);
  const oneSided = frames.length > 0 && systemWasSilent(frames);
  const stats = new Map();
  for (const entry of entries) {
    if (entry.speakerId === null || entry.speakerId === undefined) continue;
    const id = String(entry.speakerId);
    const current = stats.get(id) ?? { shares: [], seconds: 0 };
    const start = (entry.startSeconds ?? 0) * 1000;
    const end = (entry.endSeconds ?? entry.startSeconds ?? 0) * 1000;
    current.seconds += Math.max(0, (end - start) / 1000);
    const { share, voicedFrames } = micShare(slots, start, end);
    if (share !== null) for (let k = 0; k < voicedFrames; k += 1) current.shares.push(share);
    stats.set(id, current);
  }

  const people = [...stats.entries()].map(([id, value]) => ({
    id,
    seconds: value.seconds,
    share: frames.length ? median(value.shares) : null,
  }));
  if (people.length === 0) return { speakers: {}, ownerId: null, confidence: 0, oneSided, needsConfirmation: false };

  for (const person of people) {
    if (oneSided || person.share === null) person.side = oneSided ? 'local' : 'unknown';
    else person.side = person.share >= LOCAL_SHARE ? 'local' : person.share <= REMOTE_SHARE ? 'remote' : 'unknown';
  }

  const byTalk = (a, b) => b.seconds - a.seconds;
  const local = people.filter((person) => person.side === 'local');
  let ownerId;
  let confidence;
  if (frames.length === 0) {
    // No level data (older recording): most talkative speaker, low confidence.
    ownerId = [...people].sort(byTalk)[0].id;
    confidence = people.length === 1 ? 0.8 : 0.3;
  } else if (oneSided) {
    ownerId = [...people].sort(byTalk)[0].id;
    confidence = people.length === 1 ? 0.95 : 0.4;
  } else if (local.length === 1) {
    ownerId = local[0].id;
    confidence = people.length >= 3 ? 0.75 : 0.9;
  } else if (local.length >= 2) {
    const sorted = [...local].sort((a, b) => (b.share ?? 0) - (a.share ?? 0));
    const gap = (sorted[0].share ?? 0) - (sorted[1].share ?? 0);
    // Similar mic share (someone else in the room): the adviser usually talks most.
    ownerId = gap > 0.15 ? sorted[0].id : [...local].sort(byTalk)[0].id;
    confidence = gap > 0.15 ? 0.65 : 0.4;
  } else {
    const sorted = [...people].sort((a, b) => (b.share ?? 0) - (a.share ?? 0));
    ownerId = sorted[0].id;
    confidence = 0.3;
  }

  const speakers = {};
  let remoteNamed = false;
  let counter = 2;
  for (const person of [...people].sort(byTalk)) {
    let name;
    if (person.id === ownerId) name = owner;
    else if (person.side === 'remote' && !remoteNamed) {
      name = remoteHint || 'Client';
      remoteNamed = true;
    } else {
      name = `Speaker ${counter}`;
      counter += 1;
    }
    speakers[person.id] = {
      name,
      side: person.id === ownerId ? 'local' : person.side,
      share: person.share === null ? null : Math.round(person.share * 100) / 100,
      seconds: Math.round(person.seconds),
      isOwner: person.id === ownerId,
    };
  }
  return { speakers, ownerId, confidence, oneSided, needsConfirmation: confidence < CONFIRM_BELOW };
}

/** Rewrite transcript labels from a speaker map. */
export function applySpeakerNames(entries, speakers) {
  return entries.map((entry) => {
    const person = entry.speakerId === null || entry.speakerId === undefined ? null : speakers[String(entry.speakerId)];
    if (!person) return entry;
    return { ...entry, speakerLabel: person.name, source: person.isOwner ? 'you' : 'meeting' };
  });
}

/**
 * Live mode: label one utterance from the levels just before it arrived.
 * Returns 'local' | 'remote' | null (not enough signal).
 */
export function labelLiveWindow(frames, endMs, durationMs) {
  const from = endMs - durationMs - FRAME_MS;
  const slots = indexFrames(frames.filter(([t]) => t >= from && t <= endMs + FRAME_MS));
  const { share, voicedFrames } = micShare(slots, Math.max(0, endMs - durationMs), endMs);
  if (share === null || voicedFrames < 3) return null;
  if (share >= LOCAL_SHARE) return 'local';
  if (share <= REMOTE_SHARE) return 'remote';
  return null;
}
