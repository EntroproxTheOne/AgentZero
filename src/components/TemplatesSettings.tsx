import { useEffect, useState } from 'react';
import { FileStack, Pencil, Plus, Trash2 } from 'lucide-react';
import type { MeetingTemplate } from '../types/meeting';

type Draft = { id?: number; name: string; instructions: string };

/** Saved Ask templates (client email, internal checklist, task list, your own). */
export default function TemplatesSettings() {
  const [templates, setTemplates] = useState<MeetingTemplate[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.electronAPI?.listTemplates().then(setTemplates).catch(() => {});
  }, []);

  const save = async () => {
    if (!draft) return;
    const result = await window.electronAPI.saveTemplate(draft);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setTemplates(result.value);
    setDraft(null);
    setError(null);
  };

  const remove = async (id: number) => {
    const result = await window.electronAPI.deleteTemplate({ id });
    if (result.success) setTemplates(result.value);
  };

  return (
    <div className="settings-card">
      <div className="settings-card-header">
        <FileStack size={18} className="settings-card-icon" />
        <h4 className="settings-card-title">Ask Templates</h4>
      </div>
      <div className="settings-card-body">
        <p className="settings-toggle-sub">One-click documents after a meeting. They are written only from the meeting record, so they never contradict it.</p>
        <ul className="templates-list">
          {templates.map((template) => (
            <li key={template.id} className="templates-row">
              <span className="templates-name">{template.name}</span>
              <button type="button" className="pm-edit-btn" onClick={() => setDraft({ id: template.id, name: template.name, instructions: template.instructions })} aria-label={`Edit ${template.name}`}><Pencil size={13} /></button>
              <button type="button" className="pm-edit-btn" onClick={() => void remove(template.id)} aria-label={`Delete ${template.name}`}><Trash2 size={13} /></button>
            </li>
          ))}
        </ul>
        {draft ? (
          <div className="templates-form">
            <input className="setting-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Template name" />
            <textarea className="setting-input templates-instructions" rows={5} value={draft.instructions} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} placeholder="What should it write? e.g. A short WhatsApp message to the client listing the documents they need to send." />
            {error && <p className="capture-problem">{error}</p>}
            <div className="modal-actions">
              <button className="modal-btn modal-btn-cancel" onClick={() => { setDraft(null); setError(null); }}>Cancel</button>
              <button className="modal-btn modal-btn-accept" onClick={() => void save()}>Save template</button>
            </div>
          </div>
        ) : (
          <button type="button" className="setting-link-btn" onClick={() => setDraft({ name: '', instructions: '' })}><Plus size={14} /> New template</button>
        )}
      </div>
    </div>
  );
}
