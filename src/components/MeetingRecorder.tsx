import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Mic, MonitorSmartphone } from 'lucide-react';
import ConsentModal from './ConsentModal';
import { levelBus, type CaptureChoice, type CaptureControls, type CaptureState } from './capture';
import { EMPTY_CONTEXT, type MeetingContextValue } from './meetingContext';
import type { CurrentMeetingInfo, RecordingMode, RuntimeInfo } from '../types/meeting';

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
  const [mode, setMode] = useState<RecordingMode>('notes');
  // What the screen video shows: 'auto' = the meeting app's window if one is open, else the whole screen.
  const [videoSource, setStartVideoSource] = useState('auto');
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
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const sysAnalyserRef = useRef<AnalyserNode | null>(null);
  const levelTimerRef = useRef<number | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const drawTimerRef = useRef<number | null>(null);
  const levelFramesRef = useRef<number[]>([]);
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

  /**
   * Switch the screen video mid-meeting. The recording's video track is a canvas
   * that copies whichever source is current, so MediaRecorder never restarts and
   * the result stays one file.
   */
  const setVideoSource = async (sourceId: string) => {
    const video = videoElRef.current;
    if (!video) return;
    try {
      const chosen = sourceId === 'auto' ? null : sourceId;
      const stream = await getDisplayStream(chosen ? [] : detectedApps, chosen ?? 'auto', false);
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error('No video from that source');
      const previous = video.srcObject as MediaStream | null;
      video.srcObject = new MediaStream([track]);
      await video.play().catch(() => {});
      previous?.getVideoTracks().forEach((old) => { old.onended = null; old.stop(); });
      track.onended = () => pauseVideo();
      publishCapture({ videoSource: sourceId, problem: null });
    } catch (error) {
      publishCapture({ problem: `Could not switch the video: ${error instanceof Error ? error.message : String(error)}` });
    }
  };

  const pauseVideo = () => {
    const video = videoElRef.current;
    if (video) video.srcObject = null;
    publishCapture({ videoSource: 'paused', problem: 'The shared window closed, so the video is paused. Audio is still recording. Pick what to show.' });
  };

  const controls: CaptureControls = {
    detectedApps,
    setVideoSource: async (sourceId) => setVideoSource(sourceId === 'screen' ? await firstScreenId() : sourceId),
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
        const stream = await getDisplayStream(detectedApps, 'auto');
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
      // Settings holds the default mode; the start sheet picks per meeting.
      setMode(settings?.recordingMode === 'live' ? 'live' : 'notes');
      const apps = await window.electronAPI.detectMeetingApps().catch(() => [] as string[]);
      setDetectedApps(apps);
      // Online meeting (computer sound on) unless no meeting app is open; video from Settings.
      setCapture({ microphone: true, computerSound: true, screenVideo: Boolean(settings?.screenRecordingEnabled) });
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
        mode,
        online: capture.computerSound,
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
        mode: meetingInfo.mode,
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
      // The two sources are also measured separately (who spoke: mic vs call audio).
      const micAnalyser = mixCtx.createAnalyser();
      const sysAnalyser = mixCtx.createAnalyser();
      micAnalyser.fftSize = 2048;
      sysAnalyser.fftSize = 2048;
      micGain.connect(micAnalyser);
      sysGain.connect(sysAnalyser);
      micAnalyserRef.current = micAnalyser;
      sysAnalyserRef.current = sysAnalyser;
      captureRef.current = { microphone: false, computerSound: false, screenVideo: recordScreen, problem: null };

      if (capture.microphone) await enableMicrophone();

      // Computer sound and screen video both come from the display capture.
      const displayStream = meetingInfo.recordScreen || wantComputerSound
        ? await getDisplayStream(detectedApps, videoSource)
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
          startVideoCompositor(displayStream.getVideoTracks()[0]),
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

      // The shared window closed (e.g. the call ended): keep recording the whole screen.
      const displayVideoTrack = meetingInfo.recordScreen ? displayStream?.getVideoTracks()[0] : undefined;
      if (displayVideoTrack) {
        displayVideoTrack.onended = () => {
          window.electronAPI?.log('warn', 'Shared window closed; video paused until a new source is picked');
          pauseVideo();
        };
      }
      publishCapture({ videoSource: meetingInfo.recordScreen ? videoSource : undefined });
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
    // Levels and saved audio start together, so their timelines line up.
    startLevelMeter(meetingId);

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

  /** Copies the current video source into a fixed-size canvas; the canvas track is what gets recorded. */
  const startVideoCompositor = (track: MediaStreamTrack) => {
    const settings = track.getSettings();
    const canvas = document.createElement('canvas');
    // Fixed even size: H.264 / yuv420p needs even dimensions, and a later switch to a bigger source still fits.
    canvas.width = 1920;
    canvas.height = 1080;
    void settings;
    const ctx = canvas.getContext('2d');
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([track]);
    void video.play().catch(() => {});
    videoElRef.current = video;
    const draw = () => {
      if (!ctx || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
      const scale = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight) || 1;
      const w = video.videoWidth * scale;
      const h = video.videoHeight * scale;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    };
    drawTimerRef.current = window.setInterval(draw, 1000 / 15);
    return canvas.captureStream(15).getVideoTracks()[0];
  };

  /** Every 100 ms: mic and computer-sound loudness, sent to main in 1 s batches. */
  const startLevelMeter = (meetingId: number) => {
    const startEpoch = Date.now();
    const buffer = new Float32Array(2048);
    const rms = (analyser: AnalyserNode | null) => {
      if (!analyser) return 0;
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (let index = 0; index < buffer.length; index += 1) sum += buffer[index] * buffer[index];
      return Math.sqrt(sum / buffer.length);
    };
    levelFramesRef.current = [];
    levelTimerRef.current = window.setInterval(() => {
      const mic = rms(micAnalyserRef.current);
      const system = rms(sysAnalyserRef.current);
      levelBus.publish({ mic, system });
      levelFramesRef.current.push(Date.now() - startEpoch, mic, system);
      if (levelFramesRef.current.length >= 30) {
        window.electronAPI?.sendCaptureLevels(meetingId, startEpoch, levelFramesRef.current);
        levelFramesRef.current = [];
      }
    }, 100);
    levelStartEpochRef.current = startEpoch;
  };
  const levelStartEpochRef = useRef(0);

  const stopLevelMeter = (meetingId: number | undefined) => {
    if (levelTimerRef.current !== null) window.clearInterval(levelTimerRef.current);
    levelTimerRef.current = null;
    if (meetingId && levelFramesRef.current.length) {
      window.electronAPI?.sendCaptureLevels(meetingId, levelStartEpochRef.current, levelFramesRef.current);
    }
    levelFramesRef.current = [];
    levelBus.publish({ mic: 0, system: 0 });
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
    stopLevelMeter(meetingId);
    if (drawTimerRef.current !== null) window.clearInterval(drawTimerRef.current);
    drawTimerRef.current = null;
    (videoElRef.current?.srcObject as MediaStream | null)?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    videoElRef.current = null;

    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
    displayStreamRef.current?.getTracks().forEach((track) => track.stop());
    displayStreamRef.current = null;
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
    extraStreamsRef.current.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
    extraStreamsRef.current = [];
    sysSourceRef.current = null;
    micAnalyserRef.current = null;
    sysAnalyserRef.current = null;
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
          mode={mode}
          onModeChange={setMode}
          videoSource={videoSource}
          onVideoSourceChange={setStartVideoSource}
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
        Click to start. You choose Online or In person, and Notes or Live, before recording begins.
      </p>
    </div>
  );
}

async function firstScreenId() {
  const sources = await window.electronAPI.getDesktopSources().catch(() => []);
  return sources.find((source) => source.id.startsWith('screen:'))?.id ?? 'auto';
}

async function getDisplayStream(detectedApps: string[], chosenSource: string, withAudio = true) {
  // A source picked in the start sheet wins; 'auto' points at the meeting app's
  // window when one is open, else the whole screen. The request handler in main
  // adds system audio ('loopback') whatever the video source is.
  let sourceId: string | null = chosenSource !== 'auto' ? chosenSource : null;
  if (!sourceId && window.electronAPI && detectedApps.length > 0) {
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
  return navigator.mediaDevices.getDisplayMedia({ video: true, audio: withAudio });
}
