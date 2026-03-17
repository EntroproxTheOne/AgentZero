import { initializeArtifactsFile, readArtifactsFile } from './artifactStore.js';
import { LiveInsightsCoordinator } from './liveInsights.js';
import { generateMeetingHighlights } from './highlights.js';
import { answerQuickLookQuestion } from './quickLook.js';

export class MeetingAiService {
  constructor({ getSession, emitToRenderer }) {
    this.getSession = getSession;
    this.emitToRenderer = emitToRenderer;
    this.liveInsights = new LiveInsightsCoordinator({
      getSession,
      emitLiveInsights: (meetingId, payload) => {
        this.emitToRenderer('live-insights', { meetingId, payload });
        this.emitArtifactsUpdated(meetingId);
      },
    });
  }

  async registerMeeting(session) {
    await initializeArtifactsFile(session.artifactsPath, {
      meetingId: session.meetingId,
      dbId: session.dbId,
      title: session.title,
      transcriptPath: session.transcriptPath,
      artifactsPath: session.artifactsPath,
    });

    this.liveInsights.registerMeeting(session.meetingId);
  }

  unregisterMeeting(meetingId) {
    this.liveInsights.unregisterMeeting(meetingId);
  }

  handleTranscriptEntry(meetingId) {
    this.liveInsights.notifyTranscriptUpdated(meetingId);
  }

  async generateHighlights(meetingId) {
    const session = this.getSession(meetingId);
    if (!session) return null;
    const artifacts = await generateMeetingHighlights(session);
    this.emitArtifactsUpdated(meetingId, artifacts);
    return artifacts;
  }

  async answerQuickLook(meetingId, payload) {
    const session = this.getSession(meetingId);
    if (!session) {
      throw new Error('Meeting session not found for QuickLook');
    }

    return answerQuickLookQuestion(session, payload);
  }

  async getArtifactsForSession(meetingId) {
    const session = this.getSession(meetingId);
    if (!session) return null;
    return readArtifactsFile(session.artifactsPath);
  }

  emitArtifactsUpdated(meetingId, payload = null) {
    this.emitToRenderer('meeting-artifacts-updated', {
      meetingId,
      payload,
    });
  }
}
