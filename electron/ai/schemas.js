import { AI_CONFIG } from './config.js';

function isString(value) {
  return typeof value === 'string';
}

function isStringArray(value) {
  return Array.isArray(value) && value.every(isString);
}

function uniqueTrimmedStrings(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    result.push(trimmed);
  }

  return result;
}

export function parseJsonText(rawText) {
  const text = typeof rawText === 'string' ? rawText.trim() : '';
  if (!text) {
    throw new Error('Model returned an empty response');
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON response: ${error.message}`);
  }
}

export function validateLiveInsights(payload) {
  const jargon = Array.isArray(payload?.jargon) ? payload.jargon : [];
  const liveQuestions = Array.isArray(payload?.liveQuestions) ? payload.liveQuestions : [];
  const suggestions = Array.isArray(payload?.suggestions) ? payload.suggestions : [];

  const normalized = {
    jargon: [],
    liveQuestions: [],
    suggestions: [],
  };

  for (const item of jargon) {
    if (!isString(item?.term) || !isString(item?.explanation)) continue;
    normalized.jargon.push({
      term: item.term.trim(),
      explanation: item.explanation.trim(),
    });
  }

  for (const item of liveQuestions) {
    if (!isString(item?.text)) continue;
    normalized.liveQuestions.push({ text: item.text.trim() });
  }

  for (const item of suggestions) {
    if (!isString(item?.text)) continue;
    const type = item?.type;
    if (!['action', 'insight', 'followup'].includes(type)) continue;
    normalized.suggestions.push({
      text: item.text.trim(),
      type,
    });
  }

  normalized.jargon = uniqueByKey(normalized.jargon, (item) => item.term.toLowerCase())
    .slice(0, AI_CONFIG.liveInsightMaxJargonItems);
  normalized.liveQuestions = uniqueByKey(normalized.liveQuestions, (item) => item.text.toLowerCase())
    .slice(0, AI_CONFIG.liveQuestionMaxItems);
  normalized.suggestions = uniqueByKey(normalized.suggestions, (item) => `${item.type}:${item.text.toLowerCase()}`)
    .slice(0, AI_CONFIG.liveSuggestionMaxItems);

  return normalized;
}

export function validateHighlights(payload) {
  const summary = isString(payload?.summary) ? payload.summary.trim() : '';
  const keyDiscussionPoints = isStringArray(payload?.keyDiscussionPoints)
    ? uniqueTrimmedStrings(payload.keyDiscussionPoints)
    : [];
  const actionItems = isStringArray(payload?.actionItems)
    ? uniqueTrimmedStrings(payload.actionItems)
    : [];

  if (!summary) {
    throw new Error('Highlights response is missing summary');
  }

  return {
    summary,
    keyDiscussionPoints,
    actionItems,
  };
}

export function validateQuickLook(payload) {
  const answer = isString(payload?.answer) ? payload.answer.trim() : '';
  if (!answer) {
    throw new Error('QuickLook response is missing answer');
  }

  return { answer };
}

export function validateMinutesOfMeeting(payload) {
  const title = isString(payload?.title) ? payload.title.trim() : '';
  const overview = isString(payload?.overview) ? payload.overview.trim() : '';
  const discussionPoints = isStringArray(payload?.discussionPoints)
    ? uniqueTrimmedStrings(payload.discussionPoints)
    : [];
  const decisions = isStringArray(payload?.decisions)
    ? uniqueTrimmedStrings(payload.decisions)
    : [];
  const risksAndBlockers = isStringArray(payload?.risksAndBlockers)
    ? uniqueTrimmedStrings(payload.risksAndBlockers)
    : [];
  const followUps = isStringArray(payload?.followUps)
    ? uniqueTrimmedStrings(payload.followUps)
    : [];
  const actionItems = Array.isArray(payload?.actionItems)
    ? payload.actionItems
      .map((item) => normalizeMomActionItem(item))
      .filter(Boolean)
    : [];

  if (!title) {
    throw new Error('Minutes of meeting response is missing title');
  }

  if (!overview) {
    throw new Error('Minutes of meeting response is missing overview');
  }

  return {
    title,
    overview,
    discussionPoints,
    decisions,
    actionItems,
    risksAndBlockers,
    followUps,
  };
}

export function extractLooseJsonStringField(rawText, fieldName) {
  const text = typeof rawText === 'string' ? rawText.trim() : '';
  if (!text) return '';

  const quotedFieldPattern = new RegExp(`"${escapeRegExp(fieldName)}"\\s*:\\s*"([\\s\\S]*)"\\s*}\\s*$`);
  const quotedFieldMatch = text.match(quotedFieldPattern);
  if (quotedFieldMatch?.[1]) {
    return decodeLooseJsonString(quotedFieldMatch[1]).trim();
  }

  const plainFieldPattern = new RegExp(`"${escapeRegExp(fieldName)}"\\s*:\\s*([^\\n\\r}]+)`);
  const plainFieldMatch = text.match(plainFieldPattern);
  if (plainFieldMatch?.[1]) {
    return plainFieldMatch[1].trim().replace(/^"+|"+$/g, '');
  }

  return '';
}

function uniqueByKey(items, getKey) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const key = getKey(item);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}

function normalizeMomActionItem(item) {
  if (!item || !isString(item.task)) return null;

  const task = item.task.trim();
  if (!task) return null;

  return {
    task,
    owner: isString(item.owner) && item.owner.trim() ? item.owner.trim() : 'Unassigned',
    deadline: isString(item.deadline) && item.deadline.trim() ? item.deadline.trim() : 'Not specified',
    status: isString(item.status) && item.status.trim() ? item.status.trim() : 'Not specified',
    notes: isString(item.notes) && item.notes.trim() ? item.notes.trim() : '',
  };
}

function decodeLooseJsonString(value) {
  return value
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
