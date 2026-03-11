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
});
