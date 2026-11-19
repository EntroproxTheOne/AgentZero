export const AI_CONFIG = {
  transcriptTokenCap: 200000,
  estimatedCharsPerToken: 4,
  geminiRateLimitEnabled: true,
  // Vertex AI on a billed project; the old 5/min cap was for the free API-key tier.
  geminiRequestsPerMinute: 60,
  geminiRateLimitWindowMs: 60_000,
  // Live mode auto-insights: only speech since the last call plus a short running summary.
  autoInsightsMaxCalls: 20,
  autoInsightsSummaryMaxChars: 1200, // ≈300 tokens
  liveContextMaxChars: 6000,
  liveJargonKeep: 12,
  liveQuestionKeep: 8,
  liveSuggestionKeep: 8,
  quickLookMaxCompletionTokens: 4096,
  // One extraction call per meeting over the full transcript; 3.x models also spend output on reasoning.
  extractionMaxCompletionTokens: 32768,
  askMaxCompletionTokens: 8192,
  quickLookHistoryTurns: 6,
  // All served from Vertex AI asia-south1 (Mumbai).
  models: {
    fast: 'gemini-3.5-flash-lite',
    big: 'gemini-3.5-flash',
    extraction: 'gemini-3.5-flash',
    ask: 'gemini-3.5-flash',
    quickLook: 'gemini-3.5-flash-lite',
    live: 'gemini-3.5-flash-lite',
  },
  modelChains: {
    fast: ['gemini-3.5-flash-lite'],
    // Fall back to Flash-Lite (still Mumbai) if Flash is unavailable.
    big: ['gemini-3.5-flash', 'gemini-3.5-flash-lite'],
  },
};

export function estimateTokenCount(text) {
  if (!text) return 0;
  return Math.ceil(text.length / AI_CONFIG.estimatedCharsPerToken);
}

export function capTranscriptContext(lines, {
  tokenCap = AI_CONFIG.transcriptTokenCap,
  reservedTokens = 4000,
} = {}) {
  const cappedLines = [];
  let totalTokens = 0;
  const maxTranscriptTokens = Math.max(1, tokenCap - reservedTokens);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const lineTokens = estimateTokenCount(line);
    if (cappedLines.length > 0 && totalTokens + lineTokens > maxTranscriptTokens) {
      break;
    }
    cappedLines.unshift(line);
    totalTokens += lineTokens;
  }

  return {
    text: cappedLines.join('\n'),
    estimatedTokens: totalTokens,
    truncated: cappedLines.length !== lines.length,
    lineCount: cappedLines.length,
  };
}
