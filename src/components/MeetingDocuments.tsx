import { useEffect, useState } from 'react';
import { Check, CheckCircle2, Copy, Download, FileText, Loader2, Mail, RotateCcw, X } from 'lucide-react';
import type { MeetingArtifacts, MeetingTemplate, MinutesOfMeetingContent } from '../types/meeting';

interface MeetingDocumentsProps {
  dbId: number;
  artifacts: MeetingArtifacts | null;
  ready: boolean;
  onExportPdf: () => void;
}

type Viewing = { kind: 'minutes' } | { kind: 'template'; id: number } | null;

const errorText = (error: unknown) => (error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(error));

function minutesAsText(minutes: MinutesOfMeetingContent) {
  const section = (title: string, items: string[]) => (items.length ? `${title}\n${items.map((item) => `- ${item}`).join('\n')}\n` : '');
  return [
    `${minutes.title}\n`,
    `${minutes.overview}\n`,
    section('Discussion', minutes.discussionPoints),
    section('Decisions', minutes.decisions),
    section('Action items', minutes.actionItems.map((a) => `${a.task} (${a.owner}${a.deadline !== 'Not specified' ? `, by ${a.deadline}` : ''})`)),
    section('Follow-ups', minutes.followUps),
  ].filter(Boolean).join('\n');
}

/**
 * One-click documents. Minutes are ready as soon as the meeting record is; the
 * others (client email, checklists, your templates) are prepared in the
 * background on click, and the button turns green when they are ready to open.
 */
export default function MeetingDocuments({ dbId, artifacts, ready, onExportPdf }: MeetingDocumentsProps) {
  const [templates, setTemplates] = useState<MeetingTemplate[]>([]);
  const [starting, setStarting] = useState<number[]>([]);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [viewing, setViewing] = useState<Viewing>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { void window.electronAPI?.listTemplates().then(setTemplates).catch(() => {}); }, []);

  const documents = artifacts?.documents ?? {};
  const minutes = artifacts?.minutesOfMeeting?.status === 'ready' ? artifacts.minutesOfMeeting.content : null;

  const statusOf = (id: number) => {
    const saved = documents[String(id)];
    if (starting.includes(id) || saved?.status === 'running') return 'running';
    if (saved?.status === 'ready') return 'ready';
    if (errors[id] || saved?.status === 'error') return 'error';
    return 'idle';
  };

  const prepare = async (template: MeetingTemplate) => {
    setStarting((list) => [...list, template.id]);
    setErrors((map) => ({ ...map, [template.id]: '' }));
    try {
      const result = await window.electronAPI.runTemplate({ dbId, templateId: template.id });
      if (!result.success) throw new Error(result.error);
    } catch (caught) {
      setErrors((map) => ({ ...map, [template.id]: errorText(caught) }));
    } finally {
      setStarting((list) => list.filter((id) => id !== template.id));
    }
  };

  const viewingText = viewing?.kind === 'minutes'
    ? (minutes ? minutesAsText(minutes) : '')
    : viewing ? documents[String(viewing.id)]?.text ?? '' : '';
  const viewingTitle = viewing?.kind === 'minutes' ? 'Minutes of Meeting' : viewing ? templates.find((t) => t.id === viewing.id)?.name ?? 'Document' : '';

  const copy = async () => {
    await navigator.clipboard.writeText(viewingText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="bento-panel pm-docs">
      <div className="bento-panel-header"><FileText size={16} /><span>Documents</span></div>
      <div className="pm-docs-body">
        <button
          type="button"
          className={`doc-btn ${minutes ? 'doc-btn-ready' : ''}`}
          disabled={!minutes}
          onClick={() => setViewing({ kind: 'minutes' })}
        >
          {minutes ? <CheckCircle2 size={15} /> : <Loader2 size={15} className={ready ? '' : 'spin'} />}
          <span className="doc-btn-name">Minutes of Meeting</span>
          <span className="doc-btn-state">{minutes ? 'Open' : 'Preparing…'}</span>
        </button>
        {templates.map((template) => {
          const status = statusOf(template.id);
          const Icon = /mail/i.test(template.name) ? Mail : FileText;
          return (
            <button
              key={template.id}
              type="button"
              className={`doc-btn doc-btn-${status}`}
              disabled={!ready || status === 'running'}
              onClick={() => (status === 'ready' ? setViewing({ kind: 'template', id: template.id }) : void prepare(template))}
              title={status === 'error' ? (errors[template.id] || documents[String(template.id)]?.error || 'Failed') : undefined}
            >
              {status === 'ready' ? <CheckCircle2 size={15} /> : status === 'running' ? <Loader2 size={15} className="spin" /> : <Icon size={15} />}
              <span className="doc-btn-name">{template.name}</span>
              <span className="doc-btn-state">
                {status === 'ready' ? 'Ready · Open' : status === 'running' ? 'Preparing…' : status === 'error' ? 'Try again' : 'Prepare'}
              </span>
            </button>
          );
        })}
      </div>

      {viewing && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={viewingTitle} onClick={() => setViewing(null)}>
          <div className="modal-card modal-card-wide doc-viewer" onClick={(e) => e.stopPropagation()}>
            <div className="doc-viewer-head">
              <h3 className="modal-title">{viewingTitle}</h3>
              <button type="button" className="modal-close" onClick={() => setViewing(null)} aria-label="Close"><X size={18} /></button>
            </div>
            <pre className="doc-viewer-text">{viewingText}</pre>
            <div className="modal-actions">
              {viewing.kind === 'minutes' ? (
                <button className="modal-btn modal-btn-cancel" onClick={onExportPdf}><Download size={14} /> Export PDF</button>
              ) : (
                <button
                  className="modal-btn modal-btn-cancel"
                  onClick={() => {
                    const template = templates.find((t) => t.id === viewing.id);
                    setViewing(null);
                    if (template) void prepare(template);
                  }}
                >
                  <RotateCcw size={14} /> Write again
                </button>
              )}
              <button className="modal-btn modal-btn-accept" onClick={() => void copy()}>
                {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
