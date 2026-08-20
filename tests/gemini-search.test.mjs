import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldUseGoogleSearch, wasGoogleSearchUsed } from '../electron/ai/searchGrounding.js';

test('enables Google Search for definition and identity questions', () => {
  assert.equal(shouldUseGoogleSearch('What is an open source model?'), true);
  assert.equal(shouldUseGoogleSearch('Who is Sachin?'), true);
});

test('keeps a transcript-specific count question transcript-first', () => {
  assert.equal(shouldUseGoogleSearch('How many people are in HPAIR?'), false);
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
