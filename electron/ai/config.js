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
  minutesOfMeetingMaxCompletionTokens: 2400,
  quickLookHistoryTurns: 6,
  models: {
    highlights: 'gemini-2.5-flash',
    quickLook: 'gemini-2.5-flash',
    minutesOfMeeting: 'gemini-2.5-flash',
    live: 'openai/gpt-oss-120b',
    liveGujarati: 'gemini-2.5-flash-lite',
  },
  liveAnalysisGeminiLiteExcludedLanguages: ['en-IN', 'hi-IN'],
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
