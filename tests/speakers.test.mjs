// Speaker mapping from the two capture tracks: synthetic levels, no audio, no API.
import assert from 'node:assert/strict';
import { mapSpeakers, labelLiveWindow } from '../electron/speakers.js';

// Build 100 ms frames: each segment says who is talking and how loud each track is.
function framesFor(segments, total) {
  const frames = [];
  for (let t = 0; t < total * 1000; t += 100) {
    const seg = segments.find((s) => t >= s.start * 1000 && t < s.end * 1000);
    frames.push([t, seg ? seg.mic : 0.001, seg ? seg.sys : 0.0005]);
  }
  return frames;
}
const entry = (speakerId, start, end, text = 'words') => ({ speakerId, startSeconds: start, endSeconds: end, text });

// Owner on mic (speakers off his voice), client on the call. Laptop speakers: client bleeds into the mic at ~35 %.
const laptop = [
  { start: 0, end: 10, mic: 0.12, sys: 0.002 },
  { start: 10, end: 25, mic: 0.035, sys: 0.10 },
  { start: 25, end: 32, mic: 0.11, sys: 0.003 },
];
const entries = [entry(0, 0, 10), entry(1, 10, 25), entry(0, 25, 32)];

const cases = {
  'a: 1:1 online, laptop speakers': { frames: framesFor(laptop, 32), entries, owner: '0', remote: { 1: 'Client' } },
  'b: 1:1 online, headphones': {
    frames: framesFor(laptop.map((s) => (s.sys > s.mic ? { ...s, mic: 0.002 } : s)), 32), entries, owner: '0', remote: { 1: 'Client' },
  },
  'c: phone at ear, only owner recorded': {
    frames: framesFor([{ start: 0, end: 20, mic: 0.1, sys: 0 }], 20), entries: [entry(0, 0, 20)], owner: '0', oneSided: true,
  },
  'd: couple on one remote device': {
    frames: framesFor([
      { start: 0, end: 10, mic: 0.12, sys: 0.002 },
      { start: 10, end: 18, mic: 0.03, sys: 0.09 },
      { start: 18, end: 26, mic: 0.03, sys: 0.08 },
    ], 26),
    entries: [entry(0, 0, 10), entry(1, 10, 18), entry(2, 18, 26)],
    owner: '0',
  },
};

for (const [name, c] of Object.entries(cases)) {
  const map = mapSpeakers({ entries: c.entries, frames: c.frames, ownerName: 'Adviser', remoteHint: null });
  assert.equal(map.ownerId, c.owner, `${name}: owner`);
  assert.equal(map.speakers[c.owner].name, 'Adviser', `${name}: owner name`);
  if (c.oneSided) assert.equal(map.oneSided, true, `${name}: one-sided`);
  for (const [id, label] of Object.entries(c.remote ?? {})) assert.equal(map.speakers[id].name, label, `${name}: remote name`);
  console.log(`ok ${name} (confidence ${map.confidence})`);
}

// Live labelling of one utterance.
const live = framesFor(laptop, 32);
assert.equal(labelLiveWindow(live, 9000, 4000), 'local');
assert.equal(labelLiveWindow(live, 24000, 4000), 'remote');
console.log('ok live You / Client labels');
