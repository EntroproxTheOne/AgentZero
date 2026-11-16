const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getRuntimeInfo: () => ipcRenderer.invoke('get-runtime-info'),
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  setCaptureSource: (sourceId) => ipcRenderer.invoke('set-capture-source', sourceId),
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
  login: (data) => ipcRenderer.invoke('auth-login', data),
  logout: () => ipcRenderer.invoke('auth-logout'),
  needsFirstRunSetup: () => ipcRenderer.invoke('auth-needs-setup'),
  firstRunSetup: (data) => ipcRenderer.invoke('auth-first-run-setup', data),
  listUsers: () => ipcRenderer.invoke('users-list'),
  createUser: (data) => ipcRenderer.invoke('users-create', data),
  updateUser: (data) => ipcRenderer.invoke('users-update', data),
  deleteUser: (data) => ipcRenderer.invoke('users-delete', data),
  getMeetingCost: (data) => ipcRenderer.invoke('get-meeting-cost', data),
  requestMicrophoneAccess: () => ipcRenderer.invoke('request-microphone-access'),
  // Clients, projects, documents
  listWorkspace: () => ipcRenderer.invoke('workspace-list'),
  saveClient: (data) => ipcRenderer.invoke('client-save', data),
  deleteClient: (data) => ipcRenderer.invoke('client-delete', data),
  saveProject: (data) => ipcRenderer.invoke('project-save', data),
  deleteProject: (data) => ipcRenderer.invoke('project-delete', data),
  listDocs: (data) => ipcRenderer.invoke('docs-list', data),
  addDocFiles: (data) => ipcRenderer.invoke('doc-add-files', data),
  addDocNote: (data) => ipcRenderer.invoke('doc-add-note', data),
  deleteDoc: (data) => ipcRenderer.invoke('doc-delete', data),
  // Uploaded recordings, processing, cross-meeting Q&A
  pickRecordingFile: () => ipcRenderer.invoke('pick-recording-file'),
  uploadRecording: (data) => ipcRenderer.invoke('upload-recording', data),
  retryMeetingProcessing: (data) => ipcRenderer.invoke('retry-meeting-processing', data),
  updateMeetingContext: (data) => ipcRenderer.invoke('update-meeting-context', data),
  askAllMeetings: (data) => ipcRenderer.invoke('ask-all-meetings', data),
  onMeetingProcessing: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('meeting-processing', listener);
    return () => ipcRenderer.removeListener('meeting-processing', listener);
  },
  openMacPrivacySettings: (pane) => ipcRenderer.invoke('open-mac-privacy-settings', pane),
  getMacPermissions: () => ipcRenderer.invoke('get-mac-permissions'),
  requestMacPermission: (kind, options) => ipcRenderer.invoke('request-mac-permission', kind, options),
  relaunchApp: () => ipcRenderer.invoke('relaunch-app'),
  updateListenerName: (data) => ipcRenderer.invoke('update-listener-name', data),
  getAppSettings: () => ipcRenderer.invoke('get-app-settings'),
  updateAppSettings: (data) => ipcRenderer.invoke('update-app-settings', data),
  getCredentialsStatus: () => ipcRenderer.invoke('get-credentials-status'),
  updateCredentials: (data) => ipcRenderer.invoke('update-credentials', data),
  testAiConnection: () => ipcRenderer.invoke('test-ai-connection'),
  // Window
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),
  // ── Transcription ──────────────────────────────────────────────────────────
  // Start the Sarvam transcription session for a given meeting
  startTranscription: (data) => ipcRenderer.invoke('start-transcription', data),
  // Stop the Sarvam session and save JSON transcript
  stopTranscription: (data) => ipcRenderer.invoke('stop-transcription', data),
  sendAudioChunk: (meetingId, buffer) =>
    ipcRenderer.send('send-audio-chunk', { meetingId, buffer }),
  onTranscriptEntry: (callback) =>
    ipcRenderer.on('transcript-entry', (_event, entry) => callback(entry)),
  offTranscriptEntry: () =>
    ipcRenderer.removeAllListeners('transcript-entry'),
  onTranscriptionStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('transcription-status', listener);
    return () => ipcRenderer.removeListener('transcription-status', listener);
  },
  cancelMeeting: (data) => ipcRenderer.invoke('cancel-meeting', data),
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
