import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Briefcase,
  Building2,
  CheckSquare,
  ChevronDown,
  FolderOpen,
  Loader2,
  RotateCcw,
  Clock,
  Download,
  FileText,
  IndianRupee,
  MessageSquare,
  Users,
} from 'lucide-react';
import type { MeetingArtifactsResponse, MeetingCost, ProcessingState } from '../types/meeting';

const cleanIpcError = (message: string) => message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const formatInr = (value: number) => `₹${value < 10 ? value.toFixed(2) : value.toFixed(0)}`;

interface ActionItem {
  id: number;
  text: string;
  done: boolean;
}

interface PostMeetingDashboardProps {
  meetingTitle: string;
  meetingDbId: number;
  onNewMeeting: () => void;
  isReview?: boolean;
}

export default function PostMeetingDashboard({
  meetingTitle,
  meetingDbId,
  onNewMeeting,
  isReview = false,
}: PostMeetingDashboardProps) {
  const [meetingData, setMeetingData] = useState<MeetingArtifactsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [completedActionIds, setCompletedActionIds] = useState<number[]>([]);
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'markdown' | null>(null);
  const [exportStatus, setExportStatus] = useState('');
  const [displayTitle, setDisplayTitle] = useState(meetingTitle);
  const [showCost, setShowCost] = useState(false);
  const [processing, setProcessing] = useState<{ state: ProcessingState; note: string | null } | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);

  // Post-meeting pipeline status (writing minutes, identifying speakers, ...).
  useEffect(() => {
    if (!window.electronAPI?.onMeetingProcessing) return undefined;
    return window.electronAPI.onMeetingProcessing((event) => {
      if (event.dbId !== meetingDbId) return;
      setProcessing({ state: event.state, note: event.note });
      if (event.state === 'done') void loadMeetingArtifacts(meetingDbId, setMeetingData, () => {}, setError);
    });
  }, [meetingDbId]);
  const [cost, setCost] = useState<MeetingCost | null>(null);

  useEffect(() => {
    void window.electronAPI?.getAppSettings().then((settings) => setShowCost(settings.showCost)).catch(() => {});
  }, []);

  // Recompute whenever artifacts change: highlights/minutes add AI calls after the meeting ends.
  useEffect(() => {
    if (!showCost || !window.electronAPI) return;
    void window.electronAPI.getMeetingCost({ dbId: meetingDbId }).then(setCost).catch(() => setCost(null));
  }, [showCost, meetingDbId, meetingData]);

  // Listen for auto-generated title updates
  useEffect(() => {
    if (!window.electronAPI?.onMeetingTitleUpdated) return undefined;

    window.electronAPI.onMeetingTitleUpdated((event) => {
      if (event.dbId === meetingDbId) {
        setDisplayTitle(event.title);
      }
    });

    return () => {
      window.electronAPI.offMeetingTitleUpdated?.();
    };
  }, [meetingDbId]);

  useEffect(() => {
    void loadMeetingArtifacts(meetingDbId, setMeetingData, setLoading, setError);
  }, [meetingDbId]);

  const startTimeMs = meetingData?.meeting?.start_time_ms ?? null;
  useEffect(() => {
    if (!window.electronAPI?.onMeetingArtifactsUpdated) return undefined;

    window.electronAPI.onMeetingArtifactsUpdated((event) => {
      const matches = (event as { dbId?: number }).dbId === meetingDbId || (startTimeMs !== null && event.meetingId === startTimeMs);
      if (!matches) return;
      // Quiet refresh: keep what is on screen while new results load.
      void loadMeetingArtifacts(meetingDbId, setMeetingData, () => {}, setError);
    });

    return () => {
      window.electronAPI.offMeetingArtifactsUpdated?.();
    };
  }, [startTimeMs, meetingDbId]);

  const processingState = processing?.state ?? meetingData?.meeting?.processing_state ?? 'done';
  const processingNote = processing?.note ?? meetingData?.meeting?.processing_note ?? null;
  const isProcessing = processingState === 'transcribing' || processingState === 'analyzing';

  const actionItems = useMemo<ActionItem[]>(
    () => (meetingData?.artifacts?.highlights?.actionItems ?? []).map((text, index) => ({
      id: index + 1,
      text,
      done: completedActionIds.includes(index + 1),
    })),
    [completedActionIds, meetingData?.artifacts?.highlights?.actionItems],
  );

  const metrics = useMemo(() => {
    const meeting = meetingData?.meeting;
    const transcriptEntries = meetingData?.transcriptEntries ?? [];
    const speakerCount = new Set(
      transcriptEntries
        .filter((entry) => entry.speakerLabel !== 'You')
        .map((entry) => entry.speakerLabel),
    ).size;

    const durationMs = meeting?.start_time_ms && meeting?.end_time_ms
      ? meeting.end_time_ms - meeting.start_time_ms
      : 0;

    return {
      duration: durationMs > 0 ? `${Math.max(1, Math.round(durationMs / 60000))} min` : '--',
      speakers: speakerCount || 0,
      transcriptLines: transcriptEntries.length,
      actionItems: actionItems.length,
    };
  }, [actionItems.length, meetingData]);

  const highlights = meetingData?.artifacts?.highlights ?? {
    status: 'idle',
    updatedAt: null,
    error: null,
    summary: '',
    keyDiscussionPoints: [],
    actionItems: [],
  };
  const highlightsFailed = !loading && highlights?.status === 'error' && !isProcessing;
  const isHighlightsLoading = !highlightsFailed && (loading || !highlights || highlights.status === 'loading' || highlights.status === 'idle');

  const toggleAction = (id: number) => {
    setCompletedActionIds((previous) => (
      previous.includes(id)
        ? previous.filter((value) => value !== id)
        : [...previous, id]
    ));
  };

  const handleExport = async (format: 'pdf' | 'markdown') => {
    if (!window.electronAPI || exportingFormat) return;

    setExportingFormat(format);
    setExportStatus(
      format === 'pdf'
        ? 'Preparing a polished PDF MoM...'
        : 'Preparing the Markdown MoM...',
    );

    try {
      const result = await window.electronAPI.exportMeetingMom({
        dbId: meetingDbId,
        format,
      });
      setExportStatus(
        format === 'pdf'
          ? 'PDF exported successfully.'
          : 'Markdown exported successfully.',
      );
      await window.electronAPI.openInExplorer(result.filePath);
    } catch (caughtError) {
      const message = caughtError instanceof Error ? cleanIpcError(caughtError.message) : 'Export failed.';
      setExportStatus(message);
    } finally {
      setExportingFormat(null);
    }
  };

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

      {(meetingData?.meeting?.client_name || meetingData?.meeting?.project_name || meetingData?.meeting?.agenda) && (
        <div className="pm-context">
          {meetingData.meeting.client_name && <span className="meeting-chip"><Building2 size={12} /> {meetingData.meeting.client_name}</span>}
          {meetingData.meeting.project_name && <span className="meeting-chip"><Briefcase size={12} /> {meetingData.meeting.project_name}</span>}
          {meetingData.meeting.agenda && <span className="pm-context-agenda">{meetingData.meeting.agenda}</span>}
        </div>
      )}

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

      <div className="pm-grid">
        <div className="pm-highlights bento-panel">
          <div className="bento-panel-header">
            <FileText size={16} />
            <span>Meeting Highlights</span>
          </div>

          <div className="pm-highlights-body">
            <div className="pm-summary-section">
              <h4 className="pm-section-title">Summary</h4>
              <p className="pm-summary-text">
                {error
                  ? error
                  : highlightsFailed
                    ? `Highlights could not be generated: ${highlights.error ?? 'unknown error'}. Check Settings → AI & Transcription, then reopen this meeting.`
                  : isHighlightsLoading
                    ? 'Generating meeting highlights from the transcript...'
                    : highlights.summary}
              </p>
            </div>

            <div className="pm-summary-section">
              <h4 className="pm-section-title">Key Discussion Points</h4>
              {isHighlightsLoading ? (
                <p className="pm-summary-text">Key points will appear here once analysis completes.</p>
              ) : highlights.keyDiscussionPoints.length === 0 ? (
                <p className="pm-summary-text">No discussion points were generated for this meeting.</p>
              ) : (
                <ul className="pm-key-points">
                  {highlights.keyDiscussionPoints.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="pm-summary-section">
              <h4 className="pm-section-title">Action Items</h4>
              {isHighlightsLoading ? (
                <p className="pm-summary-text">Action items will appear here once analysis completes.</p>
              ) : actionItems.length === 0 ? (
                <p className="pm-summary-text">No action items were generated for this meeting.</p>
              ) : (
                <div className="pm-action-list">
                  {actionItems.map((item) => (
                    <label
                      key={item.id}
                      className={`pm-action-item ${item.done ? 'pm-action-done' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={item.done}
                        onChange={() => toggleAction(item.id)}
                        className="pm-action-checkbox"
                      />
                      <span>{item.text}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="pm-right-col">
          <div className="pm-metrics bento-panel">
            <div className="bento-panel-header">
              <BarChart3 size={16} />
              <span>Metrics</span>
            </div>

            <div className="pm-metrics-body">
              <div className="pm-metric">
                <Clock size={18} className="pm-metric-icon" />
                <div>
                  <span className="pm-metric-value">{metrics.duration}</span>
                  <span className="pm-metric-label">Duration</span>
                </div>
              </div>
              <div className="pm-metric">
                <Users size={18} className="pm-metric-icon" />
                <div>
                  <span className="pm-metric-value">{metrics.speakers}</span>
                  <span className="pm-metric-label">Speakers</span>
                </div>
              </div>
              <div className="pm-metric">
                <MessageSquare size={18} className="pm-metric-icon" />
                <div>
                  <span className="pm-metric-value">{metrics.transcriptLines}</span>
                  <span className="pm-metric-label">Transcript Lines</span>
                </div>
              </div>
              <div className="pm-metric">
                <CheckSquare size={18} className="pm-metric-icon" />
                <div>
                  <span className="pm-metric-value">{metrics.actionItems}</span>
                  <span className="pm-metric-label">Action Items</span>
                </div>
              </div>
            </div>
          </div>

          {showCost && cost && (
            <div className="pm-cost bento-panel">
              <div className="bento-panel-header">
                <IndianRupee size={16} />
                <span>Meeting Cost</span>
                <span className="bento-badge">{cost.pricesVerified ? 'estimate' : 'rough estimate'}</span>
              </div>
              <div className="pm-cost-body">
                <div className="pm-cost-total">
                  {formatInr(cost.totalInr)}
                  <span className="pm-cost-usd">≈ ${cost.totalUsd.toFixed(2)}</span>
                </div>
                <dl className="pm-cost-lines">
                  <div><dt>Transcription (Sarvam, {Math.round(cost.audioMinutes)} min{cost.speakerDetection ? ', with speaker detection' : ''})</dt><dd>{formatInr(cost.sttInr)}</dd></div>
                  <div><dt>AI analysis ({cost.aiCalls} calls)</dt><dd>{formatInr(cost.aiInr)}</dd></div>
                  {cost.searchInr > 0 && <div><dt>Web search</dt><dd>{formatInr(cost.searchInr)}</dd></div>}
                </dl>
                <p className="pm-cost-note">
                  List prices, excluding GST. {cost.pricesVerified ? '' : 'Gemini 3.5 Flash Mumbai price not yet confirmed. '}Hide this in Settings.
                </p>
              </div>
            </div>
          )}

          <div className="pm-transcript bento-panel">
            <button className="bento-panel-header pm-transcript-toggle" onClick={() => setShowTranscript((value) => !value)} aria-expanded={showTranscript}>
              <MessageSquare size={16} />
              <span>Transcript</span>
              <span className="bento-badge">{metrics.transcriptLines} lines</span>
              <ChevronDown size={14} className={showTranscript ? 'pm-chevron-open' : ''} />
            </button>
            {showTranscript && (
              <div className="pm-transcript-body">
                {(meetingData?.transcriptEntries ?? []).length === 0
                  ? <p className="pm-summary-text">{isProcessing ? 'The transcript will appear here shortly.' : 'No transcript for this meeting.'}</p>
                  : (meetingData?.transcriptEntries ?? []).map((entry, index) => (
                    <p key={index} className="pm-transcript-line">
                      <span className="pm-transcript-time">{entry.timestamp}</span>
                      <span className="pm-transcript-speaker">{entry.speakerLabel}</span>
                      <span>{entry.text}</span>
                    </p>
                  ))}
              </div>
            )}
            {(meetingData?.meeting?.video_file_path || meetingData?.meeting?.audio_file_path) && (
              <button
                className="setting-link-btn pm-open-recording"
                onClick={() => void window.electronAPI.openInExplorer((meetingData.meeting.video_file_path || meetingData.meeting.audio_file_path) as string)}
              >
                <FolderOpen size={14} /> Show recording file
              </button>
            )}
          </div>

          <div className="pm-export bento-panel">
            <div className="bento-panel-header">
              <Download size={16} />
              <span>Export MoM</span>
            </div>

            <div className="pm-export-body">
              <p className="pm-export-hint">
                Download the Minutes of Meeting in your preferred format.
              </p>
              {exportStatus && (
                <p className="pm-export-status">{exportStatus}</p>
              )}
              <div className="pm-export-buttons">
                <button
                  className="pm-export-btn pm-export-btn-primary"
                  onClick={() => void handleExport('pdf')}
                  disabled={Boolean(exportingFormat)}
                >
                  <Download size={16} />
                  {exportingFormat === 'pdf' ? 'Generating PDF...' : 'Export as PDF'}
                </button>
                <button
                  className="pm-export-btn pm-export-btn-secondary"
                  onClick={() => void handleExport('markdown')}
                  disabled={Boolean(exportingFormat)}
                >
                  <FileText size={16} />
                  {exportingFormat === 'markdown' ? 'Generating Markdown...' : 'Export as Markdown'}
                </button>
              </div>
            </div>
          </div>
        </div>
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
    const payload = await window.electronAPI.getMeetingArtifacts({ dbId: meetingDbId });
    setMeetingData(payload);
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : 'Unable to load meeting data.';
    setError(message);
  } finally {
    setLoading(false);
  }
}
