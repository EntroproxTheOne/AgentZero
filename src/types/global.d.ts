import type {
  CurrentMeetingInfo,
  ExportMeetingResponse,
  MeetingArtifactsResponse,
  MeetingRecord,
  QuickLookHistoryItem,
  QuickLookResponse,
  TranscriptEntry,
} from './meeting';

export {};

interface DesktopSource {
  id: string;
  name: string;
  thumbnail: string;
}

declare global {
  interface Window {
    electronAPI: {
      getDesktopSources: () => Promise<DesktopSource[]>;
      sendVideoChunk: (meetingId: number, buffer: ArrayBuffer) => void;
      flushMeetingWrites: (data: { meetingId: number }) => Promise<void>;
      detectMeetingApps: () => Promise<string[]>;
      startMeeting: (data: { title: string }) => Promise<CurrentMeetingInfo & { meetingFolder: string; nameBase: string }>;
      stopMeeting: (data: { meetingId: number; dbId: number; startTime: number; title: string }) => Promise<CurrentMeetingInfo | null>;
      getMeetings: () => Promise<MeetingRecord[]>;
      getMeetingArtifacts: (data: { dbId: number }) => Promise<MeetingArtifactsResponse | null>;
      exportMeetingMom: (data: { dbId: number; format: 'pdf' | 'markdown' }) => Promise<ExportMeetingResponse>;
      openInExplorer: (filePath: string) => Promise<void>;
      register: (data: { username: string; email: string; password: string }) => Promise<{ success: boolean; userId?: number; error?: string }>;
      login: (data: { email: string; password: string }) => Promise<{ success: boolean; user?: { id: number; username: string; email: string; listener_name: string }; error?: string }>;
      resetPassword: (data: { email: string; newPassword: string }) => Promise<{ success: boolean; error?: string }>;
      updateListenerName: (data: { userId: number; listenerName: string }) => Promise<{ success: boolean }>;
      windowMinimize: () => void;
      windowMaximize: () => void;
      windowClose: () => void;
      startTranscription: (data: { meetingId: number }) => Promise<void>;
      stopTranscription: (data: { meetingId: number; dbId: number }) => Promise<{ transcriptPath: string | null }>;
      sendAudioChunk: (meetingId: number, buffer: ArrayBuffer) => void;
      onTranscriptEntry: (callback: (entry: TranscriptEntry) => void) => void;
      offTranscriptEntry: () => void;
      onLiveInsights: (callback: (payload: { meetingId: number; payload: import('./meeting').LiveInsightsPayload }) => void) => void;
      offLiveInsights: () => void;
      onMeetingArtifactsUpdated: (callback: (payload: { meetingId: number; payload: import('./meeting').MeetingArtifacts | null }) => void) => void;
      offMeetingArtifactsUpdated: () => void;
      askQuickLook: (data: { meetingId: number; question: string; history: QuickLookHistoryItem[] }) => Promise<QuickLookResponse>;
      log: (level: 'info' | 'warn' | 'error', ...args: unknown[]) => void;
    };
  }
}
