import { useState, useRef } from 'react';
import { Mic, MonitorSmartphone, AlertCircle } from 'lucide-react';
import ConsentModal from './ConsentModal';

/* ─── Props ─── */
interface MeetingRecorderProps {
  onRecordingStarted?: (stream: MediaStream, stopFn: () => Promise<void>, title: string) => void;
  onRecordingStopped?: () => void;
}

/* ─── Component ─── */
export default function MeetingRecorder({ onRecordingStarted, onRecordingStopped }: MeetingRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [detectedApps, setDetectedApps] = useState<string[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [noAppDetected, setNoAppDetected] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const meetingIdRef = useRef<number>(0);
  const dbIdRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const titleRef = useRef<string>('');
  const isStoppingRef = useRef(false);
  // Track every in-flight saveChunk IPC call so we can await them all before stopMeeting
  const pendingSavesRef = useRef<Promise<void>[]>([]);

  /* ─── Click Handler ─── */
  const handleRecordClick = async () => {
    if (isRecording) {
      await stopRecording();
      return;
    }

    setDetecting(true);
    setNoAppDetected(false);
    try {
      const apps = window.electronAPI
        ? await window.electronAPI.detectMeetingApps()
        : [];
      setDetectedApps(apps);
      if (apps.length > 0) {
        titleRef.current = `${apps[0]} Meeting`;
        setNoAppDetected(false);
      } else {
        titleRef.current = 'Untitled Meeting';
        setNoAppDetected(true);
      }
    } catch {
      setDetectedApps([]);
      titleRef.current = 'Untitled Meeting';
      setNoAppDetected(true);
    }
    setDetecting(false);
    setShowConsent(true);
  };

  const handleConsentAccept = async () => {
    setShowConsent(false);
    await startRecording();
  };

  const handleConsentCancel = () => {
    setShowConsent(false);
  };

  /* ─── Start Recording ─── */
  const startRecording = async () => {
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.startMeeting({ title: titleRef.current });
        meetingIdRef.current = result.meetingId;
        dbIdRef.current = result.dbId;
      } else {
        meetingIdRef.current = Date.now();
      }
      startTimeRef.current = Date.now();

      let displayStream: MediaStream;

      if (window.electronAPI && detectedApps.length > 0) {
        const sources = await window.electronAPI.getDesktopSources();

        const matchingSource = sources.find((s: any) => {
          const srcName = (s.name || '').toLowerCase();
          return detectedApps.some((app) => {
            const appLower = app.toLowerCase();
            if (srcName.includes(appLower)) return true;
            if (appLower.includes('zoom') && srcName.includes('zoom')) return true;
            if (appLower.includes('teams') && srcName.includes('teams')) return true;
            if (appLower.includes('webex') && srcName.includes('webex')) return true;
            if (appLower.includes('google meet') && srcName.includes('meet')) return true;
            if (appLower.includes('skype') && srcName.includes('skype')) return true;
            if (appLower.includes('discord') && srcName.includes('discord')) return true;
            if (appLower.includes('slack') && srcName.includes('slack')) return true;
            if (appLower.includes('bluejeans') && srcName.includes('bluejeans')) return true;
            if (appLower.includes('gotomeeting') && srcName.includes('gotomeeting')) return true;
            return false;
          });
        });

        if (matchingSource) {
          displayStream = await (navigator.mediaDevices as any).getUserMedia({
            audio: {
              mandatory: { chromeMediaSource: 'desktop' },
            },
            video: {
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: matchingSource.id,
              },
            },
          });
        } else {
          displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true,
          });
        }
      } else {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
      }

      // Capture microphone
      const voiceStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      const tracks = [
        ...displayStream.getVideoTracks(),
        ...displayStream.getAudioTracks(),
        ...voiceStream.getAudioTracks(),
      ];
      const combinedStream = new MediaStream(tracks);

      const mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType: 'video/webm; codecs=vp9',
      });
      mediaRecorderRef.current = mediaRecorder;
      isStoppingRef.current = false;

      // Stream every chunk to disk immediately via IPC — no in-memory accumulation.
      // Each save promise is tracked so stopRecording can wait for ALL of them.
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0 && window.electronAPI) {
          const saveTask = (async () => {
            const buffer = await e.data.arrayBuffer();
            await window.electronAPI.saveChunk({
              meetingId: meetingIdRef.current,
              buffer: Array.from(new Uint8Array(buffer)),
            });
          })();
          pendingSavesRef.current.push(saveTask);
        }
      };

      // Emit a chunk every 1000ms for real-time disk streaming
      mediaRecorder.start(1000);
      setIsRecording(true);

      onRecordingStarted?.(combinedStream, stopRecording, titleRef.current);

      displayStream.getVideoTracks()[0].onended = () => {
        stopRecording();
      };
    } catch (err) {
      console.error('Error starting recording:', err);
    }
  };

  /* ─── Stop Recording ─── */
  const stopRecording = async () => {
    if (isStoppingRef.current) return;
    isStoppingRef.current = true;

    const recorder = mediaRecorderRef.current;
    if (!recorder) {
      isStoppingRef.current = false;
      return;
    }

    // Wait for recorder to fully stop (onstop always fires after final ondataavailable)
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      try {
        recorder.stop();
      } catch {
        resolve();
      }
    });

    // Await every in-flight saveChunk IPC call (including the final chunk).
    // This guarantees the last chunk is written to disk before we tell
    // the backend to run ffmpeg on the file.
    await Promise.all(pendingSavesRef.current);
    pendingSavesRef.current = [];

    // Stop all media tracks
    recorder.stream.getTracks().forEach((t) => t.stop());
    mediaRecorderRef.current = null;
    setIsRecording(false);

    onRecordingStopped?.();

    // Tell backend to finalize the file (ffmpeg metadata fix + rename)
    if (window.electronAPI) {
      try {
        const result = await window.electronAPI.stopMeeting({
          meetingId: meetingIdRef.current,
          dbId: dbIdRef.current,
          startTime: startTimeRef.current,
          title: titleRef.current,
        });
        console.log('Recording saved:', result.finalName);
      } catch (err) {
        console.error('Error finalizing recording:', err);
      }
    }

    isStoppingRef.current = false;
  };

  /* ─── Render ─── */
  return (
    <div className="recorder-container">
      {showConsent && (
        <ConsentModal
          detectedApps={detectedApps}
          onAccept={handleConsentAccept}
          onCancel={handleConsentCancel}
        />
      )}

      {!isRecording && !showConsent && detectedApps.length > 0 && (
        <div className="detected-banner">
          <MonitorSmartphone size={16} />
          <span>Detected: {detectedApps.join(', ')}</span>
        </div>
      )}

      {!isRecording && !showConsent && noAppDetected && (
        <div className="detected-banner detected-banner-warn">
          <AlertCircle size={16} />
          <span>No meeting app detected. You can still record your screen.</span>
        </div>
      )}

      <button
        onClick={handleRecordClick}
        disabled={detecting}
        className={`recorder-btn ${isRecording ? 'recorder-btn-stop' : 'recorder-btn-start'} ${detecting ? 'recorder-btn-detecting' : ''}`}
      >
        {detecting ? (
          <>
            <div className="recorder-spinner" />
            Scanning for meetings...
          </>
        ) : isRecording ? (
          <>
            <div className="recorder-pulse" />
            Stop Recording
          </>
        ) : (
          <>
            <Mic size={24} />
            Start Recording
          </>
        )}
      </button>
      <p className="recorder-hint">
        Click to start. AgentZero will detect running meeting apps, ask for consent, then record the meeting window with audio.
      </p>
    </div>
  );
}
