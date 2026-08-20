import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const recorderSource = fs.readFileSync(
  path.join(repoRoot, 'src', 'components', 'MeetingRecorder.tsx'),
  'utf8',
);

test('renderer resolves the PCM worklet relative to the loaded document', () => {
  assert.match(
    recorderSource,
    /const workletModuleUrl = new URL\('pcm-processor\.js', window\.location\.href\)\.toString\(\);/,
  );
  assert.doesNotMatch(recorderSource, /addModule\(\s*['"]\/pcm-processor\.js['"]\s*\)/);
});

test('a packaged file URL resolves the worklet inside dist', () => {
  const packagedPage = 'file:///C:/Program%20Files/AgentZero/resources/app.asar/dist/index.html';
  assert.equal(
    new URL('pcm-processor.js', packagedPage).href,
    'file:///C:/Program%20Files/AgentZero/resources/app.asar/dist/pcm-processor.js',
  );
});

test('the Vite output contains the worklet module', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'dist', 'pcm-processor.js')), true);
});
