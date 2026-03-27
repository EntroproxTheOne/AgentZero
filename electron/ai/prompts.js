function formatTranscriptHeader({ truncated, lineCount, estimatedTokens }) {
  return [
    `Transcript lines included: ${lineCount}`,
    `Estimated transcript tokens: ${estimatedTokens}`,
    truncated ? 'Oldest transcript lines were trimmed to stay within the token budget.' : 'Full transcript context is included.',
  ].join('\n');
}

export function buildLiveInsightsPrompt({ transcriptText, contextMeta }) {
  return [
    'You are a real-time meeting copilot.',
    'Analyze the transcript and return valid JSON only.',
    'Focus on what a normal meeting attendee would need right now.',
    'Keep all outputs concise, useful, and grounded in what was actually said.',
    'Infer the meeting domain or industry from the transcript and use that context when selecting jargon.',
    '',
    'Return this exact JSON shape:',
    '{"jargon":[{"term":"string","explanation":"string"}],"liveQuestions":[{"text":"string"}],"suggestions":[{"text":"string","type":"action|insight|followup"}]}',
    '',
    'Rules:',
    '- Order each list from most valuable or most recent first',
    '- jargon: include only non-obvious, domain-specific, or technical terms worth explaining right now',
    '- jargon: prefer complex industry language, abbreviations, frameworks, metrics, or architecture terms over generic business words',
    '- jargon: keep explanations plain-English, concise, and specific to how the term is being used in this meeting',
    '- jargon: return 0 to 4 items',
    '- liveQuestions: return 0 to 3 likely clarification questions an attentive attendee may ask next',
    '- liveQuestions: every question must be complete, standalone, and end with a question mark',
    '- liveQuestions: if there are only 1 or 2 good questions, return only those; never pad to 3',
    '- suggestions: return 0 to 3 practical suggestions addressed to the meeting assistant user as "you"',
    '- suggestions: focus on what you should ask, clarify, improve, or pay attention to next',
    '- suggestions: if a demo, pitch, or explanation is happening, suggestions may comment on how it is landing and what you should tighten',
    '- suggestions: do not give generic team-wide project management advice; make it personally useful for the user',
    '- suggestions: type must be action, insight, or followup',
    '- Avoid duplicates and keep lists short',
    '- If a section has nothing meaningful, return an empty array for that section',
    '',
    formatTranscriptHeader(contextMeta),
    '',
    'Transcript:',
    transcriptText,
  ].join('\n');
}

export function buildMeetingHighlightsPrompt({ transcriptText, contextMeta, meetingTitle }) {
  return [
    'You are generating structured meeting highlights for a commercial meeting assistant.',
    'Return valid JSON only.',
    `Meeting title: ${meetingTitle || 'Untitled Meeting'}`,
    '',
    'Return this exact JSON shape:',
    '{"summary":"string","keyDiscussionPoints":["string"],"actionItems":["string"]}',
    '',
    'Rules:',
    '- summary: 3 to 5 sentences, clear and concrete',
    '- keyDiscussionPoints: concise bullets capturing decisions, updates, blockers, or notable discussion points',
    '- actionItems: concrete next steps only',
    '- Use only transcript-grounded information',
    '- If action items are not explicit, infer only obvious next steps and keep them conservative',
    '',
    formatTranscriptHeader(contextMeta),
    '',
    'Transcript:',
    transcriptText,
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

export function buildMinutesOfMeetingPrompt({
  transcriptText,
  contextMeta,
  meetingTitle,
  highlights,
  meetingMeta,
}) {
  const highlightsContext = highlights?.summary
    ? [
      `Existing summary: ${highlights.summary}`,
      `Existing key discussion points: ${(highlights.keyDiscussionPoints ?? []).join(' | ') || 'None'}`,
      `Existing action items: ${(highlights.actionItems ?? []).join(' | ') || 'None'}`,
    ].join('\n')
    : 'No prior meeting highlights are available.';

  const meetingFacts = [
    `Meeting title: ${meetingTitle || 'Untitled Meeting'}`,
    `Meeting date: ${meetingMeta?.dateLabel || 'Unknown'}`,
    `Approximate duration: ${meetingMeta?.durationLabel || 'Unknown'}`,
    `Speaker count: ${meetingMeta?.speakerCount ?? 'Unknown'}`,
  ].join('\n');

  return [
    'You are generating a high-quality Minutes of Meeting document for a commercial meeting assistant.',
    'Return valid JSON only.',
    'The output must be accurate, polished, and strictly grounded in the transcript.',
    'Prefer precision over completeness when the transcript is ambiguous.',
    '',
    'CRITICAL: Keep the total JSON output compact to avoid truncation. Each string value must be concise. Do NOT produce verbose multi-paragraph text in any field.',
    '',
    'Return this exact JSON shape:',
    '{"title":"string","overview":"string","discussionPoints":["string"],"decisions":["string"],"actionItems":[{"task":"string","owner":"string","deadline":"string","status":"string","notes":"string"}],"risksAndBlockers":["string"],"followUps":["string"]}',
    '',
    'Rules:',
    '- overview: 1 to 2 concise paragraphs, max 150 words total',
    '- discussionPoints: max 6 bullets, each max 1-2 sentences',
    '- decisions: max 6, include only decisions or explicit directional agreements, each max 1-2 sentences',
    '- actionItems: max 8 concrete next steps only; use "Unassigned" if owner is unknown and "Not specified" if deadline is unknown',
    '- actionItems.task: max 1-2 sentences',
    '- actionItems.notes: max 1 sentence or empty string',
    '- actionItems.status should be one of: Open, In Progress, Blocked, Scheduled, Not specified',
    '- risksAndBlockers: max 4 material blockers, each max 1-2 sentences',
    '- followUps: max 4 open questions, each max 1-2 sentences',
    '- Do not invent facts, owners, or deadlines beyond what the transcript strongly supports',
    '- Keep language polished enough for stakeholder sharing',
    '',
    meetingFacts,
    '',
    'Existing highlights for reference:',
    highlightsContext,
    '',
    formatTranscriptHeader(contextMeta),
    '',
    'Transcript:',
    transcriptText,
  ].join('\n');
}
