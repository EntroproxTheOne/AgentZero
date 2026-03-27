import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  CheckSquare,
  Clock,
  Download,
  FileText,
  MessageSquare,
  Users,
} from 'lucide-react';
import type { MeetingArtifactsResponse } from '../types/meeting';

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

  useEffect(() => {
    if (!window.electronAPI?.onMeetingArtifactsUpdated || !meetingData?.artifacts?.meetingId) {
      return undefined;
    }

    window.electronAPI.onMeetingArtifactsUpdated((event) => {
      if (event.meetingId !== meetingData.artifacts?.meetingId) return;
      void loadMeetingArtifacts(meetingDbId, setMeetingData, setLoading, setError);
    });

    return () => {
      window.electronAPI.offMeetingArtifactsUpdated?.();
    };
  }, [meetingData?.artifacts?.meetingId, meetingDbId]);

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
  const isHighlightsLoading = loading || !highlights || highlights.status === 'loading' || highlights.status === 'idle';

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
      const message = caughtError instanceof Error ? caughtError.message : 'Export failed.';
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
