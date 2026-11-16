import { AI_CONFIG, capTranscriptContext } from './config.js';
import { buildLiveInsightsPrompt } from './prompts.js';
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

  registerMeeting(meetingId) {
    this.meetings.set(meetingId, {
      lastAnalyzedCount: 0,
      timer: null,
      inFlight: false,
      lastProvider: null,
      lastModel: null,
    });
  }

  unregisterMeeting(meetingId) {
    const state = this.meetings.get(meetingId);
    if (state?.timer) clearTimeout(state.timer);
    this.meetings.delete(meetingId);
  }

  notifyTranscriptUpdated(meetingId) {
    const state = this.meetings.get(meetingId);
    const session = this.getSession(meetingId);
    if (!state || !session) return;
    if (state.inFlight || state.timer) return;
    // Live insights can be switched off; transcription and post-meeting analysis still run.
    if (!getAppSettings().liveInsightsEnabled) return;
    if (session.transcriptEntries.length <= state.lastAnalyzedCount) return;

    state.timer = setTimeout(() => {
      state.timer = null;
      void this.runAnalysis(meetingId);
    }, AI_CONFIG.liveAnalysisIntervalMs);
  }

  async runAnalysis(meetingId) {
    const state = this.meetings.get(meetingId);
    const session = this.getSession(meetingId);
    if (!state || !session) return;
    if (state.inFlight) return;
    if (session.transcriptEntries.length === 0) return;

    state.inFlight = true;

    try {
      const transcriptLines = session.transcriptEntries.map((entry) => `${entry.speakerLabel}: ${entry.text}`);
      const contextMeta = capTranscriptContext(transcriptLines, {
        tokenCap: AI_CONFIG.liveTranscriptTokenCap,
        reservedTokens: 0, // the cap above is the transcript budget itself
      });

      const prompt = buildLiveInsightsPrompt({
        transcriptText: contextMeta.text,
        contextMeta,
      });

      const providerSelection = selectLiveInsightsProvider();
      state.lastProvider = providerSelection.provider;
      state.lastModel = providerSelection.model;
      const response = await generateGeminiJson({
        tier: 'fast',
        prompt,
        maxOutputTokens: AI_CONFIG.liveAnalysisMaxCompletionTokens,
        usageFile: session.artifactsPath,
        purpose: 'live',
        context: session.liveContextText ?? '',
      });
      state.lastModel = response.model;

      const liveInsights = validateLiveInsights(parseJsonText(response.text));
      const updatedAt = new Date().toISOString();
      const debugEntry = {
        provider: providerSelection.provider,
        model: response.model,
        updatedAt,
        latencyMs: response.latencyMs,
        estimatedInputTokens: contextMeta.estimatedTokens,
        transcriptTruncated: contextMeta.truncated,
        transcriptLines: contextMeta.lineCount,
      };

      state.lastAnalyzedCount = session.transcriptEntries.length;

      const artifacts = await updateArtifactsFile(session.artifactsPath, (current) => ({
          ...current,
          liveInsights: {
            status: 'ready',
            updatedAt,
            error: null,
          jargon: buildJargonInsights(current.liveInsights?.jargon, liveInsights.jargon, updatedAt),
          liveQuestions: buildLiveQuestions(current.liveInsights?.liveQuestions, liveInsights.liveQuestions, updatedAt),
          suggestions: buildSuggestions(current.liveInsights?.suggestions, liveInsights.suggestions, updatedAt),
        },
        debug: {
          ...current.debug,
          liveAnalysis: [...current.debug.liveAnalysis.slice(-19), debugEntry],
        },
      }));

      this.emitLiveInsights(meetingId, artifacts.liveInsights);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await updateArtifactsFile(session.artifactsPath, (current) => ({
          ...current,
          liveInsights: {
            ...current.liveInsights,
            status: 'error',
            error: errorMessage,
            updatedAt: new Date().toISOString(),
          },
          debug: {
            ...current.debug,
            liveAnalysis: [...current.debug.liveAnalysis.slice(-19), {
              provider: state.lastProvider ?? 'gemini',
              model: state.lastModel ?? AI_CONFIG.models.fast,
              updatedAt: new Date().toISOString(),
              error: errorMessage,
            }],
          },
        }));
    } finally {
      state.inFlight = false;
      const nextSession = this.getSession(meetingId);
      if (nextSession && nextSession.transcriptEntries.length > state.lastAnalyzedCount) {
        this.notifyTranscriptUpdated(meetingId);
      }
    }
  }
}

