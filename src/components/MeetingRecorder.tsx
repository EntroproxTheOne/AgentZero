import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Mic, MonitorSmartphone } from 'lucide-react';
import ConsentModal from './ConsentModal';
import type { CurrentMeetingInfo, RuntimeInfo } from '../types/meeting';

interface DesktopCaptureMediaTrackConstraints extends MediaTrackConstraints {
  mandatory?: {
    chromeMediaSource: 'desktop';
    chromeMediaSourceId?: string;
  };
}

interface DesktopCaptureMediaStreamConstraints {
  audio?: boolean | DesktopCaptureMediaTrackConstraints;
  video?: boolean | DesktopCaptureMediaTrackConstraints;
}

interface WorkletAudioChunkMessage {
  type: 'audio-chunk';
  buffer: ArrayBuffer;
}

interface WorkletFlushCompleteMessage {
  type: 'flush-complete';
}

type WorkletMessage = WorkletAudioChunkMessage | WorkletFlushCompleteMessage;

interface MeetingRecorderProps {
  onRecordingStarted?: (
    stream: MediaStream,
    stopFn: () => Promise<void>,
    title: string,
    meetingInfo: CurrentMeetingInfo,
  ) => void;
  onRecordingStopped?: (meetingInfo: CurrentMeetingInfo) => void;
}

