// One source of truth per meeting: a single extraction call over the full
// speaker-labelled transcript. Highlights, minutes, the MoM export, Ask and the
// templates all read this object; nothing else extracts decisions or tasks.
import { AI_CONFIG } from './config.js';
import { generateGeminiJson } from './providers/gemini.js';
import { parseJsonText } from './schemas.js';
import { readArtifactsFile, updateArtifactsFile } from './artifactStore.js';
import { normalizeText, normalizeTranscriptEntries } from '../text/normalize.js';
import { getDB } from '../db.js';

const DECISION_STATUS = ['confirmed', 'proposed', 'discussed', 'unclear', 'reversed'];
const TASK_STATUS = ['confirmed', 'tentative', 'cancelled'];

/** Transcript lines as the model sees them: line ids are 1-based entry positions. */
export function numberedTranscript(entries) {
  return normalizeTranscriptEntries(entries)
    .map((entry, index) => `[L${index + 1}] ${entry.speakerLabel || 'Speaker'}: ${entry.text}`)
    .join('\n');
}

function buildPrompt({ title, transcript, ownerName, speakerNames, oneSided, problems }) {
  return [
    'You extract the record of a meeting for a wealth adviser. Return valid JSON only.',
    `Meeting title: ${title || 'Untitled Meeting'}`,
    `The app owner (the adviser) is "${ownerName}". Lines labelled "${ownerName}" are his words.`,
    speakerNames.length ? `Speakers in this transcript: ${speakerNames.join(', ')}.` : '',
    oneSided
      ? 'ONLY THE OWNER\'S SIDE WAS RECORDED. The other party cannot be heard. Never state what the other party said, decided or committed to; record only what the owner said and mark anything that depends on the other side as "unclear".'
      : '',
    '',
    'Return exactly this shape:',
    '{"title":"3-8 word topic title","summary":"3-5 sentences",',
    ' "key_points":[{"text":"...","line_ids":[12]}],',
    ' "decisions":[{"id":"d1","topic":"car loan","statement":"Prepay the remaining car loan","status":"confirmed|proposed|discussed|unclear|reversed","evidence":[{"line_id":812,"speaker":"name","quote":"short exact quote"}],"superseded_by":null}],',
    ' "action_items":[{"id":"a1","task":"...","owner":"<speaker name>|UNASSIGNED","owner_evidence_line_id":640,"due":null,"status":"confirmed|tentative|cancelled"}],',
    ' "figures":[{"label":"capital gain","value":"14 lakh","line_id":233}],',
    ' "documents_requested":[{"item":"...","from":"<name>","line_id":0}],',
    ' "open_questions":[{"text":"...","line_id":0}]}',
    '',
    'Rules:',
    '- Every decision needs at least one evidence item citing a real [L#] line. Without evidence, use status "unclear".',
    '- Every owner other than UNASSIGNED needs owner_evidence_line_id: the line where that person took or was given the task. Otherwise owner is "UNASSIGNED".',
    '- Read the WHOLE transcript. A later decision on the same topic supersedes an earlier one: mark the earlier one "reversed" and set its superseded_by to the later decision id.',
    '- If options were discussed with no conclusion, status is "discussed". Use "confirmed" only when both sides clearly agreed or the owner clearly decided.',
    '- One decision per topic outcome. Use the same short topic name for decisions about the same thing.',
    '- "I", "me", "my" mean the speaker of that line. Never assign a first-person statement to anyone else, and never resolve "I" to a name unless that line\'s speaker label is a name.',
    '- Use speaker names exactly as labelled. Do not invent names, figures, dates or owners.',
    '- figures: amounts, rates and dates stated in the meeting, copied as said.',
    '- quote: at most 20 words copied from the cited line.',
    problems?.length ? `\nYour previous answer was rejected for these reasons. Fix them:\n- ${problems.join('\n- ')}` : '',
    '',
    'Transcript:',
    transcript,
  ].filter((line) => line !== '').join('\n');
}

