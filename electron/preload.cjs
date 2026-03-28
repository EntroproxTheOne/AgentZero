const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getRuntimeInfo: () => ipcRenderer.invoke('get-runtime-info'),
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  sendVideoChunk: (meetingId, buffer) =>
    ipcRenderer.send('save-chunk-buffer', { meetingId, buffer }),
  flushMeetingWrites: (data) => ipcRenderer.invoke('flush-meeting-writes', data),
  detectMeetingApps: () => ipcRenderer.invoke('detect-meeting-apps'),
  startMeeting: (data) => ipcRenderer.invoke('start-meeting', data),
  stopMeeting: (data) => ipcRenderer.invoke('stop-meeting', data),
  getMeetings: () => ipcRenderer.invoke('get-meetings'),
  getMeetingArtifacts: (data) => ipcRenderer.invoke('get-meeting-artifacts', data),
  exportMeetingMom: (data) => ipcRenderer.invoke('export-meeting-mom', data),
  renameMeeting: (data) => ipcRenderer.invoke('rename-meeting', data),
  deleteMeetings: (data) => ipcRenderer.invoke('delete-meetings', data),
  autoTitleMeeting: (data) => ipcRenderer.invoke('auto-title-meeting', data),
  openInExplorer: (filePath) => ipcRenderer.invoke('open-in-explorer', filePath),
  // Auth
  register: (data) => ipcRenderer.invoke('auth-register', data),
  login: (data) => ipcRenderer.invoke('auth-login', data),
  resetPassword: (data) => ipcRenderer.invoke('auth-reset-password', data),
  updateListenerName: (data) => ipcRenderer.invoke('update-listener-name', data),
  getAppSettings: () => ipcRenderer.invoke('get-app-settings'),
  updateAppSettings: (data) => ipcRenderer.invoke('update-app-settings', data),
  // Window
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),
  // ── Transcription ──────────────────────────────────────────────────────────
  // Start the Deepgram session for a given meeting
  startTranscription: (data) => ipcRenderer.invoke('start-transcription', data),
  // Stop the Deepgram session and save JSON transcript
  stopTranscription: (data) => ipcRenderer.invoke('stop-transcription', data),
  sendAudioChunk: (meetingId, buffer) =>
    ipcRenderer.send('send-audio-chunk', { meetingId, buffer }),
  onTranscriptEntry: (callback) =>
    ipcRenderer.on('transcript-entry', (_event, entry) => callback(entry)),
  offTranscriptEntry: () =>
    ipcRenderer.removeAllListeners('transcript-entry'),
  onLiveInsights: (callback) =>
    ipcRenderer.on('live-insights', (_event, payload) => callback(payload)),
  offLiveInsights: () =>
    ipcRenderer.removeAllListeners('live-insights'),
  onMeetingArtifactsUpdated: (callback) =>
    ipcRenderer.on('meeting-artifacts-updated', (_event, payload) => callback(payload)),
  offMeetingArtifactsUpdated: () =>
    ipcRenderer.removeAllListeners('meeting-artifacts-updated'),
  onMeetingTitleUpdated: (callback) =>
    ipcRenderer.on('meeting-title-updated', (_event, payload) => callback(payload)),
  offMeetingTitleUpdated: () =>
    ipcRenderer.removeAllListeners('meeting-title-updated'),
  onAccessState: (callback) =>
    ipcRenderer.on('access-state', (_event, payload) => callback(payload)),
  offAccessState: () =>
    ipcRenderer.removeAllListeners('access-state'),
  askQuickLook: (data) => ipcRenderer.invoke('quicklook-ask', data),
  log: (level, ...args) => ipcRenderer.send('log-from-renderer', level, ...args),
});
