import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Mic, MonitorSmartphone } from 'lucide-react';
import ConsentModal from './ConsentModal';
import type { CaptureChoice, CaptureControls, CaptureState } from './capture';
import { EMPTY_CONTEXT, type MeetingContextValue } from './meetingContext';
import type { CurrentMeetingInfo, RuntimeInfo } from '../types/meeting';

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
    controls: CaptureControls,
  ) => void;
  /** Live view of what is being captured (changes when sources are switched). */
  onCaptureChange?: (state: CaptureState) => void;
  onRecordingStopped?: (meetingInfo: CurrentMeetingInfo) => void;
  /** The meeting was too short or silent and was not saved. */
  onRecordingDiscarded?: (reason: string) => void;
}

export default function MeetingRecorder({
  onRecordingStarted,
  onRecordingStopped,
  onRecordingDiscarded,
  onCaptureChange,
}: MeetingRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [detectedApps, setDetectedApps] = useState<string[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [noAppDetected, setNoAppDetected] = useState(false);
  const [capture, setCapture] = useState<CaptureChoice>({ microphone: true, computerSound: false, screenVideo: false });
  const [meetingContext, setMeetingContext] = useState<MeetingContextValue>(EMPTY_CONTEXT);
  const [identifySpeakers, setIdentifySpeakers] = useState(false);
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null);
  const [recorderError, setRecorderError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const meetingInfoRef = useRef<CurrentMeetingInfo | null>(null);
  const titleRef = useRef('Untitled Meeting');
  const isStoppingRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mixCtxRef = useRef<AudioContext | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micGainRef = useRef<GainNode | null>(null);
  const sysGainRef = useRef<GainNode | null>(null);
  const sysSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const captureRef = useRef<CaptureState>({ microphone: false, computerSound: false, screenVideo: false, problem: null });
  const onCaptureChangeRef = useRef(onCaptureChange);
  onCaptureChangeRef.current = onCaptureChange;

  const publishCapture = (patch: Partial<CaptureState>) => {
    captureRef.current = { ...captureRef.current, ...patch };
    onCaptureChangeRef.current?.(captureRef.current);
  };

  const computerSoundProblem = () => (runtimeInfo?.isMac
    ? 'Computer sound is not coming through. Allow AgentZero under System Settings → Privacy & Security → Screen & System Audio Recording, then restart the app.'
    : 'Computer sound is not coming through.');

  const enableMicrophone = async () => {
    const ctx = mixCtxRef.current;
    const gain = micGainRef.current;
    if (!ctx || !gain) return;
    if (!micStreamRef.current) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        micStreamRef.current = stream;
        ctx.createMediaStreamSource(stream).connect(gain);
      } catch (error) {
        publishCapture({ microphone: false, problem: `Microphone unavailable: ${error instanceof Error ? error.message : String(error)}` });
        return;
      }
    }
    gain.gain.value = 1;
    publishCapture({ microphone: true, problem: null });
  };

  const attachComputerSound = (stream: MediaStream) => {
    const ctx = mixCtxRef.current;
    const gain = sysGainRef.current;
    const track = stream.getAudioTracks()[0];
    if (!ctx || !gain || !track || track.readyState === 'ended') {
      window.electronAPI?.log('warn', 'No system audio track in the display capture');
      publishCapture({ computerSound: false, problem: computerSoundProblem() });
      return false;
    }
    sysSourceRef.current?.disconnect();
    sysSourceRef.current = ctx.createMediaStreamSource(new MediaStream([track]));
    sysSourceRef.current.connect(gain);
    gain.gain.value = 1;
    publishCapture({ computerSound: true, problem: null });
    return true;
  };

  const controls: CaptureControls = {
    setMicrophone: async (on) => {
      if (on) {
        await enableMicrophone();
        return;
      }
      if (micGainRef.current) micGainRef.current.gain.value = 0;
      publishCapture({ microphone: false });
    },
    setComputerSound: async (on) => {
      if (!on) {
        if (sysGainRef.current) sysGainRef.current.gain.value = 0;
        publishCapture({ computerSound: false });
        return;
      }
      if (sysSourceRef.current) {
        if (sysGainRef.current) sysGainRef.current.gain.value = 1;
        publishCapture({ computerSound: true, problem: null });
        return;
      }
      // Not captured yet: start a sound-only display capture now.
      try {
        const stream = await getDisplayStream(detectedApps);
        if (!captureRef.current.screenVideo) stream.getVideoTracks().forEach((track) => track.stop());
        extraStreamsRef.current.push(stream);
        attachComputerSound(stream);
      } catch (error) {
        publishCapture({ computerSound: false, problem: `Computer sound unavailable: ${error instanceof Error ? error.message : String(error)}` });
      }
    },
  };
  const extraStreamsRef = useRef<MediaStream[]>([]);
  const transcriptionStoppedRef = useRef(false);
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
      // Settings toggle is only the default; the consent dialog picks per meeting.
      setIdentifySpeakers(Boolean(settings?.diarizationEnabled));
      const apps = await window.electronAPI.detectMeetingApps().catch(() => [] as string[]);
      setDetectedApps(apps);
      // Defaults: call sound when a meeting app is open; video from Settings.
      setCapture({ microphone: true, computerSound: apps.length > 0, screenVideo: Boolean(settings?.screenRecordingEnabled) });
      titleRef.current = apps.length > 0 ? `${apps[0]} Meeting` : 'Untitled Meeting';
    } catch {
      setDetectedApps([]);
      titleRef.current = 'Untitled Meeting';
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

    const recordScreen = capture.screenVideo;
    const wantComputerSound = capture.computerSound;
    setNoAppDetected(recordScreen && detectedApps.length === 0);

    try {
      const meetingInfo = await window.electronAPI.startMeeting({
        title: titleRef.current,
        recordScreen,
        clientId: meetingContext.clientId,
        projectId: meetingContext.projectId,
        agenda: meetingContext.agenda,
        diarize: identifySpeakers,
      });
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

      // Every source goes through one mixer, with a switch (gain) per source, so
      // the mic and computer sound can be turned on or off during the meeting.
      const mixCtx = new AudioContext();
      mixCtxRef.current = mixCtx;
      if (mixCtx.state === 'suspended') await mixCtx.resume();
      const destination = mixCtx.createMediaStreamDestination();
      // A silent constant keeps the mixed track alive even when both sources are off.
      const keepAlive = mixCtx.createConstantSource();
      keepAlive.offset.value = 0;
      keepAlive.connect(destination);
      keepAlive.start();
      const micGain = mixCtx.createGain();
      const sysGain = mixCtx.createGain();
      micGain.connect(destination);
      sysGain.connect(destination);
      micGainRef.current = micGain;
      sysGainRef.current = sysGain;
      captureRef.current = { microphone: false, computerSound: false, screenVideo: recordScreen, problem: null };

      if (capture.microphone) await enableMicrophone();

      // Computer sound and screen video both come from the display capture.
      const displayStream = meetingInfo.recordScreen || wantComputerSound
        ? await getDisplayStream(detectedApps)
        : null;
      displayStreamRef.current = displayStream;
      if (displayStream && !meetingInfo.recordScreen) {
        displayStream.getVideoTracks().forEach((track) => track.stop());
      }
      if (displayStream && wantComputerSound) {
        attachComputerSound(displayStream);
      } else {
        displayStream?.getAudioTracks().forEach((track) => track.stop());
      }

      const meetingAudio = destination.stream;
      const recordingStream = displayStream && meetingInfo.recordScreen
        ? new MediaStream([
          ...displayStream.getVideoTracks(),
          ...meetingAudio.getAudioTracks(),
        ])
        : meetingAudio;
      recordingStreamRef.current = recordingStream;
      mediaRecorderRef.current = null;
      isStoppingRef.current = false;

      if (displayStream && meetingInfo.recordScreen) {
        // H.264 + AAC MP4 plays in QuickTime and Finder on the Mac; WebM is the fallback
        // and is converted to MP4 when the meeting stops.
        const mimeType = [
          'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
          'video/mp4',
          'video/webm;codecs=vp9,opus',
        ].find((type) => MediaRecorder.isTypeSupported(type));
        const mediaRecorder = new MediaRecorder(recordingStream, mimeType ? { mimeType } : undefined);

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

      await startPcmPipeline(meetingAudio, meetingInfoRef.current.meetingId);

      setIsRecording(true);
      onRecordingStarted?.(recordingStream, stopRecording, titleRef.current, meetingInfoRef.current, controls);
      publishCapture({});

      const displayVideoTrack = meetingInfo.recordScreen ? displayStream?.getVideoTracks()[0] : undefined;
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
      // Undo everything the failed start created, here and in the main process.
      const failedMeeting = meetingInfoRef.current;
      await releaseCapture();
      if (failedMeeting) {
        await window.electronAPI.cancelMeeting({ meetingId: failedMeeting.meetingId, dbId: failedMeeting.dbId }).catch(() => {});
      }
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

    const workletModuleUrl = new URL('pcm-processor.js', window.location.href).toString();
    window.electronAPI.log('info', `Loading PCM worklet from ${workletModuleUrl}`);

    try {
      await audioCtx.audioWorklet.addModule(workletModuleUrl);
    } catch (caughtError) {
      const reason = caughtError instanceof Error ? caughtError.message : String(caughtError);
      throw new Error(`Unable to load PCM audio worklet from ${workletModuleUrl}: ${reason}`);
    }

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

  /** Stop and release every capture resource. Safe to call repeatedly. */
  const releaseCapture = async () => {
    const recorder = mediaRecorderRef.current;
    const meetingId = meetingInfoRef.current?.meetingId;
    if (recorder) {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        try {
          if (recorder.state === 'inactive') resolve();
          else recorder.stop();
        } catch {
          resolve();
        }
      });
      await Promise.allSettled(Array.from(pendingVideoChunkPromisesRef.current));
      if (meetingId) {
        await window.electronAPI.flushMeetingWrites({ meetingId }).catch(() => {});
      }
      mediaRecorderRef.current = null;
    }
    await flushPcmPipeline().catch(() => {});

    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
    displayStreamRef.current?.getTracks().forEach((track) => track.stop());
    displayStreamRef.current = null;
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
    extraStreamsRef.current.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
    extraStreamsRef.current = [];
    sysSourceRef.current = null;
    micGainRef.current = null;
    sysGainRef.current = null;

    workletNodeRef.current?.disconnect();
    workletNodeRef.current?.port.close();
    workletNodeRef.current = null;
    await audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    await mixCtxRef.current?.close().catch(() => {});
    mixCtxRef.current = null;
  };

  const stopRecording = async () => {
    if (!window.electronAPI || isStoppingRef.current) return;
    const meetingInfo = meetingInfoRef.current;
    if (!meetingInfo) return;
    isStoppingRef.current = true;

    // Each step runs once; if a later step fails, pressing Stop again resumes
    // from there. The caller shows the error.
    try {
      await releaseCapture();

      if (!transcriptionStoppedRef.current) {
        await window.electronAPI.stopTranscription({
          meetingId: meetingInfo.meetingId,
          dbId: meetingInfo.dbId,
        });
        transcriptionStoppedRef.current = true;
      }

      const stoppedMeeting = await window.electronAPI.stopMeeting({
        meetingId: meetingInfo.meetingId,
        dbId: meetingInfo.dbId,
        startTime: meetingInfo.startTime,
        title: meetingInfo.title,
      });

      if (stoppedMeeting?.discarded) {
        meetingInfoRef.current = null;
        setIsRecording(false);
        onRecordingDiscarded?.(stoppedMeeting.discardReason);
      } else if (stoppedMeeting) {
        meetingInfoRef.current = stoppedMeeting;
        setIsRecording(false);
        onRecordingStopped?.(stoppedMeeting);
      }

      transcriptionStoppedRef.current = false;
      firstPcmChunkLoggedRef.current = false;
      firstVideoChunkLoggedRef.current = false;
      pendingVideoChunkPromisesRef.current.clear();
    } finally {
      isStoppingRef.current = false;
    }
  };

  return (
    <div className="recorder-container">
      {showConsent && (
        <ConsentModal
          detectedApps={detectedApps}
          capture={capture}
          onCaptureChange={setCapture}
          context={meetingContext}
          onContextChange={setMeetingContext}
          identifySpeakers={identifySpeakers}
          onIdentifySpeakersChange={setIdentifySpeakers}
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
        Click to start. You will choose In person (microphone only, no video) or Online (adds screen video) before recording begins.
      </p>
    </div>
  );
}

async function getDisplayStream(detectedApps: string[]) {
  // Point the main process at the meeting app's window when one is open; the
  // request handler there adds system audio ('loopback') to the capture.
  let sourceId: string | null = null;
  if (window.electronAPI && detectedApps.length > 0) {
    try {
      const sources = await window.electronAPI.getDesktopSources();
      const match = sources.find((source) => {
        const sourceName = source.name.toLowerCase();
        return detectedApps.some((appName) => {
          const candidate = appName.toLowerCase();
          return sourceName.includes(candidate)
            || ['zoom', 'teams', 'webex', 'skype', 'discord', 'slack'].some((key) => candidate.includes(key) && sourceName.includes(key))
            || (candidate.includes('google meet') && sourceName.includes('meet'));
        });
      });
      sourceId = match?.id ?? null;
    } catch {
      sourceId = null;
    }
  }
  await window.electronAPI?.setCaptureSource(sourceId);
  return navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
}
