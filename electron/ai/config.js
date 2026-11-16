export const AI_CONFIG = {
  transcriptTokenCap: 200000,
  estimatedCharsPerToken: 4,
  geminiRateLimitEnabled: true,
  // Vertex AI on a billed project; the old 5/min cap was for the free API-key tier.
  geminiRequestsPerMinute: 60,
  geminiRateLimitWindowMs: 60_000,
  // Every 30 s, and only when new transcript arrived since the last run.
  liveAnalysisIntervalMs: 30000,
  // Roughly the last 10 minutes of speech; keeps live cost flat on long meetings.
  liveTranscriptTokenCap: 8000,
  // Background (agenda/client/project) budget for live calls; full budget for post-meeting.
  liveContextMaxChars: 6000,
  // Live panels accumulate across the meeting instead of being replaced each run.
  liveJargonKeep: 12,
  liveQuestionKeep: 8,
  liveSuggestionKeep: 8,
  liveInsightMaxJargonItems: 4,
  liveQuestionMaxItems: 3,
  liveSuggestionMaxItems: 3,
  liveQuestionPartialTtlMs: 45000,
  liveAnalysisMaxCompletionTokens: 4096,
  highlightsMaxCompletionTokens: 8192,
  quickLookMaxCompletionTokens: 4096,
  // 3.x models spend output tokens on reasoning; 8192 truncated long minutes' JSON.
  minutesOfMeetingMaxCompletionTokens: 16384,
  quickLookHistoryTurns: 6,
  // All served from Vertex AI asia-south1 (Mumbai).
  models: {
    fast: 'gemini-3.5-flash-lite',
    big: 'gemini-3.5-flash',
    highlights: 'gemini-3.5-flash',
    quickLook: 'gemini-3.5-flash-lite',
    minutesOfMeeting: 'gemini-3.5-flash',
    live: 'gemini-3.5-flash-lite',
    liveGujarati: 'gemini-3.5-flash-lite',
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
