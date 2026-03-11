import { useState, useEffect } from 'react';
import { FolderOpen, Calendar, Clock, Search, ExternalLink } from 'lucide-react';

interface Meeting {
  id: number;
  title: string;
  date: string;
  video_file_path: string;
}

export default function PastMeetings() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMeetings();
  }, []);

  const loadMeetings = async () => {
    if (!window.electronAPI) {
      setLoading(false);
      return;
    }
    try {
      const data = await window.electronAPI.getMeetings();
      setMeetings(data);
    } catch (err) {
      console.error('Error loading meetings:', err);
    }
    setLoading(false);
  };

  const filteredMeetings = meetings.filter((m) =>
    m.title.toLowerCase().includes(search.toLowerCase())
  );

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit',
    });
  };

  const handleOpenInExplorer = (filePath: string) => {
    if (window.electronAPI) {
      window.electronAPI.openInExplorer(filePath);
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
          onChange={(e) => setSearch(e.target.value)}
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
          {filteredMeetings.map((m) => (
            <div
              key={m.id}
              className="meeting-card"
              onClick={() => handleOpenInExplorer(m.video_file_path)}
              title="Click to open in Explorer"
            >
              <div className="meeting-card-info">
                <h4 className="meeting-card-title">{m.title}</h4>
                <div className="meeting-card-meta">
                  <span className="meeting-card-meta-item">
                    <Calendar size={13} /> {formatDate(m.date)}
                  </span>
                  <span className="meeting-card-meta-item">
                    <Clock size={13} /> {formatTime(m.date)}
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
