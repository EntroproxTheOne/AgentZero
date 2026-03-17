export {};

declare global {
  interface Window {
    electronAPI: {
      // ── Recording ───────────────────────────────────────────────────────────
      getDesktopSources: () => Promise<any[]>;
      saveChunk: (data: { meetingId: number; buffer: number[] }) => Promise<string>;
      detectMeetingApps: () => Promise<string[]>;
      startMeeting: (data: { title: string }) => Promise<{ meetingId: number; dbId: number; tempPath: string }>;
      stopMeeting: (data: { meetingId: number; dbId: number; startTime: number; title: string }) => Promise<{ finalPath: string; finalName: string }>;
      getMeetings: () => Promise<any[]>;
      openInExplorer: (filePath: string) => Promise<void>;
      // ── Auth ────────────────────────────────────────────────────────────────
      register: (data: { username: string; email: string; password: string }) => Promise<{ success: boolean; userId?: number; error?: string }>;
      login: (data: { email: string; password: string }) => Promise<{ success: boolean; user?: { id: number; username: string; email: string; listener_name: string }; error?: string }>;
      resetPassword: (data: { email: string; newPassword: string }) => Promise<{ success: boolean; error?: string }>;
      updateListenerName: (data: { userId: number; listenerName: string }) => Promise<{ success: boolean }>;
      // ── Window ──────────────────────────────────────────────────────────────
      windowMinimize: () => void;
      windowMaximize: () => void;
      windowClose: () => void;
      // ── Transcription ───────────────────────────────────────────────────────
      startTranscription: (data: { meetingId: number }) => Promise<void>;
      stopTranscription: (data: { meetingId: number; dbId: number; finalName?: string }) => Promise<void>;
      /** Zero-copy: ArrayBuffer is transferred to main process */
      sendAudioChunk: (meetingId: number, buffer: ArrayBuffer) => void;
      onTranscriptEntry: (callback: (entry: TranscriptEntry) => void) => void;
      offTranscriptEntry: () => void;
      log: (level: 'info' | 'warn' | 'error', ...args: any[]) => void;
    };
  }

  interface TranscriptEntry {
    /** 'you' = user mic (channel 0), 'meeting' = meeting audio (channel 1) */
    source: 'you' | 'meeting';
    /** Deepgram diarization speaker ID (only on meeting channel) */
    speakerId: number | null;
    transcript: string;
    timestamp: string;
    isFinal: boolean;
    interim: boolean;
  }
}