export default function MeetingRecorder({
  onRecordingStarted,
  onRecordingStopped,
}: MeetingRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [detectedApps, setDetectedApps] = useState<string[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [noAppDetected, setNoAppDetected] = useState(false);
  const [screenRecordingEnabled, setScreenRecordingEnabled] = useState(false);
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null);
  const [recorderError, setRecorderError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const meetingInfoRef = useRef<CurrentMeetingInfo | null>(null);
  const titleRef = useRef('Untitled Meeting');
  const isStoppingRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const workletFlushResolverRef = useRef<(() => void) | null>(null);
  const firstPcmChunkLoggedRef = useRef(false);
  const firstVideoChunkLoggedRef = useRef(false);
  const pendingVideoChunkPromisesRef = useRef<Set<Promise<void>>>(new Set());

  useEffect(() => {
    if (!window.electronAPI) return undefined;

    let isMounted = true;
    window.electronAPI.getRuntimeInfo()
      .then((info) => {
        if (isMounted) {
          setRuntimeInfo(info);
        }
      })
      .catch(() => {
        // Runtime info is optional in the renderer.
      });

    window.electronAPI.onAccessState((info) => {
      if (isMounted) {
        setRuntimeInfo(info);
      }
    });

    return () => {
      isMounted = false;
      window.electronAPI?.offAccessState?.();
    };
  }, []);

  const handleRecordClick = async () => {
    if (isRecording) {
      await stopRecording();
      return;
    }

    setDetecting(true);
    setNoAppDetected(false);
    setRecorderError(null);

    try {
      const settings = await window.electronAPI?.getAppSettings();
      const shouldRecordScreen = Boolean(settings?.screenRecordingEnabled);
      setScreenRecordingEnabled(shouldRecordScreen);
      const apps = shouldRecordScreen ? await window.electronAPI.detectMeetingApps() : [];
      setDetectedApps(apps);
      titleRef.current = apps.length > 0 ? `${apps[0]} Meeting` : 'Untitled Meeting';
      setNoAppDetected(shouldRecordScreen && apps.length === 0);
    } catch {
      setDetectedApps([]);
      titleRef.current = 'Untitled Meeting';
      setNoAppDetected(screenRecordingEnabled);
    } finally {
      setDetecting(false);
      setShowConsent(true);
    }
  };

  const handleConsentAccept = async () => {
    window.electronAPI?.log('info', 'Consent accepted, starting recording...');
    setShowConsent(false);
    await startRecording();
  };

  const handleConsentCancel = () => {
    window.electronAPI?.log('info', 'Consent cancelled');
    setShowConsent(false);
  };

  const startRecording = async () => {
    if (!window.electronAPI) return;

    try {
      const meetingInfo = await window.electronAPI.startMeeting({ title: titleRef.current });
      meetingInfoRef.current = {
        meetingId: meetingInfo.meetingId,
        dbId: meetingInfo.dbId,
        title: titleRef.current,
        transcriptPath: meetingInfo.transcriptPath,
        artifactsPath: meetingInfo.artifactsPath,
        startTime: meetingInfo.startTime,
        recordScreen: meetingInfo.recordScreen,
        meetingFolder: meetingInfo.meetingFolder,
      };

      const voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const displayStream = meetingInfo.recordScreen
        ? await getDisplayStream(detectedApps, runtimeInfo)
        : null;

      const recordingStream = displayStream
        ? new MediaStream([
          ...displayStream.getVideoTracks(),
          ...voiceStream.getAudioTracks(),
        ])
        : voiceStream;
      recordingStreamRef.current = recordingStream;
      mediaRecorderRef.current = null;
      isStoppingRef.current = false;

      if (displayStream) {
        const mediaRecorder = new MediaRecorder(recordingStream, {
          mimeType: 'video/webm; codecs=vp9',
        });

        mediaRecorderRef.current = mediaRecorder;
        mediaRecorder.ondataavailable = async (event) => {
          if (event.data.size <= 0 || !meetingInfoRef.current) return;

          const chunkPromise = (async () => {
            const arrayBuffer = await event.data.arrayBuffer();
            if (arrayBuffer.byteLength === 0 || !meetingInfoRef.current) return;

            if (!firstVideoChunkLoggedRef.current) {
              firstVideoChunkLoggedRef.current = true;
              window.electronAPI?.log(
                'info',
                `First video chunk emitted by MediaRecorder for meeting ${meetingInfoRef.current.meetingId} (${arrayBuffer.byteLength} bytes)`,
              );
            }

            window.electronAPI.sendVideoChunk(meetingInfoRef.current.meetingId, arrayBuffer);
          })().catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            window.electronAPI?.log('error', 'Failed to process video chunk:', message);
          });

          pendingVideoChunkPromisesRef.current.add(chunkPromise);
          chunkPromise.finally(() => {
            pendingVideoChunkPromisesRef.current.delete(chunkPromise);
          });
        };

        mediaRecorder.start(1000);
      }

      await startPcmPipeline(voiceStream, meetingInfoRef.current.meetingId);

      setIsRecording(true);
      setScreenRecordingEnabled(meetingInfo.recordScreen);
      onRecordingStarted?.(recordingStream, stopRecording, titleRef.current, meetingInfoRef.current);

      const displayVideoTrack = displayStream?.getVideoTracks()[0];
      if (displayVideoTrack) {
        displayVideoTrack.onended = () => {
          window.electronAPI?.log('warn', 'Display stream track ended naturally');
          void stopRecording();
        };
      }
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : String(caughtError);
      window.electronAPI?.log('error', 'Error in startRecording:', message);
      console.error('Error starting recording:', caughtError);
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
      mediaRecorderRef.current = null;
      meetingInfoRef.current = null;
      setRecorderError(
        runtimeInfo?.isMac
          ? `${message}. On macOS, make sure Screen Recording and Microphone access are enabled for AgentZero, then try again.`
          : message,
      );
    }
  };

  const startPcmPipeline = async (
    micStream: MediaStream,
    meetingId: number,
  ) => {
    if (!window.electronAPI) return;

    const audioCtx = new AudioContext({ sampleRate: 16000 });
    audioCtxRef.current = audioCtx;

    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    await audioCtx.audioWorklet.addModule('/pcm-processor.js');

    const workletNode = new AudioWorkletNode(audioCtx, 'pcm-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
    });

    workletNodeRef.current = workletNode;

    const micSource = audioCtx.createMediaStreamSource(micStream);
    micSource.connect(workletNode, 0, 0);

    await window.electronAPI.startTranscription({ meetingId });

    workletNode.port.onmessage = (event: MessageEvent<WorkletMessage>) => {
      const data = event.data;
      if (!data) return;

      if (data.type === 'flush-complete') {
        workletFlushResolverRef.current?.();
        workletFlushResolverRef.current = null;
        return;
      }

      if (data.type === 'audio-chunk' && data.buffer.byteLength > 0) {
        if (!firstPcmChunkLoggedRef.current) {
          firstPcmChunkLoggedRef.current = true;
          window.electronAPI?.log('info', `First PCM chunk emitted by worklet for meeting ${meetingId}`);
        }
        window.electronAPI?.sendAudioChunk(meetingId, data.buffer);
      }
    };
  };

  const flushPcmPipeline = async () => {
    const workletNode = workletNodeRef.current;
    if (!workletNode) return;

    await new Promise<void>((resolve) => {
      workletFlushResolverRef.current = resolve;
      workletNode.port.postMessage({ type: 'flush' });
      window.setTimeout(() => {
        if (workletFlushResolverRef.current) {
          workletFlushResolverRef.current();
          workletFlushResolverRef.current = null;
        }
      }, 500);
    });
  };

  const stopRecording = async () => {
    if (!window.electronAPI || isStoppingRef.current) return;
    isStoppingRef.current = true;

    const recorder = mediaRecorderRef.current;
    const recordingStream = recordingStreamRef.current;
    const meetingInfo = meetingInfoRef.current;
    if (!meetingInfo || !recordingStream) {
      isStoppingRef.current = false;
      return;
    }

    if (recorder) {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        try {
          recorder.stop();
        } catch {
          resolve();
        }
      });
    }

    const pendingVideoChunks = Array.from(pendingVideoChunkPromisesRef.current);
    if (pendingVideoChunks.length > 0) {
      await Promise.allSettled(pendingVideoChunks);
    }

    if (recorder) {
      await window.electronAPI.flushMeetingWrites({ meetingId: meetingInfo.meetingId });
    }
    await flushPcmPipeline();

    recordingStream.getTracks().forEach((track) => track.stop());
    mediaRecorderRef.current = null;
    recordingStreamRef.current = null;

    workletNodeRef.current?.disconnect();
    workletNodeRef.current?.port.close();
    workletNodeRef.current = null;
    await audioCtxRef.current?.close();
    audioCtxRef.current = null;

    await window.electronAPI.stopTranscription({
      meetingId: meetingInfo.meetingId,
      dbId: meetingInfo.dbId,
    });

    const stoppedMeeting = await window.electronAPI.stopMeeting({
      meetingId: meetingInfo.meetingId,
      dbId: meetingInfo.dbId,
      startTime: meetingInfo.startTime,
      title: meetingInfo.title,
    });

    if (stoppedMeeting) {
      meetingInfoRef.current = stoppedMeeting;
      setIsRecording(false);
      onRecordingStopped?.(stoppedMeeting);
    }

    firstPcmChunkLoggedRef.current = false;
    firstVideoChunkLoggedRef.current = false;
    pendingVideoChunkPromisesRef.current.clear();
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

      {!isRecording && !showConsent && runtimeInfo?.isMac && (
        <div className="detected-banner detected-banner-warn">
          <AlertCircle size={16} />
          <span>
            macOS test mode: use the native picker, then allow Screen Recording and Microphone permissions if prompted.
          </span>
        </div>
      )}

      {recorderError && (
        <div className="detected-banner detected-banner-warn">
          <AlertCircle size={16} />
          <span>{recorderError}</span>
        </div>
      )}

      <button
        onClick={() => void handleRecordClick()}
        disabled={detecting}
        className={`recorder-btn ${isRecording ? 'recorder-btn-stop' : 'recorder-btn-start'} ${detecting ? 'recorder-btn-detecting' : ''}`}
      >
        {detecting ? (
          <><div className="recorder-spinner" />Scanning for meetings...</>
        ) : isRecording ? (
          <><div className="recorder-pulse" />Stop Recording</>
        ) : (
          <><Mic size={24} />Start Recording</>
        )}
      </button>

      <p className="recorder-hint">
        {!screenRecordingEnabled
          ? 'Click to start. AgentZero will capture your microphone and create a transcript without recording the screen or device audio.'
          : runtimeInfo?.isMac
          ? 'Click to start. AgentZero will ask for consent, then use the macOS picker to capture video while keeping transcription microphone-only.'
          : 'Click to start. AgentZero will detect running meeting apps, ask for consent, then record video while keeping transcription microphone-only.'}
      </p>
    </div>
  );
}

