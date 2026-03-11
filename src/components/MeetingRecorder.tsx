import { useState, useRef } from 'react';
import { Mic, MonitorSmartphone, AlertCircle } from 'lucide-react';
import ConsentModal from './ConsentModal';

interface MeetingRecorderProps {
  onRecordingStarted?: (stream: MediaStream, stopFn: () => Promise<void>) => void;
  onRecordingStopped?: () => void;
}

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
        // Try to find the specific meeting app window
        const sources = await window.electronAPI.getDesktopSources();

        // Window title matching keywords per detected app
        const matchingSource = sources.find((s: any) => {
          const srcName = (s.name || '').toLowerCase();
          return detectedApps.some(app => {
            const appLower = app.toLowerCase();
            // Direct name match
            if (srcName.includes(appLower)) return true;
            // Specific keyword matches
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
          // Capture specific window
          displayStream = await (navigator.mediaDevices as any).getUserMedia({
            audio: {
              mandatory: {
                chromeMediaSource: 'desktop',
              },
            },
            video: {
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: matchingSource.id,
              },
            },
          });
        } else {
          // No matching window found — fall back to screen picker
          displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true,
          });
        }
      } else {
        // No apps detected — use screen picker
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

      mediaRecorder.ondataavailable = async (e) => {
        if (e.data.size > 0 && window.electronAPI) {
          const buffer = await e.data.arrayBuffer();
          await window.electronAPI.saveChunk({
            meetingId: meetingIdRef.current,
            buffer: Array.from(new Uint8Array(buffer)),
          });
        }
      };

      mediaRecorder.start(5000);
      setIsRecording(true);

      onRecordingStarted?.(combinedStream, stopRecording);

      displayStream.getVideoTracks()[0].onended = () => {
        stopRecording();
      };
    } catch (err) {
      console.error('Error starting recording:', err);
    }
  };

  const stopRecording = async () => {
    if (isStoppingRef.current) return;
    isStoppingRef.current = true;

    if (mediaRecorderRef.current) {
      try {
        mediaRecorderRef.current.stop();
      } catch { /* already stopped */ }
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
      mediaRecorderRef.current = null;
      setIsRecording(false);

      onRecordingStopped?.();

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
    }
    isStoppingRef.current = false;
  };

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
