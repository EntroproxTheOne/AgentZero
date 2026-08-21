import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wasGoogleSearchUsed } from '../electron/ai/searchGrounding.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quickLookSource = fs.readFileSync(path.join(repoRoot, 'electron', 'ai', 'quickLook.js'), 'utf8');

test('QuickLook always makes Google Search available to Gemini', () => {
  assert.match(quickLookSource, /useSearch:\s*true/);
  assert.doesNotMatch(quickLookSource, /shouldUseGoogleSearch/);
});

test('detects actual web grounding in a Gemini response', () => {
  assert.equal(
    wasGoogleSearchUsed({
      candidates: [{
        groundingMetadata: {
          groundingChunks: [{ web: { uri: 'https://example.com/source' } }],
        },
      }],
    }),
    true,
  );
});

test('does not claim search was used when the response has no web grounding', () => {
  assert.equal(wasGoogleSearchUsed({ candidates: [{ groundingMetadata: {} }] }), false);
  assert.equal(
    wasGoogleSearchUsed({
      candidates: [{
        groundingMetadata: {
          groundingChunks: [{ maps: { title: 'A place' } }],
        },
      }],
    }),
    false,
  );
});
