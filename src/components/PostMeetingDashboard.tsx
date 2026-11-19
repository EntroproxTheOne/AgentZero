import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3, Building2, Check, CheckSquare, ChevronDown, Clock, Copy, Download, FileJson, FileText, FolderOpen,
  IndianRupee, Loader2, MessageSquare, Pencil, RotateCcw, Send, Sparkles, UserCheck, Users,
} from 'lucide-react';
import type {
  ClientRecord, ExtractionDecision, ExtractionTask, MeetingArtifactsResponse, MeetingCost, MeetingTemplate,
  ProcessingState, QuickLookHistoryItem,
} from '../types/meeting';

const cleanIpcError = (message: string) => message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const errorText = (error: unknown) => (error instanceof Error ? cleanIpcError(error.message) : String(error));
const formatInr = (value: number) => `₹${value < 10 ? value.toFixed(2) : value.toFixed(0)}`;
const DIARIZED_INR_PER_MIN = 0.59;
const DECISION_STATUSES: ExtractionDecision['status'][] = ['confirmed', 'proposed', 'discussed', 'unclear', 'reversed'];

interface PostMeetingDashboardProps {
  meetingTitle: string;
  meetingDbId: number;
  onNewMeeting: () => void;
  isReview?: boolean;
}

/** Text with [L12] citations turned into buttons that jump to the transcript line. */
function CitedText({ text, onJump }: { text: string; onJump: (lineId: number) => void }) {
  const parts = text.split(/(\[L\d+\])/g);
  return (
    <>
      {parts.map((part, index) => {
        const match = part.match(/^\[L(\d+)\]$/);
        if (!match) return <Fragment key={index}>{part}</Fragment>;
        const lineId = Number(match[1]);
        return (
          <button key={index} type="button" className="cite-chip" onClick={() => onJump(lineId)} title={`Show transcript line ${lineId}`}>
            L{lineId}
          </button>
        );
      })}
    </>
  );
}

