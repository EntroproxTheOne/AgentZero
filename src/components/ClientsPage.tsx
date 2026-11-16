import { useEffect, useMemo, useState } from 'react';
import { Briefcase, Building2, FileText, Plus, Save, StickyNote, Trash2, Upload, X } from 'lucide-react';
import { useWorkspace } from '../hooks/useWorkspace';
import type { ContextDoc } from '../types/meeting';

type Selection = { type: 'client' | 'project'; id: number | 'new' } | null;

interface Draft {
  name: string;
  notes: string;
  clientId: number | null;
}

function formatChars(chars: number) {
  return chars > 1000 ? `${Math.round(chars / 1000)}k characters` : `${chars} characters`;
}

/**
 * Clients and projects carry notes and documents. Pick one when starting or
 * uploading a meeting and the AI reads this context automatically.
 */
export default function ClientsPage() {
  const { clients, projects, reload } = useWorkspace();
  const [selection, setSelection] = useState<Selection>(null);
  const [draft, setDraft] = useState<Draft>({ name: '', notes: '', clientId: null });
  const [docs, setDocs] = useState<ContextDoc[]>([]);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteText, setNoteText] = useState('');
  const [docsVersion, setDocsVersion] = useState(0);

  const current = useMemo(() => {
    if (!selection || selection.id === 'new') return null;
    return selection.type === 'client'
      ? clients.find((client) => client.id === selection.id) ?? null
      : projects.find((project) => project.id === selection.id) ?? null;
  }, [selection, clients, projects]);

  useEffect(() => {
    if (!selection || selection.id === 'new') return undefined;
    let active = true;
    void window.electronAPI.listDocs({ ownerType: selection.type, ownerId: selection.id }).then((list) => {
      if (active) setDocs(list);
    });
    return () => { active = false; };
  }, [selection, docsVersion]);

  const select = (next: Selection) => {
    setSelection(next);
    setMessage(null);
    setDocs([]);
    setNoteTitle('');
    setNoteText('');
    if (!next || next.id === 'new') {
      setDraft({ name: '', notes: '', clientId: null });
      return;
    }
    if (next.type === 'client') {
      const client = clients.find((item) => item.id === next.id);
      setDraft({ name: client?.name ?? '', notes: client?.notes ?? '', clientId: null });
    } else {
      const project = projects.find((item) => item.id === next.id);
      setDraft({ name: project?.name ?? '', notes: project?.notes ?? '', clientId: project?.client_id ?? null });
    }
  };

  const save = async () => {
    if (!selection) return;
    setBusy(true);
    const id = selection.id === 'new' ? undefined : selection.id;
    const result = selection.type === 'client'
      ? await window.electronAPI.saveClient({ id, name: draft.name, notes: draft.notes })
      : await window.electronAPI.saveProject({ id, name: draft.name, notes: draft.notes, clientId: draft.clientId });
    setBusy(false);
    if (!result.success) {
      setMessage({ kind: 'error', text: result.error });
      return;
    }
    reload();
    setSelection({ type: selection.type, id: result.value.id });
    setMessage({ kind: 'ok', text: 'Saved.' });
  };

  const remove = async () => {
    if (!selection || selection.id === 'new') return;
    const label = selection.type === 'client' ? 'client' : 'project';
    if (!window.confirm(`Delete this ${label} and its documents? Meetings stay, they just lose the link.`)) return;
    const result = selection.type === 'client'
      ? await window.electronAPI.deleteClient({ id: selection.id })
      : await window.electronAPI.deleteProject({ id: selection.id });
    if (!result.success) {
      setMessage({ kind: 'error', text: result.error });
      return;
    }
    reload();
    select(null);
  };

  const addFiles = async () => {
    if (!selection || selection.id === 'new') return;
    setBusy(true);
    setMessage({ kind: 'ok', text: 'Reading documents… PDFs take a few seconds each.' });
    const result = await window.electronAPI.addDocFiles({ ownerType: selection.type, ownerId: selection.id });
    setBusy(false);
    if (!result.success) {
      setMessage({ kind: 'error', text: result.error });
      return;
    }
    const { added, failed } = result.value;
    setDocsVersion((value) => value + 1);
    reload();
    if (failed.length) {
      setMessage({ kind: 'error', text: `Added ${added.length}. Could not read: ${failed.map((item) => `${item.fileName} (${item.error})`).join('; ')}` });
    } else {
      setMessage(added.length ? { kind: 'ok', text: `Added ${added.length} document${added.length > 1 ? 's' : ''}.` } : null);
    }
  };

  const addNote = async () => {
    if (!selection || selection.id === 'new' || !noteText.trim()) return;
    const result = await window.electronAPI.addDocNote({ ownerType: selection.type, ownerId: selection.id, title: noteTitle || 'Note', text: noteText });
    if (!result.success) {
      setMessage({ kind: 'error', text: result.error });
      return;
    }
    setNoteTitle('');
    setNoteText('');
    setDocsVersion((value) => value + 1);
    reload();
  };

  const removeDoc = async (doc: ContextDoc) => {
    if (!window.confirm(`Remove ${doc.file_name}?`)) return;
    await window.electronAPI.deleteDoc({ id: doc.id });
    setDocsVersion((value) => value + 1);
    reload();
  };

  const isNew = selection?.id === 'new';

  return (
    <div className="page-container">
      <header className="page-header">
        <h2 className="page-label">Context</h2>
        <h3 className="page-title">Clients &amp; Projects</h3>
        <p className="page-intro">Notes and documents here are given to the AI whenever a meeting is linked to the client or project, so you set them up once.</p>
      </header>

      <div className="workspace-layout">
        <aside className="workspace-list" aria-label="Clients and projects">
          <div className="workspace-list-head">
            <span><Building2 size={14} /> Clients</span>
            <button className="setting-link-btn" onClick={() => select({ type: 'client', id: 'new' })}><Plus size={14} /> New</button>
          </div>
          {clients.length === 0 && <p className="workspace-empty">No clients yet.</p>}
          {clients.map((client) => (
            <button
              key={client.id}
              className={`workspace-item ${selection?.type === 'client' && selection.id === client.id ? 'workspace-item-on' : ''}`}
              onClick={() => select({ type: 'client', id: client.id })}
            >
              <span className="workspace-item-name">{client.name}</span>
              <span className="workspace-item-meta">{client.meeting_count ?? 0} meetings · {client.doc_count ?? 0} docs</span>
            </button>
          ))}

          <div className="workspace-list-head">
            <span><Briefcase size={14} /> Projects</span>
            <button className="setting-link-btn" onClick={() => select({ type: 'project', id: 'new' })}><Plus size={14} /> New</button>
          </div>
          {projects.length === 0 && <p className="workspace-empty">No projects yet.</p>}
          {projects.map((project) => (
            <button
              key={project.id}
              className={`workspace-item ${selection?.type === 'project' && selection.id === project.id ? 'workspace-item-on' : ''}`}
              onClick={() => select({ type: 'project', id: project.id })}
            >
              <span className="workspace-item-name">{project.name}</span>
              <span className="workspace-item-meta">{project.client_name ? `${project.client_name} · ` : ''}{project.meeting_count ?? 0} meetings · {project.doc_count ?? 0} docs</span>
            </button>
          ))}
        </aside>

        <section className="workspace-detail">
          {!selection ? (
            <div className="empty-state">
              <div className="empty-state-icon"><Building2 size={44} /></div>
              <h4 className="empty-state-title">Pick a client or project</h4>
              <p className="empty-state-text">Or create one with “New”. Add what the AI should always know: who they are, goals, holdings, preferences, history.</p>
            </div>
          ) : (
            <div className="settings-card workspace-card">
              <div className="settings-card-header">
                {selection.type === 'client' ? <Building2 size={18} className="settings-card-icon" /> : <Briefcase size={18} className="settings-card-icon" />}
                <h4 className="settings-card-title">{isNew ? `New ${selection.type}` : current?.name}</h4>
                <button type="button" className="modal-close workspace-close" onClick={() => setSelection(null)} aria-label="Close" title="Close">
                  <X size={18} />
                </button>
              </div>
              <div className="settings-card-body">
                <label className="context-field">
                  <span>Name</span>
                  <input className="setting-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus={isNew} />
                </label>
                {selection.type === 'project' && (
                  <label className="context-field">
                    <span>Client</span>
                    <select className="setting-input" value={draft.clientId ?? ''} onChange={(e) => setDraft({ ...draft, clientId: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">No client</option>
                      {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                    </select>
                  </label>
                )}
                <label className="context-field">
                  <span>Notes for the AI</span>
                  <textarea
                    className="setting-input"
                    rows={7}
                    value={draft.notes}
                    onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                    placeholder={selection.type === 'client'
                      ? 'Family members and roles, risk profile, goals, existing products, preferences, sensitivities…'
                      : 'Scope, goals, timeline, people involved, decisions so far, open questions…'}
                  />
                </label>
                <div className="settings-actions-row">
                  <button className="setting-save-btn" onClick={() => void save()} disabled={busy}><Save size={14} /> Save</button>
                  {!isNew && <button className="setting-danger-btn" onClick={() => void remove()}><Trash2 size={14} /> Delete</button>}
                  {message && <span className={message.kind === 'ok' ? 'settings-provider-saved' : 'settings-error-text'}>{message.text}</span>}
                </div>

                {!isNew && (
                  <>
                    <div className="workspace-docs-head">
                      <h5><FileText size={14} /> Documents</h5>
                      <button className="setting-link-btn" onClick={() => void addFiles()} disabled={busy}><Upload size={14} /> Add files</button>
                    </div>
                    <p className="context-hint">PDF, TXT, MD or CSV. Text is extracted once and stored on this computer. Save Word files as PDF first.</p>
                    {docs.length === 0 ? (
                      <p className="workspace-empty">No documents yet.</p>
                    ) : (
                      <ul className="workspace-docs">
                        {docs.map((doc) => (
                          <li key={doc.id}>
                            <FileText size={14} />
                            <span className="workspace-doc-name">{doc.file_name}</span>
                            <span className="workspace-doc-meta">{formatChars(doc.chars)}</span>
                            <button className="setting-link-btn setting-link-danger" onClick={() => void removeDoc(doc)} aria-label={`Remove ${doc.file_name}`}><Trash2 size={13} /></button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="workspace-note">
                      <h5><StickyNote size={14} /> Quick note</h5>
                      <input className="setting-input" placeholder="Title (optional)" value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} />
                      <textarea className="setting-input" rows={3} placeholder="Paste an email, a policy summary, meeting prep…" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
                      <button className="setting-link-btn" onClick={() => void addNote()} disabled={!noteText.trim()}><Plus size={14} /> Add note</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
