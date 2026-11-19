// Ask after the meeting: the extraction object + the full speaker-labelled
// transcript + chat history, on the stronger Flash model. Facts from the
// meeting are cited as [L#] line ids so the UI can jump to the transcript.
// Templates (client email, internal checklist, task list, user-defined) render
// from the extraction object only, so they cannot contradict it.
import fs from 'fs/promises';
import { AI_CONFIG } from './config.js';
import { generateGeminiJson } from './providers/gemini.js';
import { extractLooseJsonStringField, parseJsonText } from './schemas.js';
import { readArtifactsFile, updateArtifactsFile } from './artifactStore.js';
import { numberedTranscript } from './extraction.js';
import { getDB } from '../db.js';
import { getMeetingContextForRow } from '../workspace.js';

async function loadMeeting(dbId) {
  const meeting = getDB().prepare(`
    SELECT m.*, c.name AS client_name FROM Meetings m LEFT JOIN Clients c ON c.id = m.client_id WHERE m.id = ?
  `).get(dbId);
  if (!meeting) throw new Error('Meeting not found');
  const artifacts = await readArtifactsFile(meeting.artifacts_path);
  let entries = [];
  try {
    entries = JSON.parse(await fs.readFile(meeting.transcript_path, 'utf8'));
  } catch {
    entries = [];
  }
  return { meeting, artifacts, entries: Array.isArray(entries) ? entries : [] };
}

/** The extraction without UI bookkeeping, for prompts. */
export function extractionForPrompt(extraction) {
  if (!extraction) return null;
  const { status: _s, updatedAt: _u, validationProblems: _v, ...rest } = extraction;
  return rest;
}

function citedLines(text, lineCount) {
  const ids = new Set();
  for (const match of String(text).matchAll(/\[L(\d+)\]/g)) {
    const id = Number(match[1]);
    if (id >= 1 && id <= lineCount) ids.add(id);
  }
  return [...ids];
}

