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

  // ── Video/audio archival pipeline ──────────────────────────────────────────
  const mediaRecorderRef   = useRef<MediaRecorder | null>(null);
  const pendingSavesRef    = useRef<Promise<void>[]>([]);

  // ── Meeting metadata ────────────────────────────────────────────────────────
  const meetingIdRef  = useRef<number>(0);
  const dbIdRef       = useRef<number>(0);
  const startTimeRef  = useRef<number>(0);
  const titleRef      = useRef<string>('');
  const isStoppingRef = useRef(false);

  // ── Live transcription pipeline (PCM via AudioWorklet) ──────────────────────
  const audioCtxRef     = useRef<AudioContext | null>(null);
  const workletNodeRef  = useRef<AudioWorkletNode | null>(null);

  /* ─── Click Handler ─── */
  const handleRecordClick = async () => {
    if (isRecording) { await stopRecording(); return; }

    setDetecting(true);
    setNoAppDetected(false);
    try {
      const apps = window.electronAPI ? await window.electronAPI.detectMeetingApps() : [];
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
    window.electronAPI?.log('info', 'Consent accepted, starting recording...');
    setShowConsent(false); 
    await startRecording(); 
  };
  const handleConsentCancel = () => {
    window.electronAPI?.log('info', 'Consent cancelled');
    setShowConsent(false);
  };

  /* ─── Start Recording ─── */
  const startRecording = async () => {
    try {
      // 1. Register meeting in backend
      if (window.electronAPI) {
        const result = await window.electronAPI.startMeeting({ title: titleRef.current });
        meetingIdRef.current = result.meetingId;
        dbIdRef.current      = result.dbId;
      } else {
        meetingIdRef.current = Date.now();
      }
      startTimeRef.current = Date.now();

      // 2. Acquire display stream (meeting audio + video)
      let displayStream: MediaStream;
      if (window.electronAPI && detectedApps.length > 0) {
        const sources = await window.electronAPI.getDesktopSources();
        const matchingSource = sources.find((s: any) => {
          const srcName = (s.name || '').toLowerCase();
          return detectedApps.some((app) => {
            const a = app.toLowerCase();
            return srcName.includes(a)
              || (a.includes('zoom') && srcName.includes('zoom'))
              || (a.includes('teams') && srcName.includes('teams'))
              || (a.includes('webex') && srcName.includes('webex'))
              || (a.includes('google meet') && srcName.includes('meet'))
              || (a.includes('skype') && srcName.includes('skype'))
              || (a.includes('discord') && srcName.includes('discord'))
              || (a.includes('slack') && srcName.includes('slack'));
          });
        });

        displayStream = matchingSource
          ? await (navigator.mediaDevices as any).getUserMedia({
              audio: { mandatory: { chromeMediaSource: 'desktop' } },
              video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: matchingSource.id } },
            })
          : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      } else {
        displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      }

      // 3. Acquire microphone stream
      const voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

      // ── WebM archival pipeline (unchanged) ──────────────────────────────────
      const combinedStream = new MediaStream([
        ...displayStream.getVideoTracks(),
        ...displayStream.getAudioTracks(),
        ...voiceStream.getAudioTracks(),
      ]);
      const mediaRecorder = new MediaRecorder(combinedStream, { mimeType: 'video/webm; codecs=vp9' });
      mediaRecorderRef.current = mediaRecorder;
      isStoppingRef.current = false;

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
      mediaRecorder.start(1000);

      // ── Live transcription — parallel PCM pipeline via AudioWorklet ─────────
      await startPCMPipeline(voiceStream, displayStream, meetingIdRef.current);

      setIsRecording(true);
      onRecordingStarted?.(combinedStream, stopRecording, titleRef.current);

      displayStream.getVideoTracks()[0].onended = () => {
        window.electronAPI?.log('warn', 'Display stream track ended naturally');
        stopRecording();
      };

    } catch (err: any) {
      window.electronAPI?.log('error', 'Error in startRecording:', err.message || err);
      console.error('Error starting recording:', err);
    }
  };

  /**
   * Create an AudioContext at 16 kHz, load the PCM AudioWorklet,
   * connect mic (input 0) and meeting audio (input 1) to the worklet node,
   * and forward interleaved PCM ArrayBuffers to the main process zero-copy.
   */
  const startPCMPipeline = async (
    micStream: MediaStream,
    meetingStream: MediaStream,
    meetingId: number,
  ) => {
    if (!window.electronAPI) return;

    try {
      // AudioContext at native 16 kHz — avoids resampling in the worklet
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;

      window.electronAPI?.log('info', `AudioContext created. State: ${audioCtx.state}`);

      if (audioCtx.state === 'suspended') {
        window.electronAPI?.log('info', 'AudioContext is suspended, resuming...');
        await audioCtx.resume();
        window.electronAPI?.log('info', `AudioContext state after resume: ${audioCtx.state}`);
      }

      // Load the worklet module (public/pcm-processor.js served from Vite root)
      await audioCtx.audioWorklet.addModule('/pcm-processor.js');

      // One node with 2 inputs, 0 outputs
      const workletNode = new AudioWorkletNode(audioCtx, 'pcm-processor', {
        numberOfInputs: 2,
        numberOfOutputs: 0,
      });
      workletNodeRef.current = workletNode;

      // Connect mic audio → worklet input 0
      const micSource = audioCtx.createMediaStreamSource(micStream);
      micSource.connect(workletNode, 0, 0);

      // Connect meeting audio → worklet input 1 (only if audio tracks exist)
      const meetingAudioTracks = meetingStream.getAudioTracks();
      if (meetingAudioTracks.length > 0) {
        const meetingSource = audioCtx.createMediaStreamSource(meetingStream);
        meetingSource.connect(workletNode, 0, 1);
      }

      // Open the Deepgram WebSocket on the main process side
      await window.electronAPI.startTranscription({ meetingId });

      // Forward each ~250ms PCM batch to main (zero-copy ArrayBuffer transfer)
      let firstChunkSent = false;
      workletNode.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        if (!firstChunkSent) {
          window.electronAPI?.log('info', `First PCM chunk received from worklet. Size: ${e.data.byteLength}`);
          firstChunkSent = true;
        }
        if (e.data instanceof ArrayBuffer && e.data.byteLength > 0) {
          window.electronAPI?.sendAudioChunk(meetingId, e.data);
        }
      };

      window.electronAPI?.log('info', 'PCM pipeline started successfully');

    } catch (err: any) {
      window.electronAPI?.log('error', '[PCMPipeline] Error:', err.message || err);
      console.error('[PCMPipeline] Error:', err);
    }
  };

  /* ─── Stop Recording ─── */
  const stopRecording = async () => {
    const stack = new Error().stack;
    window.electronAPI?.log('info', `stopRecording called. isStopping: ${isStoppingRef.current}. Stack: ${stack?.substring(0, 300)}`);
    if (isStoppingRef.current) return;
    isStoppingRef.current = true;

    const recorder = mediaRecorderRef.current;
    if (!recorder) { 
      window.electronAPI?.log('warn', 'stopRecording called but mediaRecorderRef is null');
      isStoppingRef.current = false; 
      return; 
    }

    // Stop the WebM recorder and wait for its final chunk
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      try { recorder.stop(); } catch { resolve(); }
    });

    // Ensure all in-flight saveChunk IPC calls have completed
    await Promise.all(pendingSavesRef.current);
    pendingSavesRef.current = [];

    // Stop all media tracks
    recorder.stream.getTracks().forEach((t) => t.stop());
    mediaRecorderRef.current = null;

    // Stop the PCM pipeline
    workletNodeRef.current?.port.close();
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;
    await audioCtxRef.current?.close();
    audioCtxRef.current = null;

    setIsRecording(false);
    onRecordingStopped?.();

    if (window.electronAPI) {
      try {
        // 1. Finalize video file first (ffmpeg remux → seekable webm)
        // This gives us the final formatted filename: YYYY-MM-DD-HH-MM-SS-DURATION-TITLE.webm
        const { finalName } = await window.electronAPI.stopMeeting({
          meetingId: meetingIdRef.current,
          dbId: dbIdRef.current,
          startTime: startTimeRef.current,
          title: titleRef.current,
        });
        console.log('Recording saved:', finalName);

        // 2. Finalize transcript with the matching name (replacing .webm with .json)
        const transcriptName = finalName.replace(/\.webm$/, '.json');
        await window.electronAPI.stopTranscription({
          meetingId: meetingIdRef.current,
          dbId: dbIdRef.current,
          finalName: transcriptName,
        });
        console.log('Transcript saved alongside video.');
      } catch (err) {
        console.error('Error during recording finalization:', err);
      }
    }


    isStoppingRef.current = false;
  };

  /* ─── Render ─── */
  return (
    <div className="recorder-container">
      {showConsent && (
        <ConsentModal detectedApps={detectedApps} onAccept={handleConsentAccept} onCancel={handleConsentCancel} />
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
          <><div className="recorder-spinner" />Scanning for meetings...</>
        ) : isRecording ? (
          <><div className="recorder-pulse" />Stop Recording</>
        ) : (
          <><Mic size={24} />Start Recording</>
        )}
      </button>
      <p className="recorder-hint">
        Click to start. AgentZero will detect running meeting apps, ask for consent, then record the meeting window with audio.
      </p>
    </div>
  );
}