const str = (value) => (typeof value === 'string' ? value.trim() : '');
const lineId = (value) => (Number.isInteger(Number(value)) ? Number(value) : null);
const topicKey = (value) => str(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const words = (text) => String(text ?? '').toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** True when most of the quote's words are on the cited line (models paraphrase slightly). */
export function quoteMatches(quote, lineText) {
  const quoteWords = words(quote);
  if (quoteWords.length === 0) return true;
  const lineWords = new Set(words(lineText));
  const hits = quoteWords.filter((word) => lineWords.has(word)).length;
  return hits / quoteWords.length >= 0.6;
}

/**
 * Normalise and check against the transcript itself. Returns { value, problems }.
 * entries: the transcript entries the [L#] ids refer to (1-based).
 */
export function validateExtraction(raw, entries) {
  const lines = normalizeTranscriptEntries(Array.isArray(entries) ? entries : []);
  const lineCount = lines.length;
  const problems = [];
  const validLine = (id) => id !== null && id >= 1 && id <= lineCount;
  const speakerNames = new Map(lines.map((line) => [String(line.speakerLabel ?? '').toLowerCase(), line.speakerLabel]));

  const decisions = (Array.isArray(raw?.decisions) ? raw.decisions : []).map((item, index) => {
    const evidence = (Array.isArray(item?.evidence) ? item.evidence : []).map((ev) => ({
      line_id: lineId(ev?.line_id), speaker: str(ev?.speaker), quote: str(ev?.quote).slice(0, 240),
    }));
    const bad = evidence.filter((ev) => !validLine(ev.line_id));
    if (bad.length) problems.push(`Decision "${str(item?.statement)}" cites line ids that do not exist (${bad.map((ev) => ev.line_id).join(', ')}).`);
    const misquoted = evidence.filter((ev) => validLine(ev.line_id) && !quoteMatches(ev.quote, lines[ev.line_id - 1].text));
    if (misquoted.length) problems.push(`Decision "${str(item?.statement)}" quotes words that are not on line(s) ${misquoted.map((ev) => ev.line_id).join(', ')}.`);
    // Speaker always comes from the transcript, never from the model.
    const good = evidence
      .filter((ev) => validLine(ev.line_id) && quoteMatches(ev.quote, lines[ev.line_id - 1].text))
      .map((ev) => ({ ...ev, speaker: lines[ev.line_id - 1].speakerLabel || ev.speaker }));
    let status = DECISION_STATUS.includes(item?.status) ? item.status : 'unclear';
    if (good.length === 0 && status !== 'unclear') problems.push(`Decision "${str(item?.statement)}" has no evidence.`);
    return {
      id: str(item?.id) || `d${index + 1}`,
      topic: str(item?.topic) || str(item?.statement).split(/\s+/).slice(0, 3).join(' '),
      statement: str(item?.statement),
      status,
      evidence: good,
      superseded_by: str(item?.superseded_by) || null,
    };
  }).filter((item) => item.statement);

  // A decision that names a later decision as its replacement is reversed.
  const ids = new Set(decisions.map((d) => d.id));
  for (const decision of decisions) {
    if (decision.superseded_by && !ids.has(decision.superseded_by)) decision.superseded_by = null;
    if (decision.superseded_by && decision.status !== 'reversed') decision.status = 'reversed';
  }

  const byTopic = new Map();
  for (const decision of decisions) {
    if (decision.status !== 'confirmed') continue;
    const key = topicKey(decision.topic);
    byTopic.set(key, [...(byTopic.get(key) ?? []), decision]);
  }
  for (const [topic, group] of byTopic) {
    if (group.length > 1 && new Set(group.map((d) => topicKey(d.statement))).size > 1) {
      problems.push(`Decisions ${group.map((d) => d.id).join(', ')} share the topic "${topic}". If one replaced the other, mark the earlier one reversed; if they are separate decisions, give each a more specific topic.`);
    }
  }

  const actionItems = (Array.isArray(raw?.action_items) ? raw.action_items : []).map((item, index) => {
    let owner = str(item?.owner) || 'UNASSIGNED';
    const ownerLine = lineId(item?.owner_evidence_line_id);
    if (owner.toUpperCase() === 'UNASSIGNED') owner = 'UNASSIGNED';
    else if (!speakerNames.has(owner.toLowerCase())) {
      problems.push(`Task "${str(item?.task)}" has owner "${owner}", who is not a speaker in the transcript. Use a speaker name or UNASSIGNED.`);
    } else {
      owner = speakerNames.get(owner.toLowerCase());
    }
    if (owner !== 'UNASSIGNED' && !validLine(ownerLine)) {
      problems.push(`Task "${str(item?.task)}" has owner ${owner} without a valid owner_evidence_line_id.`);
    }
    return {
      id: str(item?.id) || `a${index + 1}`,
      task: str(item?.task),
      owner,
      owner_evidence_line_id: validLine(ownerLine) ? ownerLine : null,
      due: str(item?.due) || null,
      status: TASK_STATUS.includes(item?.status) ? item.status : 'tentative',
      done: false,
    };
  }).filter((item) => item.task);

  const withLine = (list, fields) => (Array.isArray(list) ? list : []).map((item) => {
    const out = {};
    for (const field of fields) out[field] = str(item?.[field]);
    out.line_id = validLine(lineId(item?.line_id)) ? lineId(item.line_id) : null;
    return out;
  }).filter((item) => item[fields[0]]);

  // Ids must be unique (they key the MeetingItems rows and user edits).
  const uniqueIds = (list, prefix) => {
    const seen = new Set();
    return list.map((item, index) => {
      let id = item.id;
      if (seen.has(id)) id = `${prefix}${index + 1}x`;
      seen.add(id);
      return id === item.id ? item : { ...item, id };
    });
  };

  const value = {
    title: str(raw?.title),
    summary: str(raw?.summary),
    key_points: (Array.isArray(raw?.key_points) ? raw.key_points : []).map((item) => ({
      text: str(typeof item === 'string' ? item : item?.text),
      line_ids: (Array.isArray(item?.line_ids) ? item.line_ids : []).map(lineId).filter(validLine),
    })).filter((item) => item.text),
    decisions: uniqueIds(decisions, 'd'),
    action_items: uniqueIds(actionItems, 'a'),
    figures: withLine(raw?.figures, ['label', 'value']),
    documents_requested: withLine(raw?.documents_requested, ['item', 'from']),
    open_questions: withLine(raw?.open_questions, ['text']),
  };
  if (!value.summary) problems.push('summary is missing.');
  return { value, problems };
}

/** After a failed retry: keep the record, but never show unsupported items as settled. */
function quarantine(value, entries) {
  const known = new Set(normalizeTranscriptEntries(entries).map((line) => String(line.speakerLabel ?? '').toLowerCase()));
  const latestByTopic = new Map();
  const lastLine = (d) => Math.max(0, ...d.evidence.map((ev) => ev.line_id));
  for (const d of value.decisions) {
    if (d.status !== 'confirmed') continue;
    const key = topicKey(d.topic);
    const current = latestByTopic.get(key);
    if (!current || lastLine(d) > lastLine(current)) latestByTopic.set(key, d);
  }
  return {
    ...value,
    decisions: value.decisions.map((d) => {
      if (d.evidence.length === 0) return { ...d, status: 'unclear' };
      if (d.status === 'confirmed' && latestByTopic.get(topicKey(d.topic)) !== d) return { ...d, status: 'unclear' };
      return d;
    }),
    action_items: value.action_items.map((a) => (
      a.owner !== 'UNASSIGNED' && (!a.owner_evidence_line_id || !known.has(a.owner.toLowerCase())) ? { ...a, owner: 'UNASSIGNED' } : a
    )),
  };
}

// ── Views derived from the extraction ──────────────────────────────────────
const STATUS_NOTE = { proposed: ' (proposed)', discussed: ' (discussed, no decision)', unclear: ' (unclear)' };

export function taskLine(task) {
  const owner = task.owner === 'UNASSIGNED' ? '' : `${task.owner}: `;
  return `${owner}${task.task}${task.due ? ` (by ${task.due})` : ''}${task.status === 'tentative' ? ' (tentative)' : ''}`;
}

export function deriveViews(extraction, title) {
  const liveDecisions = extraction.decisions.filter((d) => d.status !== 'reversed');
  const openTasks = extraction.action_items.filter((a) => a.status !== 'cancelled');
  const highlights = {
    status: 'ready',
    updatedAt: new Date().toISOString(),
    error: null,
    summary: extraction.summary,
    keyDiscussionPoints: extraction.key_points.map((point) => point.text),
    actionItems: openTasks.map(taskLine),
  };
  const minutes = {
    status: 'ready',
    source: 'extraction',
    updatedAt: new Date().toISOString(),
    error: null,
    content: {
      title: normalizeText(title) || extraction.title || 'Untitled Meeting',
      overview: extraction.summary,
      discussionPoints: extraction.key_points.map((point) => point.text),
      decisions: liveDecisions.map((d) => `${d.statement}${STATUS_NOTE[d.status] ?? ''}`),
      actionItems: openTasks.map((a) => ({
        task: a.task,
        owner: a.owner === 'UNASSIGNED' ? 'Unassigned' : a.owner,
        deadline: a.due || 'Not specified',
        status: a.done ? 'Done' : a.status === 'tentative' ? 'Tentative' : 'Open',
        notes: '',
      })),
      risksAndBlockers: [],
      followUps: [
        ...extraction.documents_requested.map((doc) => `${doc.from ? `${doc.from} to send: ` : 'Documents needed: '}${doc.item}`),
        ...extraction.open_questions.map((q) => q.text),
      ].slice(0, 12),
    },
  };
  return { highlights, minutes };
}

/** Mirror decisions and tasks into MeetingItems (cross-meeting queries, future CRM sync). */
export function syncMeetingItems(dbId, extraction) {
  const db = getDB();
  const meeting = db.prepare('SELECT client_id FROM Meetings WHERE id = ?').get(dbId);
  if (!meeting) return;
  const at = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO MeetingItems (meeting_id, client_id, kind, ext_id, topic, text, owner, due, status, line_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    db.prepare('DELETE FROM MeetingItems WHERE meeting_id = ?').run(dbId);
    for (const d of extraction.decisions) {
      insert.run(dbId, meeting.client_id ?? null, 'decision', d.id, d.topic, d.statement, null, null, d.status, d.evidence[0]?.line_id ?? null, at);
    }
    for (const a of extraction.action_items) {
      insert.run(dbId, meeting.client_id ?? null, 'task', a.id, null, a.task, a.owner, a.due, a.done ? 'done' : a.status, a.owner_evidence_line_id, at);
    }
  })();
}