export async function askMeeting({ dbId, question, history = [] }) {
  const cleanQuestion = String(question ?? '').trim();
  if (!cleanQuestion) throw new Error('Type a question first.');
  const { meeting, artifacts, entries } = await loadMeeting(dbId);
  if (entries.length === 0) throw new Error('This meeting has no transcript yet.');
  const historyText = (Array.isArray(history) ? history.slice(-8) : [])
    .map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.text}`).join('\n');
  const prompt = [
    'You answer questions about one meeting for the adviser who recorded it. Return valid JSON only: {"answer":"string"}',
    'Sources, in order of authority:',
    '1. The meeting record (decisions, tasks, figures). Decisions marked "reversed" were changed later in the meeting; never present them as the outcome.',
    '2. The full transcript, with line ids like [L12].',
    'Rules:',
    '- Cite every fact from the meeting with its line id in square brackets, e.g. "They agreed to prepay the car loan [L812]."',
    '- If the record and the transcript seem to disagree, trust the later lines of the transcript and say so.',
    '- "I" in a line means that line\'s speaker. Do not attribute words to someone who did not say them.',
    '- If the meeting does not answer the question, say so plainly. Do not invent facts, figures, names or dates.',
    '- When asked to draft something (an email, a note), write it fully, in plain text, ready to copy.',
    '',
    `Meeting: ${meeting.title}${meeting.client_name ? ` (client: ${meeting.client_name})` : ''}`,
    `Adviser (app owner): ${meeting.owner_name || 'the user'}`,
    artifacts?.speakerMap?.oneSided ? 'Only the adviser\'s side of this conversation was recorded.' : '',
    '',
    'Meeting record:',
    JSON.stringify(extractionForPrompt(artifacts?.extraction) ?? {}),
    '',
    historyText ? `Conversation so far:\n${historyText}\n` : '',
    `Question: ${cleanQuestion}`,
    '',
    'Transcript:',
    numberedTranscript(entries),
  ].filter(Boolean).join('\n');

  const response = await generateGeminiJson({
    tier: 'big',
    prompt,
    maxOutputTokens: AI_CONFIG.askMaxCompletionTokens,
    usageFile: meeting.artifacts_path,
    purpose: 'ask',
    context: getMeetingContextForRow(meeting).text,
  });
  let answer;
  try {
    answer = String(parseJsonText(response.text)?.answer ?? '').trim();
  } catch {
    answer = extractLooseJsonStringField(response.text, 'answer');
  }
  // "[L12, L13]" / "[L12-L14]" -> "[L12][L13]" so every citation is one tappable chip.
  answer = (answer || 'No answer was returned.').replace(/\[(L\d+(?:\s*[,;-]\s*L?\d+)+)\]/g, (_m, group) => (
    group.split(/\s*[,;-]\s*/).map((part) => `[L${part.replace(/^L/, '')}]`).join('')
  ));
  const citations = citedLines(answer, entries.length);
  await updateArtifactsFile(meeting.artifacts_path, (current) => ({
    ...current,
    ask: { history: [...(current.ask?.history ?? []), { role: 'user', text: cleanQuestion }, { role: 'ai', text: answer, citations }].slice(-40) },
  })).catch(() => {});
  return { answer, citations };
}

// ── Templates ──────────────────────────────────────────────────────────────
export function listTemplates() {
  return getDB().prepare('SELECT id, name, instructions, builtin FROM Templates ORDER BY id').all()
    .map((row) => ({ ...row, builtin: Boolean(row.builtin) }));
}

export function saveTemplate({ id, name, instructions }) {
  const cleanName = String(name ?? '').trim();
  const cleanInstructions = String(instructions ?? '').trim();
  if (!cleanName || !cleanInstructions) throw new Error('A template needs a name and instructions.');
  const db = getDB();
  if (id) {
    db.prepare('UPDATE Templates SET name = ?, instructions = ? WHERE id = ?').run(cleanName, cleanInstructions, id);
    return listTemplates();
  }
  db.prepare('INSERT INTO Templates (name, instructions, builtin, created_at) VALUES (?, ?, 0, ?)')
    .run(cleanName, cleanInstructions, new Date().toISOString());
  return listTemplates();
}

export function deleteTemplate(id) {
  getDB().prepare('DELETE FROM Templates WHERE id = ?').run(id);
  return listTemplates();
}

export async function runTemplate({ dbId, templateId }) {
  const template = getDB().prepare('SELECT * FROM Templates WHERE id = ?').get(templateId);
  if (!template) throw new Error('Template not found');
  const { meeting, artifacts } = await loadMeeting(dbId);
  const full = extractionForPrompt(artifacts?.extraction);
  if (!full) throw new Error('The meeting record is not ready yet.');
  // Client-facing text must not repeat what was later changed.
  const extraction = { ...full, decisions: full.decisions.filter((d) => d.status !== 'reversed'), action_items: full.action_items.filter((a) => a.status !== 'cancelled') };
  const prompt = [
    'You write a document from a meeting record. Return valid JSON only: {"text":"string"}',
    'The meeting record below is the only source of facts. Do not add decisions, tasks, figures, owners or dates that are not in it.',
    'Ignore decisions with status "reversed". Present "proposed", "discussed" and "unclear" items as not yet decided.',
    'Write plain text (simple "- " bullets allowed), ready to copy.',
    '',
    `Meeting: ${meeting.title}`,
    `Date: ${meeting.start_time_ms ? new Date(meeting.start_time_ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : 'unknown'}`,
    `Adviser (writes as "I"): ${meeting.owner_name || 'the adviser'}`,
    meeting.client_name ? `Client: ${meeting.client_name}` : '',
    '',
    `Instructions: ${template.instructions}`,
    '',
    'Meeting record:',
    JSON.stringify(extraction),
  ].filter(Boolean).join('\n');
  const response = await generateGeminiJson({
    tier: 'big',
    prompt,
    maxOutputTokens: AI_CONFIG.askMaxCompletionTokens,
    usageFile: meeting.artifacts_path,
    purpose: 'template',
  });
  let text;
  try {
    text = String(parseJsonText(response.text)?.text ?? '').trim();
  } catch {
    text = extractLooseJsonStringField(response.text, 'text');
  }
  return { text: text || 'Nothing was generated.', templateName: template.name };
}
