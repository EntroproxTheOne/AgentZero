import { useEffect, useState } from 'react';
import { Calendar, Clock, ExternalLink, FolderOpen, Search } from 'lucide-react';
import type { MeetingRecord } from '../types/meeting';

export default function PastMeetings() {
  const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadMeetings(setMeetings, setLoading);
  }, []);

  const filteredMeetings = meetings.filter((meeting) =>
    meeting.title.toLowerCase().includes(search.toLowerCase()),
  );

  const handleOpenInExplorer = (filePath: string | null) => {
    if (filePath && window.electronAPI) {
      void window.electronAPI.openInExplorer(filePath);
    }
  };

  return (
    <div className="page-container">
      <header className="page-header">
        <h2 className="page-label">Library</h2>
        <h3 className="page-title">Past Meetings</h3>
      </header>

      <div className="search-bar">
        <Search size={16} className="search-icon" />
        <input
          type="text"
          placeholder="Search meetings..."
          className="search-input"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {loading ? (
        <div className="empty-state">
          <div className="recorder-spinner" style={{ width: 28, height: 28 }} />
        </div>
      ) : filteredMeetings.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <FolderOpen size={48} />
          </div>
          <h4 className="empty-state-title">
            {meetings.length === 0 ? 'No recordings yet' : 'No matches found'}
          </h4>
          <p className="empty-state-text">
            {meetings.length === 0
              ? 'Recorded meetings will appear here. Start by recording your first meeting from the Dashboard.'
              : 'Try a different search term.'}
          </p>
        </div>
      ) : (
        <div className="meetings-list">
          {filteredMeetings.map((meeting) => (
            <div
              key={meeting.id}
              className="meeting-card"
              onClick={() => handleOpenInExplorer(meeting.video_file_path)}
              title="Click to open in Explorer"
            >
              <div className="meeting-card-info">
                <h4 className="meeting-card-title">{meeting.title}</h4>
                <div className="meeting-card-meta">
                  <span className="meeting-card-meta-item">
                    <Calendar size={13} /> {formatDate(meeting.date)}
                  </span>
                  <span className="meeting-card-meta-item">
                    <Clock size={13} /> {formatTime(meeting.date)}
                  </span>
                </div>
              </div>
              <div className="meeting-card-action">
                <ExternalLink size={16} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

async function loadMeetings(
  setMeetings: (value: MeetingRecord[]) => void,
  setLoading: (value: boolean) => void,
) {
  if (!window.electronAPI) {
    setLoading(false);
    return;
  }

  try {
    const data = await window.electronAPI.getMeetings();
    setMeetings(data);
  } catch (error) {
    console.error('Error loading meetings:', error);
  } finally {
    setLoading(false);
  }
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatTime(dateStr: string) {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}
