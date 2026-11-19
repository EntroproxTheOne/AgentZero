function formatTranscriptHeader({ truncated, lineCount, estimatedTokens }) {
  return [
    `Transcript lines included: ${lineCount}`,
    `Estimated transcript tokens: ${estimatedTokens}`,
    truncated ? 'Oldest transcript lines were trimmed to stay within the token budget.' : 'Full transcript context is included.',
  ].join('\n');
}

export function buildQuickLookPrompt({ transcriptText, contextMeta, question, chatHistory }) {
  const historyText = chatHistory.length === 0
    ? 'No prior chat history.'
    : chatHistory.map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.text}`).join('\n');

  return [
    'You are QuickLook for a meeting assistant.',
    'Answer the user using only the meeting transcript context when possible.',
    'Return valid JSON only.',
    '',
    'Return this exact JSON shape:',
    '{"answer":"string"}',
    '',
    'Rules:',
    '- Be direct and useful',
    '- Treat the meeting transcript as the primary source for meeting-specific facts',
    '- Use available Google Search when the transcript is incomplete or the user asks for outside, current, or general factual information',
    '- Do not let web results override a clear transcript fact; clearly distinguish outside context when both are relevant',
    '- If the transcript does not support a confident answer, say so briefly',
    '- Do not mention hidden reasoning',
    '',
    'Chat history:',
    historyText,
    '',
    `User question: ${question}`,
    '',
    formatTranscriptHeader(contextMeta),
    '',
    'Transcript:',
    transcriptText,
  ].join('\n');
}