function keepUserEdits(fresh, previous) {
  const merge = (list, old) => {
    const edited = (old ?? []).filter((item) => item.edited);
    const editedIds = new Set(edited.map((item) => item.id));
    return [...list.filter((item) => !editedIds.has(item.id)), ...edited];
  };
  return { ...fresh, decisions: merge(fresh.decisions, previous.decisions), action_items: merge(fresh.action_items, previous.action_items) };
}

/** Save a record (or apply a change to the current one) inside the artifacts write queue. */
async function saveExtraction(session, extractionOrUpdater, meta, { clearStale = false } = {}) {
  const updated = await updateArtifactsFile(session.artifactsPath, (current) => {
    const extraction = typeof extractionOrUpdater === 'function' ? extractionOrUpdater(current.extraction) : extractionOrUpdater;
    const views = deriveViews(extraction, session.title);
    return {
      ...current,
      extraction: { ...extraction, status: 'ready', updatedAt: new Date().toISOString(), ...meta },
      // Only a fresh run clears "summary out of date"; edits keep it as it was.
      extractionStale: clearStale ? false : Boolean(current.extractionStale),
      highlights: views.highlights,
      minutesOfMeeting: views.minutes,
    };
  });
  if (session.dbId) syncMeetingItems(session.dbId, updated.extraction);
  return updated;
}

