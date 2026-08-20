export const AI_CONFIG = {
  transcriptTokenCap: 200000,
  estimatedCharsPerToken: 4,
  geminiRateLimitEnabled: true,
  geminiRequestsPerMinute: 5,
  geminiRateLimitWindowMs: 60_000,
  liveAnalysisIntervalMs: 25000,
  liveInsightMaxJargonItems: 4,
  liveQuestionMaxItems: 3,
  liveSuggestionMaxItems: 3,
  liveQuestionPartialTtlMs: 45000,
  liveAnalysisMaxCompletionTokens: 1200,
  highlightsMaxCompletionTokens: 1800,
  quickLookMaxCompletionTokens: 1000,
  minutesOfMeetingMaxCompletionTokens: 8192,
  quickLookHistoryTurns: 6,
  models: {
    fast: 'gemini-3.5-flash-lite',
    big: 'gemini-3.7-flash',
    highlights: 'gemini-3.7-flash',
    quickLook: 'gemini-3.5-flash-lite',
    minutesOfMeeting: 'gemini-3.7-flash',
    live: 'gemini-3.5-flash-lite',
    liveGujarati: 'gemini-3.5-flash-lite',
  },
  modelChains: {
    fast: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
    big: ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'],
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