async function getDisplayStream(detectedApps: string[], runtimeInfo: RuntimeInfo | null) {
  if (!window.electronAPI || runtimeInfo?.isMac || detectedApps.length === 0) {
    return navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  }

  const sources = await window.electronAPI.getDesktopSources();
  const matchingSource = sources.find((source) => {
    const sourceName = source.name.toLowerCase();
    return detectedApps.some((appName) => {
      const candidate = appName.toLowerCase();
      return sourceName.includes(candidate)
        || (candidate.includes('zoom') && sourceName.includes('zoom'))
        || (candidate.includes('teams') && sourceName.includes('teams'))
        || (candidate.includes('webex') && sourceName.includes('webex'))
        || (candidate.includes('google meet') && sourceName.includes('meet'))
        || (candidate.includes('skype') && sourceName.includes('skype'))
        || (candidate.includes('discord') && sourceName.includes('discord'))
        || (candidate.includes('slack') && sourceName.includes('slack'));
    });
  });

  if (!matchingSource) {
    return navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  }

  const desktopMediaDevices = navigator.mediaDevices as MediaDevices & {
    getUserMedia: (constraints: DesktopCaptureMediaStreamConstraints) => Promise<MediaStream>;
  };

  return desktopMediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: matchingSource.id,
      },
    },
  });
}
