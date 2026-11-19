import type {
  AccountResult,
  AskAllAnswer,
  ClientRecord,
  ContextDoc,
  ProcessingState,
  ProjectRecord,
  RecordingFileInfo,
  WorkspaceResult,
  AiConnectionTestResult,
  AppSettings,
  AppUser,
  MeetingCost,
  CredentialsStatus,
  MacPermissionStatus,
  CurrentMeetingInfo,
  ExportMeetingResponse,
  MeetingArtifactsResponse,
  MeetingRecord,
  QuickLookHistoryItem,
  QuickLookResponse,
  RuntimeInfo,
  TranscriptEntry,
  RecordingMode,
  MeetingTemplate,
  MeetingExtraction,
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
      getRuntimeInfo: () => Promise<RuntimeInfo>;
      getDesktopSources: () => Promise<DesktopSource[]>;
      setCaptureSource: (sourceId: string | null) => Promise<boolean>;
      sendVideoChunk: (meetingId: number, buffer: ArrayBuffer) => void;
      flushMeetingWrites: (data: { meetingId: number }) => Promise<void>;
      detectMeetingApps: () => Promise<string[]>;
      startMeeting: (data: { title: string; recordScreen?: boolean; clientId?: number | null; projectId?: number | null; agenda?: string; mode?: RecordingMode; online?: boolean }) => Promise<CurrentMeetingInfo & { meetingFolder: string; nameBase: string }>;
      stopMeeting: (data: { meetingId: number; dbId: number; startTime: number; title: string }) => Promise<(CurrentMeetingInfo & { discarded?: false }) | { discarded: true; discardReason: string } | null>;
      getMeetings: () => Promise<MeetingRecord[]>;
      getMeetingArtifacts: (data: { dbId: number }) => Promise<MeetingArtifactsResponse | null>;
      exportMeetingMom: (data: { dbId: number; format: 'pdf' | 'markdown' }) => Promise<ExportMeetingResponse>;
      renameMeeting: (data: { dbId: number; title: string }) => Promise<{ success: boolean }>;
      deleteMeetings: (data: { dbIds: number[] }) => Promise<{ success: boolean; deletedCount: number }>;
      autoTitleMeeting: (data: { dbId: number }) => Promise<{ title: string }>;
      openInExplorer: (filePath: string) => Promise<void>;
      login: (data: { email: string; password: string }) => Promise<AccountResult<{ user: AppUser }>>;
      logout: () => Promise<{ success: boolean }>;
      needsFirstRunSetup: () => Promise<boolean>;
      firstRunSetup: (data: { username?: string; email: string; password: string }) => Promise<AccountResult<{ user: AppUser }>>;
      listUsers: () => Promise<AccountResult<{ users: AppUser[] }>>;
      createUser: (data: { username?: string; email: string; password: string; isAdmin?: boolean }) => Promise<AccountResult<{ user: AppUser }>>;
      updateUser: (data: { userId: number; username?: string; email?: string; password?: string; currentPassword?: string; isAdmin?: boolean }) => Promise<AccountResult<{ user: AppUser }>>;
      deleteUser: (data: { userId: number }) => Promise<AccountResult<object>>;
      getMeetingCost: (data: { dbId: number }) => Promise<MeetingCost | null>;
      requestMicrophoneAccess: () => Promise<boolean>;
      listWorkspace: () => Promise<{ clients: ClientRecord[]; projects: ProjectRecord[] }>;
      saveClient: (data: { id?: number; name: string; notes?: string }) => Promise<WorkspaceResult<ClientRecord>>;
      deleteClient: (data: { id: number }) => Promise<WorkspaceResult<unknown>>;
      saveProject: (data: { id?: number; name: string; notes?: string; clientId?: number | null }) => Promise<WorkspaceResult<ProjectRecord>>;
      deleteProject: (data: { id: number }) => Promise<WorkspaceResult<unknown>>;
      listDocs: (data: { ownerType: 'client' | 'project'; ownerId: number }) => Promise<ContextDoc[]>;
      addDocFiles: (data: { ownerType: 'client' | 'project'; ownerId: number }) => Promise<WorkspaceResult<{ added: { fileName: string; chars: number; truncated: boolean }[]; failed: { fileName: string; error: string }[] }>>;
      addDocNote: (data: { ownerType: 'client' | 'project'; ownerId: number; title: string; text: string }) => Promise<WorkspaceResult<{ id: number }>>;
      deleteDoc: (data: { id: number }) => Promise<WorkspaceResult<unknown>>;
      pickRecordingFile: () => Promise<RecordingFileInfo | null>;
      uploadRecording: (data: { filePath: string; title?: string; clientId?: number | null; projectId?: number | null; agenda?: string }) => Promise<WorkspaceResult<{ dbId: number; title: string }>>;
      retryMeetingProcessing: (data: { dbId: number }) => Promise<{ success: boolean }>;
      updateMeetingContext: (data: { dbId: number; clientId?: number | null; projectId?: number | null; agenda?: string }) => Promise<{ success: boolean }>;
      askAllMeetings: (data: { question: string; clientId?: number | null; projectId?: number | null; history?: { role: 'user' | 'assistant'; text: string }[] }) => Promise<WorkspaceResult<AskAllAnswer>>;
      onMeetingProcessing: (callback: (payload: { dbId: number; state: ProcessingState; note: string | null }) => void) => () => void;
      openMacPrivacySettings: (pane: 'microphone' | 'screen') => Promise<boolean>;
      getMacPermissions: () => Promise<MacPermissionStatus>;
      onTranscriptionStatus: (callback: (status: { meetingId: number; state: 'live' | 'reconnecting' | 'lost'; detail: string | null }) => void) => () => void;
      cancelMeeting: (data: { meetingId: number; dbId: number }) => Promise<boolean>;
      requestMacPermission: (kind: 'microphone' | 'screen', options?: { promptOnly?: boolean }) => Promise<{ granted: boolean; openedSettings: boolean }>;
      relaunchApp: () => Promise<void>;
      updateListenerName: (data: { userId: number; listenerName: string }) => Promise<{ success: boolean }>;
      getAppSettings: () => Promise<AppSettings>;
      updateAppSettings: (data: { screenRecordingEnabled?: boolean; showCost?: boolean; onboardingDone?: boolean; webSearchEnabled?: boolean; recordingMode?: RecordingMode; autoInsightsMinutes?: number }) => Promise<AppSettings>;
      getCredentialsStatus: () => Promise<CredentialsStatus>;
      updateCredentials: (data: { gcpProjectId?: string; serviceAccountJson?: string; sarvamApiKey?: string; geminiApiKey?: string }) => Promise<CredentialsStatus>;
      testAiConnection: () => Promise<AiConnectionTestResult>;
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
      onMeetingTitleUpdated: (callback: (payload: { dbId: number; title: string }) => void) => void;
      offMeetingTitleUpdated: () => void;
      onAccessState: (callback: (payload: RuntimeInfo) => void) => void;
      offAccessState: () => void;
      askQuickLook: (data: { meetingId: number; question: string; history: QuickLookHistoryItem[]; webSearch?: boolean }) => Promise<QuickLookResponse>;
      sendCaptureLevels: (meetingId: number, startEpoch: number, frames: number[]) => void;
      goLive: (data: { meetingId: number; catchUp: boolean }) => Promise<{ ok: boolean }>;
      askMeeting: (data: { dbId: number; question: string; history: QuickLookHistoryItem[] }) => Promise<WorkspaceResult<{ answer: string; citations: number[] }>>;
      listTemplates: () => Promise<MeetingTemplate[]>;
      saveTemplate: (data: { id?: number; name: string; instructions: string }) => Promise<WorkspaceResult<MeetingTemplate[]>>;
      deleteTemplate: (data: { id: number }) => Promise<WorkspaceResult<MeetingTemplate[]>>;
      runTemplate: (data: { dbId: number; templateId: number }) => Promise<WorkspaceResult<{ text: string; templateName: string }>>;
      editMeetingItem: (data: { dbId: number; kind: 'decision' | 'task'; id: string; patch: Record<string, unknown> }) => Promise<WorkspaceResult<MeetingExtraction>>;
      renameSpeaker: (data: { dbId: number; from: string; to: string }) => Promise<WorkspaceResult<boolean>>;
      confirmOwner: (data: { dbId: number; speakerId: string; isOwner: boolean }) => Promise<WorkspaceResult<{ changed: boolean }>>;
      reassignLine: (data: { dbId: number; lineId: number; speakerLabel: string }) => Promise<WorkspaceResult<boolean>>;
      refreshMeetingRecord: (data: { dbId: number }) => Promise<{ success: boolean }>;
      improveSpeakers: (data: { dbId: number }) => Promise<WorkspaceResult<boolean>>;
      requestAttention: (data: { title: string; body: string }) => Promise<boolean>;
      getCostRates: () => Promise<{ notesTranscriptionInr: number; liveTranscriptionInr: number }>;
      exportMeetingJson: (data: { dbId: number }) => Promise<WorkspaceResult<{ filePath: string }>>;
      log: (level: 'info' | 'warn' | 'error', ...args: unknown[]) => void;
    };
  }
}
