// Clients, projects and their context documents, plus the meeting context
// block every AI call receives. Documents are stored as extracted text.
import fs from 'fs/promises';
import path from 'path';
import { getDB } from './db.js';
import { extractDocumentText } from './ai/providers/gemini.js';

const MAX_DOC_CHARS = 200_000;
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.csv', '.json', '.tsv', '.log']);
export const SUPPORTED_DOC_EXTENSIONS = [...TEXT_EXTENSIONS, '.pdf'];

const now = () => new Date().toISOString();

// ── Clients ────────────────────────────────────────────────────────────────
export function listClients() {
  return getDB().prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM Projects p WHERE p.client_id = c.id) AS project_count,
      (SELECT COUNT(*) FROM Meetings m WHERE m.client_id = c.id) AS meeting_count,
      (SELECT COUNT(*) FROM ContextDocs d WHERE d.owner_type = 'client' AND d.owner_id = c.id) AS doc_count
    FROM Clients c ORDER BY c.name COLLATE NOCASE
  `).all();
}

export function saveClient({ id, name, notes = '' }) {
  const cleanName = String(name ?? '').trim();
  if (!cleanName) throw new Error('Client name is required.');
  const db = getDB();
  try {
    if (id) {
      db.prepare('UPDATE Clients SET name = ?, notes = ? WHERE id = ?').run(cleanName, String(notes), id);
      return db.prepare('SELECT * FROM Clients WHERE id = ?').get(id);
    }
    const info = db.prepare('INSERT INTO Clients (name, notes, created_at) VALUES (?, ?, ?)').run(cleanName, String(notes), now());
    return db.prepare('SELECT * FROM Clients WHERE id = ?').get(info.lastInsertRowid);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new Error('A client with that name already exists.');
    throw error;
  }
}

export function deleteClient(id) {
  const db = getDB();
  db.transaction(() => {
    db.prepare("DELETE FROM ContextDocs WHERE owner_type = 'client' AND owner_id = ?").run(id);
    db.prepare('UPDATE Projects SET client_id = NULL WHERE client_id = ?').run(id);
    db.prepare('UPDATE Meetings SET client_id = NULL WHERE client_id = ?').run(id);
    db.prepare('DELETE FROM Clients WHERE id = ?').run(id);
  })();
  return { success: true };
}

// ── Projects ───────────────────────────────────────────────────────────────
export function listProjects() {
  return getDB().prepare(`
    SELECT p.*, c.name AS client_name,
      (SELECT COUNT(*) FROM Meetings m WHERE m.project_id = p.id) AS meeting_count,
      (SELECT COUNT(*) FROM ContextDocs d WHERE d.owner_type = 'project' AND d.owner_id = p.id) AS doc_count
    FROM Projects p LEFT JOIN Clients c ON c.id = p.client_id
    ORDER BY p.name COLLATE NOCASE
  `).all();
}

export function saveProject({ id, name, notes = '', clientId = null }) {
  const cleanName = String(name ?? '').trim();
  if (!cleanName) throw new Error('Project name is required.');
  const db = getDB();
  const client = clientId ? Number(clientId) : null;
  if (id) {
    db.prepare('UPDATE Projects SET name = ?, notes = ?, client_id = ? WHERE id = ?').run(cleanName, String(notes), client, id);
    return db.prepare('SELECT * FROM Projects WHERE id = ?').get(id);
  }
  const info = db.prepare('INSERT INTO Projects (name, notes, client_id, created_at) VALUES (?, ?, ?, ?)').run(cleanName, String(notes), client, now());
  return db.prepare('SELECT * FROM Projects WHERE id = ?').get(info.lastInsertRowid);
}

export function deleteProject(id) {
  const db = getDB();
  db.transaction(() => {
    db.prepare("DELETE FROM ContextDocs WHERE owner_type = 'project' AND owner_id = ?").run(id);
    db.prepare('UPDATE Meetings SET project_id = NULL WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM Projects WHERE id = ?').run(id);
  })();
  return { success: true };
}

// ── Documents ──────────────────────────────────────────────────────────────
export function listDocs(ownerType, ownerId) {
  return getDB().prepare(`
    SELECT id, owner_type, owner_id, file_name, LENGTH(text) AS chars, created_at
    FROM ContextDocs WHERE owner_type = ? AND owner_id = ? ORDER BY created_at DESC
  `).all(ownerType, ownerId);
}

export async function addDocFromFile(ownerType, ownerId, filePath) {
  if (!['client', 'project'].includes(ownerType)) throw new Error('Invalid document owner.');
  const ext = path.extname(filePath).toLowerCase();
  let text;
  if (TEXT_EXTENSIONS.has(ext)) {
    text = await fs.readFile(filePath, 'utf8');
  } else if (ext === '.pdf') {
    // Text extraction runs on Gemini in Mumbai, once, at upload time.
    text = await extractDocumentText(await fs.readFile(filePath), 'application/pdf');
  } else {
    throw new Error(`Unsupported file type ${ext || '(none)'}. Use PDF, TXT, MD or CSV (save Word files as PDF).`);
  }
  text = String(text ?? '').trim();
  if (!text) throw new Error('No readable text found in that file.');
  const truncated = text.length > MAX_DOC_CHARS;
  const stored = truncated ? text.slice(0, MAX_DOC_CHARS) : text;
  const info = getDB().prepare(`
    INSERT INTO ContextDocs (owner_type, owner_id, file_name, text, created_at) VALUES (?, ?, ?, ?, ?)
  `).run(ownerType, ownerId, path.basename(filePath), stored, now());
  return { id: Number(info.lastInsertRowid), fileName: path.basename(filePath), chars: stored.length, truncated };
}

export function addDocFromText(ownerType, ownerId, title, text) {
  const clean = String(text ?? '').trim();
  if (!clean) throw new Error('Note text is empty.');
  const info = getDB().prepare(`
    INSERT INTO ContextDocs (owner_type, owner_id, file_name, text, created_at) VALUES (?, ?, ?, ?, ?)
  `).run(ownerType, ownerId, String(title || 'Note').trim(), clean.slice(0, MAX_DOC_CHARS), now());
  return { id: Number(info.lastInsertRowid) };
}

export function deleteDoc(id) {
  getDB().prepare('DELETE FROM ContextDocs WHERE id = ?').run(id);
  return { success: true };
}

// ── Meeting context ────────────────────────────────────────────────────────
function section(title, body) {
  const text = String(body ?? '').trim();
  return text ? `## ${title}\n${text}` : '';
}

