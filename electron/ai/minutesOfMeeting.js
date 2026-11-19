// Minutes of Meeting are derived from the meeting's extraction (see extraction.js);
// there is no separate AI call. This returns what the export needs.
import { readArtifactsFile } from './artifactStore.js';
import { deriveViews } from './extraction.js';

export async function ensureMinutesOfMeeting(session) {
  const artifacts = await readArtifactsFile(session.artifactsPath);
  if (artifacts?.extraction) {
    // Re-derive so the export always matches the latest edits.
    return deriveViews(artifacts.extraction, session.title).minutes;
  }
  if (artifacts?.minutesOfMeeting?.status === 'ready' && artifacts.minutesOfMeeting.content) {
    return artifacts.minutesOfMeeting; // meetings processed by older builds
  }
  throw new Error('The meeting record is not ready yet. Wait for processing to finish, then export again.');
}