export default function PostMeetingDashboard({ meetingTitle, meetingDbId, onNewMeeting, isReview = false }: PostMeetingDashboardProps) {
  const [meetingData, setMeetingData] = useState<MeetingArtifactsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [displayTitle, setDisplayTitle] = useState(meetingTitle);
  const [showCost, setShowCost] = useState(false);
  const [cost, setCost] = useState<MeetingCost | null>(null);
  const [processing, setProcessing] = useState<{ state: ProcessingState; note: string | null } | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [highlightLine, setHighlightLine] = useState<number | null>(null);
  const [exportStatus, setExportStatus] = useState('');
  const [exporting, setExporting] = useState<string | null>(null);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [newClientName, setNewClientName] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  const [pickingOwner, setPickingOwner] = useState(false);
  const [editingTask, setEditingTask] = useState<ExtractionTask | null>(null);
  const [editingDecision, setEditingDecision] = useState<ExtractionDecision | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  const reload = () => loadMeetingArtifacts(meetingDbId, setMeetingData, () => {}, setError);

  useEffect(() => {
    void loadMeetingArtifacts(meetingDbId, setMeetingData, setLoading, setError);
    void window.electronAPI?.getAppSettings().then((settings) => setShowCost(settings.showCost)).catch(() => {});
    void window.electronAPI?.listWorkspace().then((workspace) => setClients(workspace.clients)).catch(() => {});
  }, [meetingDbId]);

  useEffect(() => {
    if (!window.electronAPI?.onMeetingProcessing) return undefined;
    return window.electronAPI.onMeetingProcessing((event) => {
      if (event.dbId !== meetingDbId) return;
      setProcessing({ state: event.state, note: event.note });
      if (event.state === 'done') void reload();
    });
  }, [meetingDbId]);

  useEffect(() => {
    if (!window.electronAPI?.onMeetingTitleUpdated) return undefined;
    window.electronAPI.onMeetingTitleUpdated((event) => {
      if (event.dbId === meetingDbId) setDisplayTitle(event.title);
    });
    return () => window.electronAPI.offMeetingTitleUpdated?.();
  }, [meetingDbId]);

  const startTimeMs = meetingData?.meeting?.start_time_ms ?? null;
  useEffect(() => {
    if (!window.electronAPI?.onMeetingArtifactsUpdated) return undefined;
    window.electronAPI.onMeetingArtifactsUpdated((event) => {
      const matches = (event as { dbId?: number }).dbId === meetingDbId || (startTimeMs !== null && event.meetingId === startTimeMs);
      if (matches) void reload();
    });
    return () => window.electronAPI.offMeetingArtifactsUpdated?.();
  }, [startTimeMs, meetingDbId]);

  useEffect(() => {
    if (!showCost || !window.electronAPI) return;
    void window.electronAPI.getMeetingCost({ dbId: meetingDbId }).then(setCost).catch(() => setCost(null));
  }, [showCost, meetingDbId, meetingData]);

  const meeting = meetingData?.meeting;
  const artifacts = meetingData?.artifacts ?? null;
  const extraction = artifacts?.extraction ?? null;
  const speakerMap = artifacts?.speakerMap ?? null;
  const entries = meetingData?.transcriptEntries ?? [];
  const processingState = processing?.state ?? meeting?.processing_state ?? 'done';
  const processingNote = processing?.note ?? meeting?.processing_note ?? null;
  const isProcessing = processingState === 'transcribing' || processingState === 'analyzing';
  const legacy = !extraction && artifacts?.highlights?.status === 'ready' ? artifacts.highlights : null;

  const speakerNames = useMemo(() => [...new Set(entries.map((entry) => entry.speakerLabel).filter(Boolean))], [entries]);
  const durationMin = meeting?.start_time_ms && meeting?.end_time_ms ? Math.max(1, Math.round((meeting.end_time_ms - meeting.start_time_ms) / 60000)) : 0;
  const diarizedSpeakers = speakerMap?.speakers ? Object.keys(speakerMap.speakers).length : null;

  const suggestedClient = useMemo(() => {
    if (!meeting || meeting.client_id) return null;
    const haystack = `${meeting.title} ${speakerNames.join(' ')}`.toLowerCase();
    return clients.find((client) => client.name.split(/\s+/).some((word) => word.length > 2 && haystack.includes(word.toLowerCase()))) ?? null;
  }, [clients, meeting, speakerNames]);

  const jumpTo = (lineId: number) => {
    setShowTranscript(true);
    setHighlightLine(lineId);
    window.setTimeout(() => {
      transcriptRef.current?.querySelector(`[data-line="${lineId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  };

  const run = async (fn: () => Promise<unknown>) => {
    setActionError(null);
    try {
      const result = await fn();
      if (result && typeof result === 'object' && 'success' in result && (result as { success: boolean }).success === false) {
        setActionError((result as { error?: string }).error ?? 'Something went wrong.');
      }
      await reload();
    } catch (caught) {
      setActionError(errorText(caught));
    }
  };

  const setClient = (clientId: number | null) => run(async () => {
    await window.electronAPI.updateMeetingContext({ dbId: meetingDbId, clientId, projectId: meeting?.project_id ?? null, agenda: meeting?.agenda ?? '' });
  });

  const createClient = () => run(async () => {
    const name = (newClientName ?? '').trim();
    if (!name) return;
    const saved = await window.electronAPI.saveClient({ name });
    if (!saved.success) throw new Error(saved.error);
    setClients((list) => [...list, saved.value]);
    setNewClientName(null);
    await window.electronAPI.updateMeetingContext({ dbId: meetingDbId, clientId: saved.value.id, projectId: meeting?.project_id ?? null, agenda: meeting?.agenda ?? '' });
  });

  const editItem = (kind: 'decision' | 'task', id: string, patch: Record<string, unknown>) => run(() => window.electronAPI.editMeetingItem({ dbId: meetingDbId, kind, id, patch }));

  const handleExport = async (format: 'pdf' | 'markdown' | 'json') => {
    if (exporting) return;
    setExporting(format);
    setExportStatus('Preparing…');
    try {
      if (format === 'json') {
        const result = await window.electronAPI.exportMeetingJson({ dbId: meetingDbId });
        if (!result.success) throw new Error(result.error);
        setExportStatus('Meeting record exported.');
        await window.electronAPI.openInExplorer(result.value.filePath);
      } else {
        const result = await window.electronAPI.exportMeetingMom({ dbId: meetingDbId, format });
        setExportStatus(format === 'pdf' ? 'PDF exported.' : 'Markdown exported.');
        await window.electronAPI.openInExplorer(result.filePath);
      }
    } catch (caught) {
      setExportStatus(errorText(caught));
    } finally {
      setExporting(null);
    }
  };

  const ownerEntry = speakerMap?.speakers && speakerMap.ownerId ? speakerMap.speakers[speakerMap.ownerId] : null;
  const showOwnerQuestion = speakerMap?.mode === 'diarized' && speakerMap.needsConfirmation && !speakerMap.confirmed && ownerEntry;
  const liveCanImprove = meeting?.recording_mode === 'live' && !artifacts?.usage?.sttBatch && meeting?.audio_file_path;

  const decisions = extraction?.decisions ?? [];
  const tasks = extraction?.action_items ?? [];

  return (
    <div className="post-meeting">
      <div className="post-meeting-header">
        <div>
          <h2 className="page-label">{isReview ? 'Past Meeting' : 'Meeting Ended'}</h2>
          <h3 className="page-title">{displayTitle || 'Meeting Summary'}</h3>
        </div>
        <button className="pm-new-meeting-btn" onClick={onNewMeeting}>
          {isReview ? 'Back to Meetings' : 'Start New Meeting'}
        </button>
      </div>

      <div className="pm-context">
        <Building2 size={14} />
        <select
          className="pm-client-select"
          value={meeting?.client_id ?? ''}
          onChange={(e) => {
            if (e.target.value === '__new') setNewClientName('');
            else void setClient(e.target.value ? Number(e.target.value) : null);
          }}
          aria-label="Client for this meeting"
        >
          <option value="">No client</option>
          {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          <option value="__new">+ New client…</option>
        </select>
        {newClientName !== null && (
          <span className="pm-inline-form">
            <input autoFocus value={newClientName} onChange={(e) => setNewClientName(e.target.value)} placeholder="Client name" onKeyDown={(e) => { if (e.key === 'Enter') void createClient(); }} />
            <button className="setting-link-btn" onClick={() => void createClient()}>Save</button>
            <button className="setting-link-btn" onClick={() => setNewClientName(null)}>Cancel</button>
          </span>
        )}
        {suggestedClient && newClientName === null && (
          <button className="setting-link-btn" onClick={() => void setClient(suggestedClient.id)}>
            Tag as {suggestedClient.name}?
          </button>
        )}
        {meeting?.agenda && <span className="pm-context-agenda">{meeting.agenda}</span>}
      </div>

      {isProcessing && (
        <div className="pm-processing" role="status">
          <Loader2 size={16} className="spin" />
          <span><strong>Finishing up.</strong> {processingNote || 'Working on this meeting.'} You can close the app; it continues next time.</span>
        </div>
      )}
      {processingState === 'error' && (
        <div className="pm-processing pm-processing-error" role="alert">
          <span><strong>This meeting needs attention.</strong> {processingNote}</span>
          <button className="setting-link-btn" onClick={() => { void window.electronAPI.retryMeetingProcessing({ dbId: meetingDbId }); setProcessing({ state: 'analyzing', note: 'Retrying' }); }}>
            <RotateCcw size={14} /> Retry
          </button>
        </div>
      )}
      {actionError && <div className="pm-processing pm-processing-error" role="alert"><span>{actionError}</span></div>}

      {speakerMap?.oneSided && (
        <div className="pm-banner" role="status">
          <strong>Only your side was recorded.</strong> The other person could not be heard, so nothing they said is in the record.
        </div>
      )}
      {showOwnerQuestion && (
        <div className="pm-banner pm-banner-question" role="group" aria-label="Confirm speaker">
          <UserCheck size={16} />
          {!pickingOwner ? (
            <>
              <span>Is <strong>{ownerEntry.name}</strong> you? ({Math.round(ownerEntry.seconds / 60) || '<1'} min of speech)</span>
              <button className="setting-link-btn" onClick={() => void run(() => window.electronAPI.confirmOwner({ dbId: meetingDbId, speakerId: speakerMap.ownerId as string, isOwner: true }))}>Yes</button>
              <button className="setting-link-btn" onClick={() => setPickingOwner(true)}>No</button>
            </>
          ) : (
            <>
              <span>Which one is you?</span>
              {Object.entries(speakerMap.speakers ?? {}).filter(([id]) => id !== speakerMap.ownerId).map(([id, person]) => (
                <button key={id} className="setting-link-btn" onClick={() => { setPickingOwner(false); void run(() => window.electronAPI.confirmOwner({ dbId: meetingDbId, speakerId: id, isOwner: true })); }}>
                  {person.name}
                </button>
              ))}
              <button className="setting-link-btn" onClick={() => setPickingOwner(false)}>Cancel</button>
            </>
          )}
        </div>
      )}
      {liveCanImprove && (
        <div className={`pm-banner ${speakerMap?.needsImprove ? 'pm-banner-question' : 'pm-banner-quiet'}`}>
          <span>{speakerMap?.needsImprove ? 'Some lines could not be placed as You or Client.' : 'Live labels are You / Client only.'}</span>
          <button className="setting-link-btn" onClick={() => void run(() => window.electronAPI.improveSpeakers({ dbId: meetingDbId }))}>
            Improve speaker labels (≈₹{(durationMin * DIARIZED_INR_PER_MIN).toFixed(2)})
          </button>
        </div>
      )}
      {artifacts?.extractionStale && !isProcessing && extraction && (
        <div className="pm-banner pm-banner-question">
          <span>Speaker corrections are not in the summary yet.</span>
          <button className="setting-link-btn" onClick={() => void run(() => window.electronAPI.refreshMeetingRecord({ dbId: meetingDbId }))}>
            <RotateCcw size={14} /> Update summary
          </button>
        </div>
      )}

      {speakerNames.length > 0 && (
        <div className="pm-speakers" aria-label="Speakers">
          <Users size={14} />
          {speakerNames.map((name) => (
            renaming?.from === name ? (
              <span key={name} className="pm-inline-form">
                <input autoFocus value={renaming.to} onChange={(e) => setRenaming({ from: name, to: e.target.value })} onKeyDown={(e) => {
                  if (e.key === 'Enter') { const next = renaming; setRenaming(null); void run(() => window.electronAPI.renameSpeaker({ dbId: meetingDbId, from: next.from, to: next.to })); }
                  if (e.key === 'Escape') setRenaming(null);
                }} />
                <button className="setting-link-btn" onClick={() => { const next = renaming; setRenaming(null); void run(() => window.electronAPI.renameSpeaker({ dbId: meetingDbId, from: next.from, to: next.to })); }}><Check size={13} /></button>
              </span>
            ) : (
              <button key={name} type="button" className="meeting-chip pm-speaker-chip" onClick={() => setRenaming({ from: name, to: name })} title="Rename everywhere in this meeting">
                {name} <Pencil size={11} />
              </button>
            )
          ))}
        </div>
      )}

      <div className="pm-grid">
        <div className="pm-highlights bento-panel">
          <div className="bento-panel-header">
            <FileText size={16} />
            <span>Meeting Highlights</span>
          </div>
          <div className="pm-highlights-body">
            {error && <p className="pm-summary-text">{error}</p>}
            {!extraction && !legacy && (
              <p className="pm-summary-text">
                {loading || isProcessing ? 'The summary appears here once the recording is transcribed.'
                  : artifacts?.highlights?.status === 'error' ? `The summary could not be written: ${artifacts.highlights.error ?? 'unknown error'}. Press Retry, or check Settings → AI & Transcription.`
                  : 'No summary for this meeting.'}
              </p>
            )}
            {legacy && (
              <>
                <div className="pm-summary-section"><h4 className="pm-section-title">Summary</h4><p className="pm-summary-text">{legacy.summary}</p></div>
                <div className="pm-summary-section"><h4 className="pm-section-title">Action Items</h4><ul className="pm-key-points">{legacy.actionItems.map((item) => <li key={item}>{item}</li>)}</ul></div>
              </>
            )}
            {extraction && (
              <>
                <div className="pm-summary-section">
                  <h4 className="pm-section-title">Summary</h4>
                  <p className="pm-summary-text">{extraction.summary}</p>
                </div>

                <div className="pm-summary-section">
                  <h4 className="pm-section-title">Decisions</h4>
                  {decisions.length === 0 ? <p className="pm-summary-text">No decisions were recorded.</p> : (
                    <ul className="pm-decisions">
                      {decisions.map((d) => (
                        <li key={d.id} className={`pm-decision pm-decision-${d.status}`}>
                          {editingDecision?.id === d.id ? (
                            <span className="pm-inline-form pm-inline-form-wide">
                              <input value={editingDecision.statement} onChange={(e) => setEditingDecision({ ...editingDecision, statement: e.target.value })} />
                              <select value={editingDecision.status} onChange={(e) => setEditingDecision({ ...editingDecision, status: e.target.value as ExtractionDecision['status'] })}>
                                {DECISION_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                              </select>
                              <button className="setting-link-btn" onClick={() => { const next = editingDecision; setEditingDecision(null); void editItem('decision', next.id, { statement: next.statement, status: next.status }); }}>Save</button>
                              <button className="setting-link-btn" onClick={() => setEditingDecision(null)}>Cancel</button>
                            </span>
                          ) : (
                            <>
                              <span className={`pm-status pm-status-${d.status}`}>{d.status}</span>
                              <span className="pm-decision-text">{d.statement}</span>
                              {d.evidence.slice(0, 3).map((ev) => (
                                <button key={ev.line_id} type="button" className="cite-chip" onClick={() => jumpTo(ev.line_id)} title={`${ev.speaker}: “${ev.quote}”`}>L{ev.line_id}</button>
                              ))}
                              <button type="button" className="pm-edit-btn" onClick={() => setEditingDecision(d)} aria-label="Edit decision"><Pencil size={12} /></button>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="pm-summary-section">
                  <h4 className="pm-section-title">Action Items</h4>
                  {tasks.filter((t) => t.status !== 'cancelled').length === 0 ? <p className="pm-summary-text">No action items.</p> : (
                    <div className="pm-action-list">
                      {tasks.filter((t) => t.status !== 'cancelled').map((task) => (
                        editingTask?.id === task.id ? (
                          <span key={task.id} className="pm-inline-form pm-inline-form-wide">
                            <input value={editingTask.task} onChange={(e) => setEditingTask({ ...editingTask, task: e.target.value })} aria-label="Task" />
                            <select value={editingTask.owner} onChange={(e) => setEditingTask({ ...editingTask, owner: e.target.value })} aria-label="Owner">
                              {[...new Set(['UNASSIGNED', ...speakerNames, editingTask.owner])].map((name) => <option key={name} value={name}>{name === 'UNASSIGNED' ? 'Unassigned' : name}</option>)}
                            </select>
                            <input value={editingTask.due ?? ''} onChange={(e) => setEditingTask({ ...editingTask, due: e.target.value || null })} placeholder="Due" aria-label="Due" />
                            <button className="setting-link-btn" onClick={() => { const next = editingTask; setEditingTask(null); void editItem('task', next.id, { task: next.task, owner: next.owner, due: next.due }); }}>Save</button>
                            <button className="setting-link-btn" onClick={() => { const next = editingTask; setEditingTask(null); void editItem('task', next.id, { status: 'cancelled' }); }}>Remove</button>
                          </span>
                        ) : (
                          <label key={task.id} className={`pm-action-item ${task.done ? 'pm-action-done' : ''}`}>
                            <input type="checkbox" checked={task.done} onChange={() => void editItem('task', task.id, { done: !task.done })} className="pm-action-checkbox" />
                            <span>
                              {task.task}
                              <span className="pm-task-meta">
                                {task.owner === 'UNASSIGNED' ? 'Unassigned' : task.owner}{task.due ? ` · ${task.due}` : ''}{task.status === 'tentative' ? ' · tentative' : ''}
                              </span>
                            </span>
                            {task.owner_evidence_line_id && <button type="button" className="cite-chip" onClick={(e) => { e.preventDefault(); jumpTo(task.owner_evidence_line_id as number); }}>L{task.owner_evidence_line_id}</button>}
                            <button type="button" className="pm-edit-btn" onClick={(e) => { e.preventDefault(); setEditingTask(task); }} aria-label="Edit task"><Pencil size={12} /></button>
                          </label>
                        )
                      ))}
                    </div>
                  )}
                  {editingTask && !tasks.some((t) => t.id === editingTask.id) ? (
                    <span className="pm-inline-form pm-inline-form-wide">
                      <input autoFocus value={editingTask.task} onChange={(e) => setEditingTask({ ...editingTask, task: e.target.value })} placeholder="New task" aria-label="Task" />
                      <select value={editingTask.owner} onChange={(e) => setEditingTask({ ...editingTask, owner: e.target.value })} aria-label="Owner">
                        {['UNASSIGNED', ...speakerNames].map((name) => <option key={name} value={name}>{name === 'UNASSIGNED' ? 'Unassigned' : name}</option>)}
                      </select>
                      <input value={editingTask.due ?? ''} onChange={(e) => setEditingTask({ ...editingTask, due: e.target.value || null })} placeholder="Due" aria-label="Due" />
                      <button className="setting-link-btn" disabled={!editingTask.task.trim()} onClick={() => { const next = editingTask; setEditingTask(null); void editItem('task', next.id, { task: next.task, owner: next.owner, due: next.due }); }}>Add</button>
                      <button className="setting-link-btn" onClick={() => setEditingTask(null)}>Cancel</button>
                    </span>
                  ) : (
                    <button className="setting-link-btn" onClick={() => setEditingTask({ id: `u${Date.now()}`, task: '', owner: 'UNASSIGNED', owner_evidence_line_id: null, due: null, status: 'confirmed', done: false })}>+ Add task</button>
                  )}
                </div>

                {extraction.key_points.length > 0 && (
                  <div className="pm-summary-section">
                    <h4 className="pm-section-title">Key Discussion Points</h4>
                    <ul className="pm-key-points">{extraction.key_points.map((point) => <li key={point.text}>{point.text}</li>)}</ul>
                  </div>
                )}
                {extraction.documents_requested.length > 0 && (
                  <div className="pm-summary-section">
                    <h4 className="pm-section-title">Documents Requested</h4>
                    <ul className="pm-key-points">{extraction.documents_requested.map((doc) => <li key={doc.item}>{doc.item}{doc.from ? ` (from ${doc.from})` : ''}</li>)}</ul>
                  </div>
                )}
                {extraction.figures.length > 0 && (
                  <div className="pm-summary-section">
                    <h4 className="pm-section-title">Figures Mentioned</h4>
                    <ul className="pm-key-points">{extraction.figures.map((f) => <li key={`${f.label}-${f.value}`}>{f.label}: {f.value}</li>)}</ul>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="pm-right-col">
          <MeetingAsk dbId={meetingDbId} ready={Boolean(extraction)} initialHistory={artifacts?.ask?.history ?? []} onJump={jumpTo} />

          <div className="pm-metrics bento-panel">
            <div className="bento-panel-header"><BarChart3 size={16} /><span>Metrics</span></div>
            <div className="pm-metrics-body">
              <div className="pm-metric"><Clock size={18} className="pm-metric-icon" /><div><span className="pm-metric-value">{durationMin ? `${durationMin} min` : '--'}</span><span className="pm-metric-label">Duration</span></div></div>
              <div className="pm-metric"><Users size={18} className="pm-metric-icon" /><div><span className="pm-metric-value">{diarizedSpeakers ?? (speakerNames.filter((n) => n !== 'Speaker').length || '--')}</span><span className="pm-metric-label">Speakers</span></div></div>
              <div className="pm-metric"><MessageSquare size={18} className="pm-metric-icon" /><div><span className="pm-metric-value">{entries.length}</span><span className="pm-metric-label">Transcript Lines</span></div></div>
              <div className="pm-metric"><CheckSquare size={18} className="pm-metric-icon" /><div><span className="pm-metric-value">{tasks.filter((t) => t.status !== 'cancelled').length}</span><span className="pm-metric-label">Action Items</span></div></div>
            </div>
          </div>

          {showCost && cost && (
            <div className="pm-cost bento-panel">
              <div className="bento-panel-header">
                <IndianRupee size={16} /><span>Meeting Cost</span>
                <span className="bento-badge">{cost.pricesVerified ? 'estimate' : 'rough estimate'}</span>
              </div>
              <div className="pm-cost-body">
                <div className="pm-cost-total">{formatInr(cost.totalInr)}<span className="pm-cost-usd">≈ ${cost.totalUsd.toFixed(2)}</span></div>
                <dl className="pm-cost-lines">
                  <div><dt>Transcription ({Math.round(cost.audioMinutes)} min{cost.speakerDetection ? ', with speakers' : ''})</dt><dd>{formatInr(cost.breakdown?.transcriptionInr ?? cost.sttInr)}</dd></div>
                  <div><dt>Highlights + minutes</dt><dd>{formatInr(cost.breakdown?.notesInr ?? cost.aiInr)}</dd></div>
                  <div><dt>Ask and templates</dt><dd>{formatInr(cost.breakdown?.askInr ?? 0)}</dd></div>
                  {(cost.breakdown?.liveInsightsInr ?? 0) > 0 && <div><dt>Live insights</dt><dd>{formatInr(cost.breakdown?.liveInsightsInr ?? 0)}</dd></div>}
                </dl>
                <p className="pm-cost-note">List prices, excluding GST. {cost.aiCalls} AI calls. Hide this in Settings.</p>
              </div>
            </div>
          )}

          <div className="pm-transcript bento-panel">
            <button className="bento-panel-header pm-transcript-toggle" onClick={() => setShowTranscript((value) => !value)} aria-expanded={showTranscript}>
              <MessageSquare size={16} /><span>Transcript</span>
              <span className="bento-badge">{entries.length} lines</span>
              <ChevronDown size={14} className={showTranscript ? 'pm-chevron-open' : ''} />
            </button>
            {showTranscript && (
              <div className="pm-transcript-body" ref={transcriptRef}>
                {entries.length === 0
                  ? <p className="pm-summary-text">{isProcessing ? 'The transcript will appear here shortly.' : 'No transcript for this meeting.'}</p>
                  : entries.map((entry, index) => (
                    <p key={index} data-line={index + 1} className={`pm-transcript-line ${highlightLine === index + 1 ? 'pm-transcript-line-hit' : ''}`}>
                      <span className="pm-transcript-time">L{index + 1}</span>
                      <select
                        className="pm-transcript-speaker-select"
                        value={entry.speakerLabel}
                        title="Wrong speaker? Choose who said this"
                        onChange={(e) => void run(() => window.electronAPI.reassignLine({ dbId: meetingDbId, lineId: index + 1, speakerLabel: e.target.value }))}
                      >
                        {[...new Set([entry.speakerLabel, ...speakerNames])].map((name) => <option key={name} value={name}>{name}</option>)}
                      </select>
                      <span>{entry.text}</span>
                    </p>
                  ))}
              </div>
            )}
            {(meeting?.video_file_path || meeting?.audio_file_path) && (
              <button className="setting-link-btn pm-open-recording" onClick={() => void window.electronAPI.openInExplorer((meeting.video_file_path || meeting.audio_file_path) as string)}>
                <FolderOpen size={14} /> Show recording file
              </button>
            )}
          </div>

          <div className="pm-export bento-panel">
            <div className="bento-panel-header"><Download size={16} /><span>Export</span></div>
            <div className="pm-export-body">
              {exportStatus && <p className="pm-export-status">{exportStatus}</p>}
              <div className="pm-export-buttons">
                <button className="pm-export-btn pm-export-btn-primary" onClick={() => void handleExport('pdf')} disabled={Boolean(exporting)}><Download size={16} />MoM as PDF</button>
                <button className="pm-export-btn pm-export-btn-secondary" onClick={() => void handleExport('markdown')} disabled={Boolean(exporting)}><FileText size={16} />Markdown</button>
                <button className="pm-export-btn pm-export-btn-secondary" onClick={() => void handleExport('json')} disabled={Boolean(exporting) || !extraction}><FileJson size={16} />Record (JSON)</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Ask after the meeting: open questions plus saved templates. */
function MeetingAsk({ dbId, ready, initialHistory, onJump }: { dbId: number; ready: boolean; initialHistory: QuickLookHistoryItem[]; onJump: (lineId: number) => void }) {
  const [messages, setMessages] = useState<QuickLookHistoryItem[]>(initialHistory);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<MeetingTemplate[]>([]);
  const [copied, setCopied] = useState<number | null>(null);
  const areaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { setMessages(initialHistory); }, [dbId]);
  useEffect(() => { void window.electronAPI?.listTemplates().then(setTemplates).catch(() => {}); }, []);
  useEffect(() => { areaRef.current?.scrollTo({ top: areaRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, busy]);

  const ask = async () => {
    const text = question.trim();
    if (!text || busy) return;
    setQuestion('');
    setError(null);
    const history = messages;
    setMessages([...history, { role: 'user', text }]);
    setBusy(true);
    try {
      const result = await window.electronAPI.askMeeting({ dbId, question: text, history });
      if (!result.success) throw new Error(result.error);
      setMessages((list) => [...list, { role: 'ai', text: result.value.answer, citations: result.value.citations }]);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const runTemplate = async (template: MeetingTemplate) => {
    if (busy) return;
    setError(null);
    setMessages((list) => [...list, { role: 'user', text: template.name }]);
    setBusy(true);
    try {
      const result = await window.electronAPI.runTemplate({ dbId, templateId: template.id });
      if (!result.success) throw new Error(result.error);
      setMessages((list) => [...list, { role: 'ai', text: result.value.text }]);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, index: number) => {
    await navigator.clipboard.writeText(text.replace(/\s?\[L\d+\]/g, ''));
    setCopied(index);
    window.setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="bento-panel pm-ask">
      <div className="bento-panel-header"><Sparkles size={16} /><span>Ask about this meeting</span></div>
      <div className="pm-ask-templates">
        {templates.map((template) => (
          <button key={template.id} type="button" className="meeting-chip pm-template-chip" disabled={!ready || busy} onClick={() => void runTemplate(template)}>
            {template.name}
          </button>
        ))}
      </div>
      <div ref={areaRef} className="ai-chat-area pm-ask-area">
        {messages.length === 0 && !busy && (
          <div className="ai-empty">{ready ? 'Ask anything about the meeting, or pick a template above. Answers cite transcript lines.' : 'Available once the meeting record is ready.'}</div>
        )}
        {messages.map((message, index) => (
          <div key={index} className={`ai-msg ai-msg-${message.role}`}>
            {message.role === 'ai' ? (
              <>
                <Sparkles size={14} className="ai-msg-icon" />
                <div className="ai-msg-content">
                  <p className="pm-ask-answer"><CitedText text={message.text} onJump={onJump} /></p>
                  <button type="button" className="pm-copy-btn" onClick={() => void copy(message.text, index)}>
                    {copied === index ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
                  </button>
                </div>
              </>
            ) : <p>{message.text}</p>}
          </div>
        ))}
        {busy && <div className="ai-msg ai-msg-ai"><div className="recorder-spinner" style={{ width: 14, height: 14 }} /><p>Thinking…</p></div>}
        {error && <div className="ai-msg ai-msg-ai"><p>{error}</p></div>}
      </div>
      <div className="ai-input-wrap">
        <input
          type="text"
          className="ai-input"
          placeholder={ready ? 'Ask about the meeting…' : 'Waiting for the meeting record…'}
          value={question}
          disabled={!ready}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void ask(); } }}
        />
        <button className="ai-send" onClick={() => void ask()} disabled={!ready || busy || !question.trim()}><Send size={16} /></button>
      </div>
    </div>
  );
}

async function loadMeetingArtifacts(
  meetingDbId: number,
  setMeetingData: (value: MeetingArtifactsResponse | null) => void,
  setLoading: (value: boolean) => void,
  setError: (value: string) => void,
) {
  if (!window.electronAPI) {
    setLoading(false);
    setError('Electron API is unavailable.');
    return;
  }
  setLoading(true);
  setError('');
  try {
    setMeetingData(await window.electronAPI.getMeetingArtifacts({ dbId: meetingDbId }));
  } catch (caughtError) {
    setError(caughtError instanceof Error ? caughtError.message : 'Unable to load meeting data.');
  } finally {
    setLoading(false);
  }
}
