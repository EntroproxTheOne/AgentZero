// Ask a question across all (or a client's / project's) meetings.
// Every meeting contributes its summary, decisions and action items; full
// transcripts of the most relevant meetings are added until the budget is used.
import fs from 'fs/promises';
import { getDB } from '../db.js';
import { readArtifactsFile } from './artifactStore.js';
import { generateGeminiJson } from './providers/gemini.js';
import { parseJsonText } from './schemas.js';
import { extractionForPrompt } from './meetingAsk.js';
import { buildMeetingContext } from '../workspace.js';

const SUMMARY_BUDGET_CHARS = 160_000;
const TRANSCRIPT_BUDGET_CHARS = 320_000; // ~80k tokens on Flash-Lite in Mumbai
const STOPWORDS = new Set('the a an and or of to in on for with is are was were be been what which who whom when where why how did do does about from that this these those we our you your they their it its at by as any all me my i'.split(' '));

function tokenize(text) {
  return String(text ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

function score(questionTerms, text) {
  if (!questionTerms.size) return 0;
  const counts = new Map();
  for (const word of tokenize(text)) counts.set(word, (counts.get(word) ?? 0) + 1);
  let total = 0;
  for (const term of questionTerms) total += Math.log1p(counts.get(term) ?? 0);
  return total;
}

async function readTranscript(filePath, meetingId) {
  try {
    const entries = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return Array.isArray(entries)
      ? entries.map((entry, index) => `[M${meetingId}:L${index + 1}] ${entry.speakerLabel ?? 'Speaker'}: ${entry.text}`).join('\n')
      : '';
  } catch {
    return '';
  }
}

function dateLabel(ms) {
  return ms ? new Date(ms).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' }) : 'Unknown date';
}

export async function askAcrossMeetings({ question, clientId = null, projectId = null, history = [] }) {
  const cleanQuestion = String(question ?? '').trim();
  if (!cleanQuestion) throw new Error('Type a question first.');

  const filters = [];
  const params = [];
  if (clientId) { filters.push('(m.client_id = ? OR p.client_id = ?)'); params.push(Number(clientId), Number(clientId)); }
  if (projectId) { filters.push('m.project_id = ?'); params.push(Number(projectId)); }
  const meetings = getDB().prepare(`
    SELECT m.*, c.name AS client_name, p.name AS project_name
    FROM Meetings m
    LEFT JOIN Projects p ON p.id = m.project_id
    LEFT JOIN Clients c ON c.id = COALESCE(m.client_id, p.client_id)
    ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
    ORDER BY m.start_time_ms DESC
  `).all(...params);
  if (meetings.length === 0) {
    return { answer: 'There are no meetings to search yet for this selection.', citations: [], meetingsSearched: 0 };
  }

  const questionTerms = new Set(tokenize(cleanQuestion));
  const records = [];
  for (const meeting of meetings) {
    const artifacts = await readArtifactsFile(meeting.artifacts_path);
    // Each meeting's extraction is its record of truth (decisions with status and line evidence).
    const extraction = artifacts?.extraction;
    const highlights = artifacts?.highlights ?? {};
    const summary = [
      `### Meeting #${meeting.id}: ${meeting.title}`,
      `Date: ${dateLabel(meeting.start_time_ms)}${meeting.client_name ? ` · Client: ${meeting.client_name}` : ''}${meeting.project_name ? ` · Project: ${meeting.project_name}` : ''}`,
      meeting.agenda ? `Agenda: ${meeting.agenda}` : '',
      extraction
        ? `Record: ${JSON.stringify(extractionForPrompt(extraction))}`
        : highlights.summary ? `Summary: ${highlights.summary}` : '',
    ].filter(Boolean).join('\n');
    const transcript = await readTranscript(meeting.transcript_path, meeting.id);
    records.push({ meeting, summary, transcript, relevance: score(questionTerms, `${meeting.title} ${summary} ${transcript}`) });
  }

  let summaryChars = 0;
  const summaries = [];
  for (const record of records) {
    if (summaryChars + record.summary.length > SUMMARY_BUDGET_CHARS) break;
    summaries.push(record.summary);
    summaryChars += record.summary.length;
  }

  let transcriptChars = 0;
  const transcripts = [];
  for (const record of [...records].sort((a, b) => b.relevance - a.relevance)) {
    if (!record.transcript || record.relevance <= 0) continue;
    const room = TRANSCRIPT_BUDGET_CHARS - transcriptChars;
    if (room < 2000) break;
    const body = record.transcript.length > room ? `${record.transcript.slice(0, room)}\n…[transcript truncated]` : record.transcript;
    transcripts.push(`### Transcript of meeting #${record.meeting.id} (${record.meeting.title})\n${body}`);
    transcriptChars += body.length;
  }

  const context = (clientId || projectId)
    ? buildMeetingContext({ clientId, projectId }, { maxChars: 20_000 }).text
    : '';
  const historyText = (Array.isArray(history) ? history.slice(-6) : [])
    .map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.text}`).join('\n');

  const prompt = [
    'You answer questions about a business\'s past meetings, using only the meeting records below.',
    'Return valid JSON only, in this exact shape:',
    '{"answer":"string","citations":[{"meetingId":number,"lineId":number,"note":"string"}]}',
    '',
    'Rules:',
    '- Answer directly and concretely. Use short paragraphs or "- " bullets inside the answer string.',
    '- Mention which meeting each fact comes from by its title and date.',
    '- A meeting record\'s decisions marked "reversed" were changed later in that meeting: never give them as the outcome.',
    '- citations: the meetings (meetingId is the number after "#") and, where a transcript line supports it, the line (lineId from [M#:L#]); most important first, with a few words each.',
    '- If the records do not contain the answer, say so plainly. Never invent facts, figures, dates or names.',
    '- When meetings disagree, say so and give the most recent position.',
    '',
    historyText ? `Conversation so far:\n${historyText}\n` : '',
    `Question: ${cleanQuestion}`,
    '',
    `## Meeting records (${summaries.length} of ${records.length} meetings, newest first)`,
    summaries.join('\n\n'),
    '',
    transcripts.length ? '## Full transcripts of the most relevant meetings' : '',
    transcripts.join('\n\n'),
  ].join('\n');

  const response = await generateGeminiJson({
    tier: 'big',
    prompt,
    maxOutputTokens: 8192,
    purpose: 'ask-all',
    context,
  });
  const parsed = parseJsonText(response.text);
  const validIds = new Set(meetings.map((meeting) => meeting.id));
  const titles = new Map(meetings.map((meeting) => [meeting.id, { title: meeting.title, date: dateLabel(meeting.start_time_ms) }]));
  const citations = (Array.isArray(parsed?.citations) ? parsed.citations : [])
    .map((citation) => ({
      meetingId: Number(citation?.meetingId),
      lineId: Number.isInteger(Number(citation?.lineId)) && Number(citation?.lineId) > 0 ? Number(citation.lineId) : null,
      note: String(citation?.note ?? '').slice(0, 200),
    }))
    .filter((citation) => validIds.has(citation.meetingId))
    .slice(0, 8)
    .map((citation) => ({ ...citation, ...titles.get(citation.meetingId) }));

  return {
    answer: String(parsed?.answer ?? '').trim() || 'No answer was returned.',
    citations,
    meetingsSearched: records.length,
    transcriptsIncluded: transcripts.length,
  };
}
