export interface TranscriptEntry {
  source: 'you' | 'meeting';
  speakerId: number | null;
  /** Live mode: You / Client name from the capture levels. */
  speakerLabel?: string;
  catchUp?: boolean;
  transcript: string;
  timestamp: string;
  isFinal: boolean;
  interim: boolean;
  languageCode?: string | null;
  languageProbability?: number | null;
}

export interface SavedTranscriptEntry {
  timestamp: string;
  source: 'you' | 'meeting';
  speakerLabel: string;
  speakerId: number | null;
  text: string;
  isFinal: true;
  languageCode?: string | null;
  languageProbability?: number | null;
}

export interface SupportedLanguage {
  code: string;
  label: string;
}

export type ProcessingState = 'done' | 'recording' | 'transcribing' | 'analyzing' | 'error';

export type WorkspaceResult<T> = { success: true; value: T } | { success: false; error: string };

export interface ClientRecord {
  id: number;
  name: string;
  notes: string;
  created_at: string;
  project_count?: number;
  meeting_count?: number;
  doc_count?: number;
}

export interface ProjectRecord {
  id: number;
  name: string;
  notes: string;
  client_id: number | null;
  client_name?: string | null;
  created_at: string;
  meeting_count?: number;
  doc_count?: number;
}

export interface ContextDoc {
  id: number;
  owner_type: 'client' | 'project';
  owner_id: number;
  file_name: string;
  chars: number;
  created_at: string;
}

export interface RecordingFileInfo {
  filePath: string;
  fileName: string;
  durationSeconds: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
}

export interface AskAllAnswer {
  answer: string;
  citations: { meetingId: number; lineId?: number | null; note: string; title?: string; date?: string }[];
  meetingsSearched: number;
  transcriptsIncluded?: number;
}

export interface AppUser {
  id: number;
  username: string;
  email: string;
  listener_name: string;
  isAdmin: boolean;
  mustChangePassword: boolean;
}

export type AccountResult<T> = ({ success: true } & T) | { success: false; error: string };

export interface MeetingCost {
  totalInr: number;
  totalUsd: number;
  aiInr: number;
  searchInr: number;
  sttInr: number;
  batchInr?: number;
  speakerDetection?: boolean;
  audioMinutes: number;
  aiCalls: number;
  inputTokens: number;
  outputTokens: number;
  byPurposeInr: Record<string, number>;
  breakdown?: { transcriptionInr: number; notesInr: number; askInr: number; liveInsightsInr: number };
  pricesVerified: boolean;
}

export interface CredentialsStatus {
  location: string;
  gcpProjectId: string | null;
  serviceAccountEmail: string | null;
  serviceAccountSource: 'settings' | 'environment' | 'invalid' | null;
  geminiKeySet: boolean;
  geminiKeyHint: string | null;
  geminiKeySource: 'settings' | 'built-in' | 'environment' | null;
  sarvamKeySource: 'settings' | 'built-in' | 'environment' | null;
  builtInKeys: boolean;
  sarvamKeySet: boolean;
  sarvamKeyHint: string | null;
  secureStorageAvailable: boolean;
}

export type AiConnectionTestResult =
  | { ok: true; location: string; results: { model: string; ok: boolean; latencyMs?: number; error?: string }[] }
  | { ok: false; error: string };

export interface AppSettings {
  transcriptionProvider: 'sarvam';
  nativeIndiaMode: boolean;
  screenRecordingEnabled: boolean;
  showCost: boolean;
  onboardingDone: boolean;
  webSearchEnabled: boolean;
  liveInsightsEnabled: boolean;
  diarizationEnabled: boolean;
  recordingMode: RecordingMode;
  /** Live mode auto-insights: 0 = off, else every N minutes. */
  autoInsightsMinutes: number;
  sarvam: {
    isBeta: boolean;
    model: string;
    mode: 'transcribe' | 'translate' | 'verbatim' | 'translit' | 'codemix';
    autoDetectLanguage: boolean;
    supportedLanguages: SupportedLanguage[];
  };
}

export interface RuntimeAccessInfo {
  allowed: boolean;
  reason: 'active' | 'expired' | 'disabled' | 'invalid-expiry';
  expiresAt: string;
  shutdownMessage: string;
}

export interface RuntimeInfo {
  platform: string;
  isMac: boolean;
  access: RuntimeAccessInfo;
  macPermissions: {
    microphone: string;
    screen: string;
  } | null;
}

export interface JargonInsight {
  id?: string;
  term: string;
  explanation: string;
  detectedAt?: string;
  lastSeenAt?: string;
}

export interface LiveQuestionSuggestion {
  id?: string;
  text: string;
  createdAt?: string;
  lastSeenAt?: string;
  partial?: boolean;
  partialSince?: string | null;
}

export interface MeetingSuggestion {
  id?: string;
  text: string;
  type: 'action' | 'insight' | 'followup';
  createdAt?: string;
  lastSeenAt?: string;
}

