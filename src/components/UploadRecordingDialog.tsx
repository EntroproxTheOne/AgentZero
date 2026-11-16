import { useEffect, useState } from 'react';
import { FileAudio, FileVideo, Upload, X } from 'lucide-react';
import ContextPicker from './ContextPicker';
import { EMPTY_CONTEXT, type MeetingContextValue } from './meetingContext';
import { useWorkspace } from '../hooks/useWorkspace';
import type { RecordingFileInfo } from '../types/meeting';

interface UploadRecordingDialogProps {
  onClose: () => void;
  onUploaded: (dbId: number, title: string) => void;
}

function formatDuration(seconds: number | null) {
  if (!seconds) return 'unknown length';
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min ${rest} s`;
}

/** Add an earlier call or meeting recording (audio only, or video with audio). */
export default function UploadRecordingDialog({ onClose, onUploaded }: UploadRecordingDialogProps) {
  const { clients, projects } = useWorkspace();
  const [file, setFile] = useState<RecordingFileInfo | null>(null);
  const [title, setTitle] = useState('');
  const [context, setContext] = useState<MeetingContextValue>(EMPTY_CONTEXT);
  const [diarize, setDiarize] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void window.electronAPI?.getAppSettings().then((settings) => setDiarize(settings.diarizationEnabled)).catch(() => {});
  }, []);

  const pickFile = async () => {
    setError('');
    const picked = await window.electronAPI.pickRecordingFile();
    if (!picked) return;
    if (!picked.hasAudio) {
      setError('That file has no audio track.');
      return;
    }
    setFile(picked);
    if (!title) setTitle(picked.fileName.replace(/\.[^.]+$/, ''));
  };

  const minutes = file?.durationSeconds ? file.durationSeconds / 60 : 0;
  const estimate = minutes * (diarize ? 0.59 : 0.49);

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError('');
    const result = await window.electronAPI.uploadRecording({
      filePath: file.filePath,
      title,
      clientId: context.clientId,
      projectId: context.projectId,
      agenda: context.agenda,
      diarize,
    });
    setBusy(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    onUploaded(result.value.dbId, result.value.title);
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="upload-title">
      <div className="modal-card modal-card-wide">
        <div className="modal-head">
          <div className="modal-icon-wrap modal-icon-small"><Upload size={20} /></div>
          <div>
            <h3 className="modal-title" id="upload-title">Upload a recording</h3>
            <p className="modal-subtitle">Audio (MP3, M4A, WAV…) or video (MP4, MOV, WEBM…), up to 2 hours.</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <button className={`upload-drop ${file ? 'upload-drop-filled' : ''}`} onClick={() => void pickFile()} disabled={busy}>
          {file ? (
            <>
              {file.hasVideo ? <FileVideo size={22} /> : <FileAudio size={22} />}
              <span className="upload-file-name">{file.fileName}</span>
              <span className="upload-file-meta">{file.hasVideo ? 'Video with audio' : 'Audio only'} · {formatDuration(file.durationSeconds)} · click to change</span>
            </>
          ) : (
            <>
              <Upload size={22} />
              <span className="upload-file-name">Choose a file</span>
              <span className="upload-file-meta">The original stays with the meeting; video remains playable.</span>
            </>
          )}
        </button>

        <label className="context-field">
          <span>Title</span>
          <input className="setting-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Leave blank to name it from the conversation" />
        </label>

        <ContextPicker value={context} onChange={setContext} clients={clients} projects={projects} compact />

        <label className="upload-toggle">
          <input type="checkbox" checked={diarize} onChange={(e) => setDiarize(e.target.checked)} />
          <span>
            <strong>Identify speakers</strong> (Speaker 1, Speaker 2…)
            <em>Adds ₹0.10 per minute of audio (₹0.59 instead of ₹0.49)</em>
          </span>
        </label>

        {error && <p className="settings-error-text" role="alert">{error}</p>}

        <div className="modal-actions">
          <span className="upload-estimate">{file?.durationSeconds ? `Transcription ≈ ₹${estimate.toFixed(estimate < 10 ? 2 : 0)} + AI analysis` : ''}</span>
          <button className="modal-btn modal-btn-cancel" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="modal-btn modal-btn-accept" onClick={() => void submit()} disabled={!file || busy}>
            {busy ? 'Preparing…' : 'Upload and analyse'}
          </button>
        </div>
      </div>
    </div>
  );
}
