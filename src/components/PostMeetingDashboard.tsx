import { useState } from 'react';
import {
  FileText,
  CheckSquare,
  Download,
  BarChart3,
  Clock,
  Users,
  MessageSquare,
} from 'lucide-react';

/* ─── Types ─── */
interface ActionItem {
  id: number;
  text: string;
  done: boolean;
}

interface PostMeetingDashboardProps {
  meetingTitle: string;
  onNewMeeting: () => void;
}

/* ─── Component ─── */
export default function PostMeetingDashboard({
  meetingTitle,
  onNewMeeting,
}: PostMeetingDashboardProps) {
  const [actionItems, setActionItems] = useState<ActionItem[]>([
    { id: 1, text: 'Send follow-up email to stakeholders', done: false },
    { id: 2, text: 'Update project roadmap with new deadlines', done: false },
    { id: 3, text: 'Schedule one-on-one with design lead', done: false },
    { id: 4, text: 'Share meeting recording with absent team members', done: false },
    { id: 5, text: 'Create Jira tickets for discussed action items', done: false },
  ]);

  const toggleAction = (id: number) => {
    setActionItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, done: !item.done } : item))
    );
  };

  const handleExport = (format: 'pdf' | 'markdown') => {
    // Placeholder — will integrate actual export in a later phase
    console.log(`Export as ${format} requested`);
    alert(`Export as ${format.toUpperCase()} — coming soon!`);
  };

  return (
    <div className="post-meeting">
      {/* ── Header ── */}
      <div className="post-meeting-header">
        <div>
          <h2 className="page-label">Meeting Ended</h2>
          <h3 className="page-title">{meetingTitle || 'Meeting Summary'}</h3>
        </div>
        <button className="pm-new-meeting-btn" onClick={onNewMeeting}>
          Start New Meeting
        </button>
      </div>

      {/* ── Main Grid ── */}
      <div className="pm-grid">
        {/* Left large area — Meeting Highlights */}
        <div className="pm-highlights bento-panel">
          <div className="bento-panel-header">
            <FileText size={16} />
            <span>Meeting Highlights</span>
          </div>

          <div className="pm-highlights-body">
            <div className="pm-summary-section">
              <h4 className="pm-section-title">Summary</h4>
              <p className="pm-summary-text">
                The team discussed the upcoming product launch timeline, reviewed design
                mockups for the dashboard redesign, and identified key blockers in the API
                integration. Action items were assigned to respective team leads with a
                follow-up scheduled for next week.
              </p>
            </div>

            <div className="pm-summary-section">
              <h4 className="pm-section-title">Key Discussion Points</h4>
              <ul className="pm-key-points">
                <li>Product launch moved to Q3 due to API delays</li>
                <li>Design team to finalize new dashboard by Friday</li>
                <li>Backend migration to new DB cluster approved</li>
                <li>Budget increase approved for cloud infrastructure</li>
              </ul>
            </div>

            <div className="pm-summary-section">
              <h4 className="pm-section-title">Action Items</h4>
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
            </div>
          </div>
        </div>

        {/* Right side — Metrics + Export */}
        <div className="pm-right-col">
          {/* Metrics card */}
          <div className="pm-metrics bento-panel">
            <div className="bento-panel-header">
              <BarChart3 size={16} />
              <span>Metrics</span>
            </div>

            <div className="pm-metrics-body">
              <div className="pm-metric">
                <Clock size={18} className="pm-metric-icon" />
                <div>
                  <span className="pm-metric-value">47 min</span>
                  <span className="pm-metric-label">Duration</span>
                </div>
              </div>
              <div className="pm-metric">
                <Users size={18} className="pm-metric-icon" />
                <div>
                  <span className="pm-metric-value">4</span>
                  <span className="pm-metric-label">Speakers</span>
                </div>
              </div>
              <div className="pm-metric">
                <MessageSquare size={18} className="pm-metric-icon" />
                <div>
                  <span className="pm-metric-value">128</span>
                  <span className="pm-metric-label">Transcript Lines</span>
                </div>
              </div>
              <div className="pm-metric">
                <CheckSquare size={18} className="pm-metric-icon" />
                <div>
                  <span className="pm-metric-value">{actionItems.length}</span>
                  <span className="pm-metric-label">Action Items</span>
                </div>
              </div>
            </div>
          </div>

          {/* Export card */}
          <div className="pm-export bento-panel">
            <div className="bento-panel-header">
              <Download size={16} />
              <span>Export MoM</span>
            </div>

            <div className="pm-export-body">
              <p className="pm-export-hint">
                Download the Minutes of Meeting in your preferred format.
              </p>
              <div className="pm-export-buttons">
                <button
                  className="pm-export-btn pm-export-btn-primary"
                  onClick={() => handleExport('pdf')}
                >
                  <Download size={16} />
                  Export as PDF
                </button>
                <button
                  className="pm-export-btn pm-export-btn-secondary"
                  onClick={() => handleExport('markdown')}
                >
                  <FileText size={16} />
                  Export as Markdown
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
