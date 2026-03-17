const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  saveChunk: (data) => ipcRenderer.invoke('save-chunk', data),
  detectMeetingApps: () => ipcRenderer.invoke('detect-meeting-apps'),
  startMeeting: (data) => ipcRenderer.invoke('start-meeting', data),
  stopMeeting: (data) => ipcRenderer.invoke('stop-meeting', data),
  getMeetings: () => ipcRenderer.invoke('get-meetings'),
  openInExplorer: (filePath) => ipcRenderer.invoke('open-in-explorer', filePath),
  // Auth
  register: (data) => ipcRenderer.invoke('auth-register', data),
  login: (data) => ipcRenderer.invoke('auth-login', data),
  resetPassword: (data) => ipcRenderer.invoke('auth-reset-password', data),
  updateListenerName: (data) => ipcRenderer.invoke('update-listener-name', data),
  // Window
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),
  // ── Transcription ──────────────────────────────────────────────────────────
  // Start the Deepgram session for a given meeting
  startTranscription: (data) => ipcRenderer.invoke('start-transcription', data),
  // Stop the Deepgram session and save JSON transcript
  stopTranscription: (data) => ipcRenderer.invoke('stop-transcription', data),
  // Send a raw 2-ch interleaved PCM ArrayBuffer (zero-copy transfer)
  // buffer is both IN the message object AND in the transfer list so Electron
  // can deliver it zero-copy while main.js reads it from message.buffer
  sendAudioChunk: (meetingId, buffer) =>
    ipcRenderer.send('send-audio-chunk', { meetingId, buffer }),
  // Subscribe to live transcript entries pushed from main process
  onTranscriptEntry: (callback) =>
    ipcRenderer.on('transcript-entry', (_event, entry) => callback(entry)),
  // Unsubscribe (call on component unmount)
  offTranscriptEntry: () =>
    ipcRenderer.removeAllListeners('transcript-entry'),
  log: (level, ...args) => ipcRenderer.send('log-from-renderer', level, ...args),
});