export interface LiveInsightsPayload {
  status: 'idle' | 'ready' | 'error' | 'loading';
  updatedAt: string | null;
  error: string | null;
  jargon: JargonInsight[];
  liveQuestions: LiveQuestionSuggestion[];
  suggestions: MeetingSuggestion[];
}

export interface MeetingHighlights {
  status: 'idle' | 'loading' | 'ready' | 'error';
  updatedAt: string | null;
  error: string | null;
  summary: string;
  keyDiscussionPoints: string[];
  actionItems: string[];
}

export interface MinutesOfMeetingActionItem {
  task: string;
  owner: string;
  deadline: string;
  status: string;
  notes: string;
}

export interface MinutesOfMeetingContent {
  title: string;
  overview: string;
  discussionPoints: string[];
  decisions: string[];
  actionItems: MinutesOfMeetingActionItem[];
  risksAndBlockers: string[];
  followUps: string[];
}

export interface QuickLookHistoryItem {
  role: 'user' | 'ai';
  text: string;
  usedSearch?: boolean;
  citations?: number[];
}

export interface MeetingArtifacts {
  version: number;
  meetingId: number;
  dbId: number;
  title: string;
  transcriptPath: string;
  artifactsPath: string;
  liveInsights: LiveInsightsPayload;
  highlights: MeetingHighlights;
  minutesOfMeeting?: {
    status: 'idle' | 'loading' | 'ready' | 'error';
    updatedAt: string | null;
    error: string | null;
    content: MinutesOfMeetingContent | null;
  };
  quickLook: {
    lastUpdatedAt: string | null;
    error: string | null;
    history: QuickLookHistoryItem[];
  };
  extraction?: MeetingExtraction;
  extractionStale?: boolean;
  speakerMap?: SpeakerMap | null;
  ask?: { history: QuickLookHistoryItem[] };
  documents?: Record<string, { name: string; status: 'running' | 'ready' | 'error'; text?: string; error?: string; updatedAt: string }>;
  usage?: { sttBatch?: { diarized?: boolean } | null };
}

export type RecordingMode = 'notes' | 'live';

export interface MeetingTemplate {
  id: number;
  name: string;
  instructions: string;
  builtin: boolean;
}

export interface ExtractionEvidence { line_id: number; speaker: string; quote: string }

export interface ExtractionDecision {
  id: string;
  topic: string;
  statement: string;
  status: 'confirmed' | 'proposed' | 'discussed' | 'unclear' | 'reversed';
  evidence: ExtractionEvidence[];
  superseded_by: string | null;
  edited?: boolean;
}

export interface ExtractionTask {
  id: string;
  task: string;
  owner: string;
  owner_evidence_line_id: number | null;
  due: string | null;
  status: 'confirmed' | 'tentative' | 'cancelled';
  done: boolean;
  edited?: boolean;
}

export interface MeetingExtraction {
  status: 'ready';
  title: string;
  summary: string;
  key_points: { text: string; line_ids: number[] }[];
  decisions: ExtractionDecision[];
  action_items: ExtractionTask[];
  figures: { label: string; value: string; line_id: number | null }[];
  documents_requested: { item: string; from: string; line_id: number | null }[];
  open_questions: { text: string; line_id: number | null }[];
  oneSided?: boolean;
  validationProblems?: string[];
}

export interface SpeakerInfo { name: string; side: 'local' | 'remote' | 'unknown'; share: number | null; seconds: number; isOwner: boolean }

export interface SpeakerMap {
  mode: 'diarized' | 'live';
  oneSided: boolean;
  speakers?: Record<string, SpeakerInfo>;
  ownerId?: string | null;
  confidence?: number;
  needsConfirmation?: boolean;
  confirmed?: boolean;
  needsImprove?: boolean;
  names?: string[];
}

export interface MeetingRecord {
  id: number;
  title: string;
  date: string;
  start_time_ms: number | null;
  end_time_ms: number | null;
  video_file_path: string | null;
  audio_file_path: string | null;
  transcript_path: string | null;
  artifacts_path: string | null;
  client_id?: number | null;
  project_id?: number | null;
  client_name?: string | null;
  project_name?: string | null;
  agenda?: string | null;
  source?: 'live' | 'upload';
  processing_state?: ProcessingState;
  processing_note?: string | null;
  batch_diarize?: number;
  recording_mode?: RecordingMode;
  owner_name?: string | null;
}

export interface MeetingArtifactsResponse {
  meeting: MeetingRecord;
  transcriptEntries: SavedTranscriptEntry[];
  artifacts: MeetingArtifacts | null;
}

export interface CurrentMeetingInfo {
  meetingId: number;
  dbId: number;
  title: string;
  transcriptPath: string;
  artifactsPath: string;
  startTime: number;
  recordScreen: boolean;
  endTime?: number;
  meetingFolder?: string;
  mode?: RecordingMode;
}

export interface QuickLookResponse {
  answer: string;
  usedSearch: boolean;
}

export interface ExportMeetingResponse {
  filePath: string;
  format: 'pdf' | 'markdown';
}

export type MacAccessState = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown';

export interface MacPermissionStatus {
  isMac: boolean;
  microphone?: MacAccessState;
  screen?: MacAccessState;
}
