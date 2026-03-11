export {};

declare global {
  interface Window {
    electronAPI: {
      getDesktopSources: () => Promise<any[]>;
      saveChunk: (data: { meetingId: number; buffer: number[] }) => Promise<string>;
      detectMeetingApps: () => Promise<string[]>;
      startMeeting: (data: { title: string }) => Promise<{ meetingId: number; dbId: number; tempPath: string }>;
      stopMeeting: (data: { meetingId: number; dbId: number; startTime: number; title: string }) => Promise<{ finalPath: string; finalName: string }>;
      getMeetings: () => Promise<any[]>;
      openInExplorer: (filePath: string) => Promise<void>;
      register: (data: { username: string; email: string; password: string }) => Promise<{ success: boolean; userId?: number; error?: string }>;
      login: (data: { email: string; password: string }) => Promise<{ success: boolean; user?: { id: number; username: string; email: string; listener_name: string }; error?: string }>;
      resetPassword: (data: { email: string; newPassword: string }) => Promise<{ success: boolean; error?: string }>;
      updateListenerName: (data: { userId: number; listenerName: string }) => Promise<{ success: boolean }>;
      windowMinimize: () => void;
      windowMaximize: () => void;
      windowClose: () => void;
    };
  }
}
