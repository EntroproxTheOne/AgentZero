// Live mode auto-insights (off by default; Settings → "every 2 / 5 / 10 min").
// Each call sends ONLY the speech since the previous call plus a short running
// summary (≈300 tokens), at low reasoning, with a hard cap per meeting. There
// is no rolling transcript window.
import { AI_CONFIG } from './config.js';
import { parseJsonText, validateLiveInsights } from './schemas.js';
import { generateGeminiJson } from './providers/gemini.js';
import { updateArtifactsFile } from './artifactStore.js';
import { getAppSettings } from '../db.js';

export class LiveInsightsCoordinator {
  constructor({ getSession, emitLiveInsights }) {
    this.getSession = getSession;
    this.emitLiveInsights = emitLiveInsights;
    this.meetings = new Map();
  }

  /** Start the timer for a meeting that is (or just went) live. No-op when the setting is off. */
  start(meetingId) {
    if (this.meetings.has(meetingId)) return;
    const minutes = getAppSettings().autoInsightsMinutes;
    if (!minutes) return;
    const state = { lastIndex: 0, summary: '', calls: 0, inFlight: false, timer: null };
    state.timer = setInterval(() => void this.run(meetingId), minutes * 60_000);
    this.meetings.set(meetingId, state);
  }

  unregisterMeeting(meetingId) {
    const state = this.meetings.get(meetingId);
    if (state?.timer) clearInterval(state.timer);
    this.meetings.delete(meetingId);
  }

  async run(meetingId) {
    const state = this.meetings.get(meetingId);
    const session = this.getSession(meetingId);
    if (!state || !session || state.inFlight) return;
    if (state.calls >= AI_CONFIG.autoInsightsMaxCalls) {
      this.unregisterMeeting(meetingId);
      return;
    }
    const fresh = session.transcriptEntries.slice(state.lastIndex);
    if (fresh.length === 0) return;
    state.inFlight = true;
    try {
      const prompt = [
        'You help an adviser during a live meeting. Return valid JSON only:',
        '{"summary":"running summary of the whole meeting so far, max 200 words","jargon":[{"term":"","explanation":""}],"liveQuestions":[{"text":""}],"suggestions":[{"text":"","type":"action|insight|followup"}]}',
        'Rules: base everything on the new speech; 0-3 items per list; questions end with "?"; suggestions are addressed to the adviser as "you"; empty lists are fine.',
        '',
        `Summary so far: ${state.summary || '(meeting just started)'}`,
        '',
        'New speech since the last update:',
        fresh.map((entry) => `${entry.speakerLabel}: ${entry.text}`).join('\n'),
      ].join('\n');
      const response = await generateGeminiJson({
        tier: 'fast',
        prompt,
        maxOutputTokens: 2048,
        usageFile: session.artifactsPath,
        purpose: 'live',
        thinkingLevel: 'low',
      });
      state.calls += 1;
      state.lastIndex += fresh.length;
      const parsed = parseJsonText(response.text);
      state.summary = String(parsed?.summary ?? state.summary).slice(0, AI_CONFIG.autoInsightsSummaryMaxChars);
      const insights = validateLiveInsights(parsed);
      const updatedAt = new Date().toISOString();
      const artifacts = await updateArtifactsFile(session.artifactsPath, (current) => ({
        ...current,
        liveInsights: {
          status: 'ready',
          updatedAt,
          error: null,
          jargon: keep(insights.jargon, current.liveInsights?.jargon, (i) => i.term, AI_CONFIG.liveJargonKeep),
          liveQuestions: keep(insights.liveQuestions, current.liveInsights?.liveQuestions, (i) => i.text, AI_CONFIG.liveQuestionKeep),
          suggestions: keep(insights.suggestions, current.liveInsights?.suggestions, (i) => i.text, AI_CONFIG.liveSuggestionKeep),
        },
      }));
      this.emitLiveInsights(meetingId, artifacts.liveInsights);
    } catch (error) {
      console.warn('[LiveInsights]', error instanceof Error ? error.message : error);
    } finally {
      state.inFlight = false;
    }
  }
}

function keep(fresh, previous = [], keyOf, limit) {
  const seen = new Set();
  const out = [];
  for (const item of [...fresh, ...previous]) {
    const key = String(keyOf(item) ?? '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...item, id: item.id ?? `i-${hash(key)}` });
  }
  return out.slice(0, limit);
}

function hash(text) {
  let value = 0;
  for (let index = 0; index < text.length; index += 1) value = ((value << 5) - value + text.charCodeAt(index)) | 0;
  return Math.abs(value).toString(36);
}