/**
 * Background the AI gets for a meeting: agenda, client and project notes and
 * documents. `maxChars` keeps cost bounded (live analysis uses a small budget).
 */
export function buildMeetingContext({ clientId, projectId, agenda }, { maxChars = 60_000 } = {}) {
  const db = getDB();
  const parts = [];
  if (agenda) parts.push(section('Meeting agenda / purpose', agenda));

  const project = projectId ? db.prepare('SELECT * FROM Projects WHERE id = ?').get(projectId) : null;
  const effectiveClientId = clientId || project?.client_id || null;
  const client = effectiveClientId ? db.prepare('SELECT * FROM Clients WHERE id = ?').get(effectiveClientId) : null;

  if (client) {
    parts.push(section(`Client: ${client.name}`, client.notes || '(no notes)'));
  }
  if (project) {
    parts.push(section(`Project: ${project.name}`, project.notes || '(no notes)'));
  }

  const docs = [
    ...(project ? db.prepare("SELECT file_name, text FROM ContextDocs WHERE owner_type = 'project' AND owner_id = ? ORDER BY created_at DESC").all(project.id) : []),
    ...(client ? db.prepare("SELECT file_name, text FROM ContextDocs WHERE owner_type = 'client' AND owner_id = ? ORDER BY created_at DESC").all(client.id) : []),
  ];

  let text = parts.filter(Boolean).join('\n\n');
  for (const doc of docs) {
    const room = maxChars - text.length - 200;
    if (room <= 500) break;
    const body = doc.text.length > room ? `${doc.text.slice(0, room)}\n…[document truncated]` : doc.text;
    text += `\n\n## Document: ${doc.file_name}\n${body}`;
  }
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n…[context truncated]`;

  return {
    text: text.trim(),
    clientName: client?.name ?? null,
    projectName: project?.name ?? null,
  };
}

export function getMeetingContextForRow(meeting, options) {
  if (!meeting) return { text: '', clientName: null, projectName: null };
  return buildMeetingContext({
    clientId: meeting.client_id,
    projectId: meeting.project_id,
    agenda: meeting.agenda,
  }, options);
}
