export interface TranscriptEntry {
  source: 'you' | 'meeting';
  speakerId: number | null;
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

export interface AppSettings {
  transcriptionProvider: 'deepgram' | 'sarvam';
  nativeIndiaMode: boolean;
  sarvam: {
    isBeta: boolean;
    model: string;
    mode: 'transcribe' | 'translate' | 'verbatim' | 'translit' | 'codemix';
    autoDetectLanguage: boolean;
    supportedLanguages: SupportedLanguage[];
  };
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
  endTime?: number;
  meetingFolder?: string;
}

export interface QuickLookResponse {
  answer: string;
}

export interface ExportMeetingResponse {
  filePath: string;
  format: 'pdf' | 'markdown';
}