/**
 * Run the extraction for a meeting session (full transcript, one call, one retry).
 * session: { dbId, title, transcriptEntries, artifactsPath, contextText, ownerName, oneSided }
 */
export async function runExtraction(session) {
  const entries = session.transcriptEntries ?? [];
  const transcript = numberedTranscript(entries);
  const speakerNames = [...new Set(entries.map((entry) => entry.speakerLabel).filter(Boolean))];
  await updateArtifactsFile(session.artifactsPath, (current) => ({
    ...current,
    highlights: { ...(current.highlights ?? {}), status: 'loading', error: null },
  }));
  let problems = [];
  let result = null;
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await generateGeminiJson({
        tier: 'big',
        prompt: buildPrompt({
          title: session.title,
          transcript,
          ownerName: session.ownerName || 'You',
          speakerNames,
          oneSided: Boolean(session.oneSided),
          problems: attempt ? problems : null,
        }),
        maxOutputTokens: AI_CONFIG.extractionMaxCompletionTokens,
        usageFile: session.artifactsPath,
        purpose: 'extraction',
        context: session.contextText ?? '',
      });
      result = validateExtraction(parseJsonText(response.text), entries);
      problems = result.problems;
      if (problems.length === 0) break;
      console.warn(`[Extraction] Attempt ${attempt + 1} rejected:`, problems.join(' | '));
    }
    const fresh = problems.length ? quarantine(result.value, entries) : result.value;
    // Items the user edited by hand survive a re-run (e.g. after a speaker correction).
    const previous = (await readArtifactsFile(session.artifactsPath))?.extraction;
    const extraction = previous ? keepUserEdits(fresh, previous) : fresh;
    return await saveExtraction(session, extraction, { validationProblems: problems, oneSided: Boolean(session.oneSided) }, { clearStale: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateArtifactsFile(session.artifactsPath, (current) => ({
      ...current,
      highlights: { ...(current.highlights ?? {}), status: 'error', error: message },
    }));
    throw error;
  }
}

