import { useState, useRef } from 'react';
import { Mic, MonitorSmartphone, Square } from 'lucide-react';
import ConsentModal from './ConsentModal';

interface MeetingRecorderProps {
  onRecordingStarted?: (stream: MediaStream) => void;
  onRecordingStopped?: () => void;
  compact?: boolean;
}

export default function MeetingRecorder({ onRecordingStarted, onRecordingStopped, compact }: MeetingRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [detectedApps, setDetectedApps] = useState<string[]>([]);
  const [detecting, setDetecting] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const meetingIdRef = useRef<number>(0);
  const dbIdRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const titleRef = useRef<string>('');

  const handleRecordClick = async () => {
    if (isRecording) {
      await stopRecording();
      return;
    }

    setDetecting(true);
    try {
      const apps = window.electronAPI
        ? await window.electronAPI.detectMeetingApps()
        : [];
      setDetectedApps(apps);
      titleRef.current = apps.length > 0 ? `${apps[0]} Meeting` : 'Untitled Meeting';
    } catch {
      setDetectedApps([]);
      titleRef.current = 'Untitled Meeting';
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

      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

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

      // Pass stream up for Analysis Mode
      onRecordingStarted?.(combinedStream);

      displayStream.getVideoTracks()[0].onended = () => {
        stopRecording();
      };
    } catch (err) {
      console.error('Error starting recording:', err);
    }
  };

  const stopRecording = async () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
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
  };

  // Compact mode: just a stop button for use inside Analysis view
  if (compact) {
    return (
      <div className="recorder-compact">
        {showConsent && (
          <ConsentModal
            detectedApps={detectedApps}
            onAccept={handleConsentAccept}
            onCancel={handleConsentCancel}
          />
        )}
        <button
          onClick={handleRecordClick}
          className="recorder-btn recorder-btn-stop recorder-btn-compact"
        >
          <Square size={16} />
          Stop Recording
        </button>
      </div>
    );
  }

  return (
    <div className="recorder-container">
      {showConsent && (
        <ConsentModal
          detectedApps={detectedApps}
          onAccept={handleConsentAccept}
          onCancel={handleConsentCancel}
        />
      )}

      {!isRecording && detectedApps.length > 0 && !showConsent && (
        <div className="detected-banner">
          <MonitorSmartphone size={16} />
          <span>Detected: {detectedApps.join(', ')}</span>
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
        Click to start recording your meeting. AgentZero will detect running meeting apps, ask for consent, then record video and audio.
      </p>
    </div>
  );
}