function selectLiveInsightsProvider() {
  return {
    provider: 'gemini',
    model: AI_CONFIG.models.fast,
  };
}

function buildJargonInsights(previousItems = [], nextItems = [], updatedAt) {
  const previousByKey = new Map(
    previousItems.map((item) => [normalizeKey(item.term), item]),
  );

  const fresh = nextItems.map((item) => {
    const previous = previousByKey.get(normalizeKey(item.term));
    return {
      id: previous?.id ?? createStableId('jargon', item.term),
      term: item.term,
      explanation: item.explanation,
      detectedAt: previous?.detectedAt ?? updatedAt,
      lastSeenAt: updatedAt,
    };
  });
  return mergeKeep(fresh, previousItems, (item) => normalizeKey(item.term), AI_CONFIG.liveJargonKeep);
}

function buildLiveQuestions(previousItems = [], nextItems = [], updatedAt) {
  const previousByKey = new Map(
    previousItems.map((item) => [normalizeKey(item.text), item]),
  );
  const now = Date.parse(updatedAt);
  const questions = [];

  for (const item of nextItems) {
    const text = item.text.trim();
    if (!text) continue;

    const previous = previousByKey.get(normalizeKey(text));
    const partial = isLikelyPartialQuestion(text);
    const partialSince = partial ? (previous?.partialSince ?? updatedAt) : null;

    if (
      partial
      && partialSince
      && now - Date.parse(partialSince) >= AI_CONFIG.liveQuestionPartialTtlMs
    ) {
      continue;
    }

    questions.push({
      id: previous?.id ?? createStableId('question', text),
      text,
      createdAt: previous?.createdAt ?? updatedAt,
      lastSeenAt: updatedAt,
      partial,
      partialSince,
    });

  }

  // Keep earlier complete questions; drop stale half-heard ones.
  const carried = previousItems.filter((item) => !item.partial
    || now - Date.parse(item.partialSince ?? item.createdAt) < AI_CONFIG.liveQuestionPartialTtlMs);
  return mergeKeep(questions, carried, (item) => normalizeKey(item.text), AI_CONFIG.liveQuestionKeep);
}

function buildSuggestions(previousItems = [], nextItems = [], updatedAt) {
  const previousByKey = new Map(
    previousItems.map((item) => [normalizeKey(`${item.type}:${item.text}`), item]),
  );

  const fresh = nextItems.map((item) => {
    const previous = previousByKey.get(normalizeKey(`${item.type}:${item.text}`));
    return {
      id: previous?.id ?? createStableId('suggestion', `${item.type}:${item.text}`),
      text: item.text,
      type: item.type,
      createdAt: previous?.createdAt ?? updatedAt,
      lastSeenAt: updatedAt,
    };
  });
  return mergeKeep(fresh, previousItems, (item) => normalizeKey(`${item.type}:${item.text}`), AI_CONFIG.liveSuggestionKeep);
}

/** Newest results first, then earlier items not repeated this run, capped. */
function mergeKeep(fresh, previous = [], keyOf, limit) {
  const seen = new Set(fresh.map(keyOf));
  const carried = previous.filter((item) => !seen.has(keyOf(item)));
  return [...fresh, ...carried].slice(0, limit);
}

function isLikelyPartialQuestion(text) {
  return !text.trim().endsWith('?');
}

function normalizeKey(text) {
  return String(text || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function createStableId(prefix, value) {
  const normalized = normalizeKey(value);
  let hash = 0;

  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) - hash) + normalized.charCodeAt(index);
    hash |= 0;
  }

  return `${prefix}-${Math.abs(hash).toString(36)}`;
}
