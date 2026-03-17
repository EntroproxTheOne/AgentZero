export function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getTimestamp() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

export function buildPersistedEntry(entry) {
  const speakerLabel = entry.source === 'you'
    ? 'You'
    : entry.speakerId != null
      ? `Speaker ${entry.speakerId + 1}`
      : 'Meeting';

  return {
    timestamp: entry.timestamp,
    source: entry.source,
    speakerLabel,
    speakerId: entry.speakerId,
    text: entry.transcript,
    isFinal: true,
    languageCode: entry.languageCode ?? null,
    languageProbability: entry.languageProbability ?? null,
  };
}

export function emitTranscriptEntry(mainWindow, entry) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('transcript-entry', entry);
}
