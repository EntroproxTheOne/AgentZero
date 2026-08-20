import { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Check,
  Clock,
  Edit3,
  Eye,
  FolderOpen,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { MeetingRecord } from '../types/meeting';

interface PastMeetingsProps {
  onOpenMeeting?: (dbId: number, title: string) => void;
}

export default function PastMeetings({ onOpenMeeting }: PastMeetingsProps) {
  const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [generatingTitleId, setGeneratingTitleId] = useState<number | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  useEffect(() => {
    void loadMeetings(setMeetings, setLoading);
  }, []);

  const filteredMeetings = useMemo(
    () => meetings.filter((m) => m.title.toLowerCase().includes(search.toLowerCase())),
    [meetings, search],
  );

  const isAllSelected = filteredMeetings.length > 0 && filteredMeetings.every((m) => selectedIds.has(m.id));
  const hasSelection = selectedIds.size > 0;

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleToggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredMeetings.map((m) => m.id)));
    }
  };

  const handleCardClick = (meeting: MeetingRecord) => {
    if (editingId) return;
    onOpenMeeting?.(meeting.id, meeting.title);
  };

  const handleOpenFolder = (e: React.MouseEvent, filePath: string | null) => {
    e.stopPropagation();
    if (filePath && window.electronAPI) void window.electronAPI.openInExplorer(filePath);
  };

  // ── Rename ─────────────────────────────────────────────────────────────────

  const handleStartEdit = (e: React.MouseEvent, meeting: MeetingRecord) => {
    e.stopPropagation();
    setEditingId(meeting.id);
    setEditTitle(meeting.title);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditTitle('');
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editTitle.trim() || !window.electronAPI) return;
    await window.electronAPI.renameMeeting({ dbId: editingId, title: editTitle.trim() });
    setMeetings((prev) =>
      prev.map((m) => (m.id === editingId ? { ...m, title: editTitle.trim() } : m)),
    );
    handleCancelEdit();
  };

  // ── Auto-title ─────────────────────────────────────────────────────────────

  const handleAutoTitle = async (e: React.MouseEvent, meeting: MeetingRecord) => {
    e.stopPropagation();
    if (!window.electronAPI || generatingTitleId) return;
    setGeneratingTitleId(meeting.id);
    try {
      const result = await window.electronAPI.autoTitleMeeting({ dbId: meeting.id });
      setMeetings((prev) =>
        prev.map((m) => (m.id === meeting.id ? { ...m, title: result.title } : m)),
      );
    } catch (err) {
      console.error('Auto-title failed:', err);
    } finally {
      setGeneratingTitleId(null);
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────────────

  const handleDeleteSingle = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    setDeletingIds(new Set([id]));
    try {
      await window.electronAPI?.deleteMeetings({ dbIds: [id] });
      setMeetings((prev) => prev.filter((m) => m.id !== id));
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    } finally {
      setDeletingIds(new Set());
    }
  };

  const handleDeleteSelected = async () => {
    if (!hasSelection || !window.electronAPI) return;
    const ids = Array.from(selectedIds);
    setDeletingIds(new Set(ids));
    setConfirmDeleteAll(false);
    try {
      await window.electronAPI.deleteMeetings({ dbIds: ids });
      setMeetings((prev) => prev.filter((m) => !selectedIds.has(m.id)));
      setSelectedIds(new Set());
    } finally {
      setDeletingIds(new Set());
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="page-container">
      <header className="page-header">
        <h2 className="page-label">Library</h2>
        <h3 className="page-title">Past Meetings</h3>
      </header>

      {/* Toolbar */}
      <div className="pm-toolbar">
        <div className="search-bar pm-search">
          <Search size={16} className="search-icon" />
          <input
            type="text"
            placeholder="Search meetings..."
            className="search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {filteredMeetings.length > 0 && (
          <div className="pm-toolbar-actions">
            <button className="pm-toolbar-btn" onClick={handleToggleSelectAll} title={isAllSelected ? 'Deselect all' : 'Select all'}>
              <Check size={14} />
              {isAllSelected ? 'Deselect All' : 'Select All'}
            </button>
            {hasSelection && (
              confirmDeleteAll ? (
                <div className="pm-confirm-group">
                  <span className="pm-confirm-text">Delete {selectedIds.size} meeting{selectedIds.size > 1 ? 's' : ''}?</span>
                  <button className="pm-toolbar-btn pm-toolbar-btn-danger" onClick={() => void handleDeleteSelected()}>
                    Yes, Delete
                  </button>
                  <button className="pm-toolbar-btn" onClick={() => setConfirmDeleteAll(false)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button className="pm-toolbar-btn pm-toolbar-btn-danger" onClick={() => setConfirmDeleteAll(true)}>
                  <Trash2 size={14} />
                  Delete Selected ({selectedIds.size})
                </button>
              )
            )}
          </div>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="empty-state">
          <div className="recorder-spinner" style={{ width: 28, height: 28 }} />
        </div>
      ) : filteredMeetings.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><FolderOpen size={48} /></div>
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
          {filteredMeetings.map((meeting) => {
            const isEditing = editingId === meeting.id;
            const isGenerating = generatingTitleId === meeting.id;
            const isDeleting = deletingIds.has(meeting.id);
            const isSelected = selectedIds.has(meeting.id);

            return (
              <div
                key={meeting.id}
                className={`meeting-card ${isSelected ? 'meeting-card-selected' : ''} ${isDeleting ? 'meeting-card-deleting' : ''}`}
                onClick={() => handleCardClick(meeting)}
              >
                {/* Checkbox */}
                <label className="mc-checkbox-wrap" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="mc-checkbox"
                    checked={isSelected}
                    onChange={() => handleToggleSelect(meeting.id)}
                  />
                </label>

                {/* Info */}
                <div className="meeting-card-info">
                  {isEditing ? (
                    <div className="mc-edit-row" onClick={(e) => e.stopPropagation()}>
                      <input
                        className="mc-edit-input"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleSaveEdit();
                          if (e.key === 'Escape') handleCancelEdit();
                        }}
                        autoFocus
                      />
                      <button className="mc-edit-save" onClick={() => void handleSaveEdit()} title="Save">
                        <Check size={14} />
                      </button>
                      <button className="mc-edit-cancel" onClick={handleCancelEdit} title="Cancel">
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <div className="mc-title-row">
                      <h4 className="meeting-card-title">{meeting.title}</h4>
                      <button className="mc-icon-btn" onClick={(e) => handleStartEdit(e, meeting)} title="Rename">
                        <Edit3 size={13} />
                      </button>
                      <button
                        className={`mc-icon-btn mc-icon-btn-sparkle ${isGenerating ? 'mc-icon-btn-spin' : ''}`}
                        onClick={(e) => void handleAutoTitle(e, meeting)}
                        title="AI generate title"
                        disabled={isGenerating}
                      >
                        <Sparkles size={13} />
                      </button>
                    </div>
                  )}
                  <div className="meeting-card-meta">
                    <span className="meeting-card-meta-item">
                      <Calendar size={13} /> {formatDate(meeting.date)}
                    </span>
                    <span className="meeting-card-meta-item">
                      <Clock size={13} /> {formatTime(meeting.date)}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="meeting-card-actions">
                  <button className="meeting-card-btn meeting-card-btn-view" onClick={(e) => { e.stopPropagation(); handleCardClick(meeting); }} title="View dashboard">
                    <Eye size={14} /> View
                  </button>
                  <button className="meeting-card-btn meeting-card-btn-folder" onClick={(e) => handleOpenFolder(e, meeting.video_file_path || meeting.transcript_path)} title="Open folder">
                    <FolderOpen size={14} />
                  </button>
                  <button className="meeting-card-btn meeting-card-btn-delete" onClick={(e) => void handleDeleteSingle(e, meeting.id)} title="Delete">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

async function loadMeetings(
  setMeetings: (value: MeetingRecord[]) => void,
  setLoading: (value: boolean) => void,
) {
  if (!window.electronAPI) { setLoading(false); return; }
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
  return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}
