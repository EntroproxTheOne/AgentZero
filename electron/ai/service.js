import { initializeArtifactsFile } from './artifactStore.js';
import { LiveInsightsCoordinator } from './liveInsights.js';
import { answerQuickLookQuestion } from './quickLook.js';

/** AI during a live meeting: Quick Ask and (opt-in) auto-insights. */
export class MeetingAiService {
  constructor({ getSession, emitToRenderer }) {
    this.getSession = getSession;
    this.emitToRenderer = emitToRenderer;
    this.liveInsights = new LiveInsightsCoordinator({
      getSession,
      emitLiveInsights: (meetingId, payload) => {
        this.emitToRenderer('live-insights', { meetingId, payload });
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
  }

  /** Called when the meeting starts in (or switches to) Live mode. */
  startLive(meetingId) {
    this.liveInsights.start(meetingId);
  }

  unregisterMeeting(meetingId) {
    this.liveInsights.unregisterMeeting(meetingId);
  }

  async answerQuickLook(meetingId, payload) {
    const session = this.getSession(meetingId);
    if (!session) throw new Error('Quick Ask works while a Live meeting is recording.');
    return answerQuickLookQuestion(session, payload);
  }
}
