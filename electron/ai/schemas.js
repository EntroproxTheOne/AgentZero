
function isString(value) {
  return typeof value === 'string';
}

export function parseJsonText(rawText) {
  const text = typeof rawText === 'string' ? rawText.trim() : '';
  if (!text) {
    throw new Error('Model returned an empty response');
  }

  try {
    return JSON.parse(text);
  } catch {
    // Attempt programmatic salvage of truncated JSON before giving up
    const salvaged = salvageTruncatedJson(text);
    if (salvaged) {
      try {
        return JSON.parse(salvaged);
      } catch {
        // fall through
      }
    }
    throw new Error(`Invalid JSON response even after salvage attempt`);
  }
}

/**
 * Best-effort repair of truncated JSON (e.g. when Gemini stops mid-output).
 * Tries closing unterminated strings and balancing brackets, then
 * progressively trims trailing tokens until JSON.parse succeeds.
 * Returns null if nothing works.
 */
export function salvageTruncatedJson(text) {
  if (typeof text !== 'string' || !text.trim()) return null;

  let json = text.trim();

  // Must start with { or [
  if (json[0] !== '{' && json[0] !== '[') return null;

  // Quick attempt: close strings + balance brackets
  const quick = closeAndBalance(json);
  try { JSON.parse(quick); return quick; } catch { /* continue */ }

  // Progressive trimming: strip trailing tokens and retry
  let candidate = json;
  for (let attempt = 0; attempt < 30; attempt++) {
    // Remove last "token" — a quoted string, a word, a number, or a single char
    candidate = candidate.replace(
      /(?:"(?:[^"\\]|\\.)*"\s*|[a-zA-Z0-9_.]+\s*|.\s*)$/s,
      '',
    );
    candidate = candidate.trim();
    if (!candidate || candidate.length < 2) return null;

    // Strip trailing commas, colons, incomplete key-value separators
    candidate = candidate.replace(/[,:]\s*$/, '');

    const attempt_json = closeAndBalance(candidate);
    try { JSON.parse(attempt_json); return attempt_json; } catch { /* continue */ }
  }

  return null;
}

/** Close an unterminated string, strip trailing commas, and balance brackets/braces. */
function closeAndBalance(json) {
  let result = json;

  // Close unterminated string
  let inString = false;
  let prevBackslash = false;
  for (let i = 0; i < result.length; i++) {
    const ch = result[i];
    if (inString) {
      if (ch === '"' && !prevBackslash) inString = false;
      prevBackslash = ch === '\\' && !prevBackslash;
    } else {
      if (ch === '"') inString = true;
      prevBackslash = false;
    }
  }
  if (inString) result += '"';

  // Strip trailing commas
  result = result.replace(/,\s*$/, '');

  // Balance brackets and braces
  const stack = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < result.length; i++) {
    const ch = result[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\' && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if ((ch === '}' || ch === ']') && stack.length) stack.pop();
  }
  while (stack.length > 0) result += stack.pop();

  return result;
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
    .slice(0, 4);
  normalized.liveQuestions = uniqueByKey(normalized.liveQuestions, (item) => item.text.toLowerCase())
    .slice(0, 3);
  normalized.suggestions = uniqueByKey(normalized.suggestions, (item) => `${item.type}:${item.text.toLowerCase()}`)
    .slice(0, 3);

  return normalized;
}

export function validateQuickLook(payload) {
  const answer = isString(payload?.answer) ? payload.answer.trim() : '';
  if (!answer) {
    throw new Error('QuickLook response is missing answer');
  }

  return { answer };
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