/** A user edit to a decision or task: applied inside the write queue, all views refreshed. */
export async function editExtractionItem({ dbId, artifactsPath, title, kind, id, patch }) {
  const artifacts = await readArtifactsFile(artifactsPath);
  if (!artifacts?.extraction) throw new Error('This meeting has no extracted record yet.');
  const list = kind === 'decision' ? 'decisions' : 'action_items';
  const allowed = kind === 'decision' ? ['statement', 'status', 'topic'] : ['task', 'owner', 'due', 'status', 'done'];
  const clean = Object.fromEntries(Object.entries(patch ?? {}).filter(([key]) => allowed.includes(key)));
  if (clean.status && !(kind === 'decision' ? DECISION_STATUS : TASK_STATUS).includes(clean.status)) delete clean.status;
  return saveExtraction({ dbId, artifactsPath, title }, (extraction) => {
    let items;
    if (patch?.delete) items = extraction[list].filter((item) => item.id !== id);
    else if (!extraction[list].some((item) => item.id === id) && kind === 'task') {
      items = [...extraction[list], { id, task: '', owner: 'UNASSIGNED', owner_evidence_line_id: null, due: null, status: 'confirmed', done: false, ...clean, edited: true }];
    } else items = extraction[list].map((item) => (item.id === id ? { ...item, ...clean, edited: true } : item));
    return { ...extraction, [list]: items };
  }, {});
}
