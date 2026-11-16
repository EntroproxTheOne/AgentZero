import { useEffect, useMemo, useState } from 'react';
import {
  Briefcase,
  Building2,
  Calendar,
  Check,
  Clock,
  Edit3,
  Eye,
  FolderOpen,
  Loader2,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { MeetingRecord } from '../types/meeting';

interface PastMeetingsProps {
  onOpenMeeting?: (dbId: number, title: string) => void;
  onUpload?: () => void;
  /** Bumped by the shell whenever this tab is shown or a meeting is added. */
  refreshKey?: number;
}

export default function PastMeetings({ onOpenMeeting, onUpload, refreshKey = 0 }: PastMeetingsProps) {
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
  }, [refreshKey]);

  // Live processing updates (transcribing an upload, writing minutes, ...).
  useEffect(() => {
    if (!window.electronAPI?.onMeetingProcessing) return undefined;
    return window.electronAPI.onMeetingProcessing(({ dbId, state, note }) => {
      setMeetings((prev) => prev.map((m) => (m.id === dbId ? { ...m, processing_state: state, processing_note: note } : m)));
      if (state === 'done') void loadMeetings(setMeetings, () => {});
    });
  }, []);

  const filteredMeetings = useMemo(() => {
    const query = search.toLowerCase().trim();
    if (!query) return meetings;
    return meetings.filter((m) => [m.title, m.client_name, m.project_name, m.agenda]
      .some((value) => value?.toLowerCase().includes(query)));
  }, [meetings, search]);

  const handleRetry = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    void window.electronAPI?.retryMeetingProcessing({ dbId: id });
    setMeetings((prev) => prev.map((m) => (m.id === id ? { ...m, processing_state: 'analyzing', processing_note: 'Retrying' } : m)));
  };

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
      <header className="page-header page-header-row">
        <div>
          <h2 className="page-label">Library</h2>
          <h3 className="page-title">Meetings</h3>
        </div>
        {onUpload && (
          <button className="setting-save-btn" onClick={onUpload}>
            <Upload size={14} /> Upload a recording
          </button>
        )}
      </header>

      {/* Toolbar */}
      <div className="pm-toolbar">
        <div className="search-bar pm-search">
          <Search size={16} className="search-icon" />
          <input
            type="text"
            placeholder="Search by title, client, project or agenda"
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
              ? 'Record a meeting from the Dashboard, or upload an earlier call recording (audio or video).'
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
                    {meeting.client_name && (
                      <span className="meeting-chip"><Building2 size={12} /> {meeting.client_name}</span>
                    )}
                    {meeting.project_name && (
                      <span className="meeting-chip"><Briefcase size={12} /> {meeting.project_name}</span>
                    )}
                    {meeting.source === 'upload' && <span className="meeting-chip meeting-chip-muted"><Upload size={12} /> Uploaded</span>}
                    {meeting.processing_state && meeting.processing_state !== 'done' && meeting.processing_state !== 'recording' && (
                      meeting.processing_state === 'error' ? (
                        <span className="meeting-chip meeting-chip-error" title={meeting.processing_note ?? ''}>
                          Needs attention
                          <button className="mc-inline-btn" onClick={(e) => handleRetry(e, meeting.id)}><RotateCcw size={12} /> Retry</button>
                        </span>
                      ) : (
                        <span className="meeting-chip meeting-chip-busy" title={meeting.processing_note ?? ''}>
                          <Loader2 size={12} className="spin" /> {meeting.processing_note || 'Finishing up'}
                        </span>
                      )
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="meeting-card-actions">
                  <button className="meeting-card-btn meeting-card-btn-view" onClick={(e) => { e.stopPropagation(); handleCardClick(meeting); }} title="View dashboard">
                    <Eye size={14} /> View
                  </button>
                  <button className="meeting-card-btn meeting-card-btn-folder" onClick={(e) => handleOpenFolder(e, meeting.video_file_path || meeting.audio_file_path || meeting.transcript_path)} title="Open folder">
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
  return new Date(dateStr).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}
