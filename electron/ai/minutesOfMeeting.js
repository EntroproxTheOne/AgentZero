import { AI_CONFIG, capTranscriptContext } from './config.js';
import { readArtifactsFile, updateArtifactsFile } from './artifactStore.js';
import { generateGeminiJson } from './providers/gemini.js';
import { buildMinutesOfMeetingPrompt } from './prompts.js';
import { parseJsonText, validateMinutesOfMeeting } from './schemas.js';
import { normalizeText, normalizeTranscriptEntries } from '../text/normalize.js';

export async function ensureMinutesOfMeeting(session, { force = false } = {}) {
  const currentArtifacts = await readArtifactsFile(session.artifactsPath);
  const currentMinutes = currentArtifacts?.minutesOfMeeting;

  // Fallback minutes (built from highlights after an AI failure) are retried next time.
  if (!force && currentMinutes?.status === 'ready' && currentMinutes.content && currentMinutes.source !== 'fallback') {
    return currentMinutes;
  }

  const loadingTimestamp = new Date().toISOString();
  await updateArtifactsFile(session.artifactsPath, (current) => ({
    ...current,
    minutesOfMeeting: {
      ...(current.minutesOfMeeting ?? {}),
      status: 'loading',
      updatedAt: loadingTimestamp,
      error: null,
      content: current.minutesOfMeeting?.content ?? null,
    },
  }));

  try {
    const normalizedEntries = normalizeTranscriptEntries(session.transcriptEntries);
    const transcriptLines = normalizedEntries.map((entry) => `${entry.speakerLabel}: ${entry.text}`);
    const contextMeta = capTranscriptContext(transcriptLines, {
      reservedTokens: 5000,
    });
    const meetingMeta = buildMeetingMeta(session);
    const artifacts = currentArtifacts ?? await readArtifactsFile(session.artifactsPath);

    const prompt = buildMinutesOfMeetingPrompt({
      transcriptText: contextMeta.text,
      contextMeta,
      meetingTitle: session.title,
      highlights: artifacts?.highlights,
      meetingMeta,
    });

    const response = await generateGeminiJson({
      tier: 'big',
      prompt,
      maxOutputTokens: AI_CONFIG.minutesOfMeetingMaxCompletionTokens,
      usageFile: session.artifactsPath,
      purpose: 'minutes',
      context: session.contextText ?? '',
    });

    const content = await parseMinutesOfMeetingContent(response.text, session.artifactsPath);
    const updatedAt = new Date().toISOString();

    const updatedArtifacts = await updateArtifactsFile(session.artifactsPath, (current) => ({
      ...current,
      minutesOfMeeting: {
        status: 'ready',
        source: 'ai',
        updatedAt,
        error: null,
        content,
      },
      debug: {
        ...current.debug,
        minutesOfMeeting: [...(current.debug?.minutesOfMeeting ?? []).slice(-9), {
          model: response.model,
          usedSearch: response.usedSearch,
          updatedAt,
          latencyMs: response.latencyMs,
          estimatedInputTokens: contextMeta.estimatedTokens,
          transcriptTruncated: contextMeta.truncated,
          transcriptLines: contextMeta.lineCount,
        }],
      },
    }));

    return updatedArtifacts.minutesOfMeeting;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const updatedAt = new Date().toISOString();
    const fallbackContent = buildFallbackMinutesOfMeeting({
      session,
      highlights: currentArtifacts?.highlights,
    });

    if (fallbackContent) {
      const updatedArtifacts = await updateArtifactsFile(session.artifactsPath, (current) => ({
        ...current,
        minutesOfMeeting: {
          status: 'ready',
          source: 'fallback',
          updatedAt,
          error: errorMessage,
          content: fallbackContent,
        },
        debug: {
          ...current.debug,
          minutesOfMeeting: [...(current.debug?.minutesOfMeeting ?? []).slice(-9), {
            model: 'fallback-from-highlights',
            updatedAt,
            error: errorMessage,
          }],
        },
      }));

      return updatedArtifacts.minutesOfMeeting;
    }

    await updateArtifactsFile(session.artifactsPath, (current) => ({
      ...current,
      minutesOfMeeting: {
        ...(current.minutesOfMeeting ?? {}),
        status: 'error',
        updatedAt,
        error: errorMessage,
        content: current.minutesOfMeeting?.content ?? null,
      },
      debug: {
        ...current.debug,
        minutesOfMeeting: [...(current.debug?.minutesOfMeeting ?? []).slice(-9), {
          model: AI_CONFIG.models.minutesOfMeeting,
          updatedAt,
          error: errorMessage,
        }],
      },
    }));

    throw error;
  }
}

function buildFallbackMinutesOfMeeting({ session, highlights }) {
  if (!highlights?.summary) {
    return null;
  }

  return {
    title: normalizeText(session.title) || 'Untitled Meeting',
    overview: normalizeText(highlights.summary),
    discussionPoints: Array.isArray(highlights.keyDiscussionPoints)
      ? highlights.keyDiscussionPoints.map(normalizeText).filter(Boolean).slice(0, 6)
      : [],
    decisions: deriveDecisionsFromHighlights((highlights.keyDiscussionPoints ?? []).map(normalizeText)),
    actionItems: (highlights.actionItems ?? []).filter(Boolean).slice(0, 8).map((task) => ({
      task: normalizeText(task),
      owner: 'Unassigned',
      deadline: 'Not specified',
      status: 'Open',
      notes: '',
    })),
    risksAndBlockers: deriveRisksAndBlockers((highlights.keyDiscussionPoints ?? []).map(normalizeText)),
    followUps: deriveFollowUps((highlights.actionItems ?? []).map(normalizeText)),
  };
}

function deriveDecisionsFromHighlights(points) {
  return points
    .filter((point) => /\b(decided|decision|finalize|finalized|approved|proceed|selected)\b/i.test(point))
    .slice(0, 6);
}

function deriveRisksAndBlockers(points) {
  return points
    .filter((point) => /\b(concern|risk|blocker|difficult|cost|issue|delay|complex)\b/i.test(point))
    .slice(0, 4);
}

function deriveFollowUps(actionItems) {
  return actionItems
    .filter(Boolean)
    .slice(0, 4)
    .map((item) => `Follow up on: ${item.trim()}`);
}

async function parseMinutesOfMeetingContent(rawText, usageFile) {
  try {
    return validateMinutesOfMeeting(parseJsonText(rawText));
  } catch {
    // Cap the broken JSON sent into repair prompts so the prompt itself doesn't blow context
    const maxRepairSourceChars = 8000;
    const truncatedRaw = typeof rawText === 'string' && rawText.length > maxRepairSourceChars
      ? rawText.slice(0, maxRepairSourceChars) + '…[truncated]'
      : rawText;

    try {
      const repairPrompt = `
You are repairing malformed JSON for a Minutes of Meeting export.
Return only valid, compact JSON. Keep every string value concise.

Required shape:
{
  "title": string,
  "overview": string,
  "discussionPoints": string[],
  "decisions": string[],
  "actionItems": [
    {
      "task": string,
      "owner": string,
      "deadline": string,
      "status": string,
      "notes": string
    }
  ],
  "risksAndBlockers": string[],
  "followUps": string[]
}

Constraints:
- overview: max 2 short paragraphs
- discussionPoints: max 6
- decisions: max 6
- actionItems: max 8
- risksAndBlockers: max 4
- followUps: max 4
- do not add markdown or code fences

Repair this malformed JSON without inventing unrelated content:
${truncatedRaw}
`.trim();

      const repairedResponse = await generateGeminiJson({
        tier: 'big',
        prompt: repairPrompt,
        maxOutputTokens: 8192,
        usageFile,
        purpose: 'minutes-repair',
      });

      return validateMinutesOfMeeting(parseJsonText(repairedResponse.text));
    } catch {
      // Repair failed, try a full rebuild from the truncated source
    }

    try {
      const rebuildPrompt = `
You are rebuilding a Minutes of Meeting JSON object from a partial transcript excerpt.
Return only valid, compact JSON that fits safely in one response.

Required shape:
{
  "title": string,
  "overview": string,
  "discussionPoints": string[],
  "decisions": string[],
  "actionItems": [
    {
      "task": string,
      "owner": string,
      "deadline": string,
      "status": string,
      "notes": string
    }
  ],
  "risksAndBlockers": string[],
  "followUps": string[]
}

Constraints:
- overview: max 2 short paragraphs
- discussionPoints: max 6
- decisions: max 6
- actionItems: max 8
- risksAndBlockers: max 4
- followUps: max 4
- do not add markdown or code fences

Malformed source JSON to reconstruct from:
${truncatedRaw}
`.trim();

      const rebuiltResponse = await generateGeminiJson({
        tier: 'big',
        prompt: rebuildPrompt,
        maxOutputTokens: 8192,
        usageFile,
        purpose: 'minutes-repair',
      });

      return validateMinutesOfMeeting(parseJsonText(rebuiltResponse.text));
    } catch {
      // Rebuild also failed — let the outer catch in ensureMinutesOfMeeting handle fallback
      throw new Error('All JSON repair attempts failed for Minutes of Meeting');
    }
  }
}

function buildMeetingMeta(session) {
  const durationMs = session.startTime && session.endTime ? session.endTime - session.startTime : 0;
  const speakerCount = new Set(
    session.transcriptEntries
      .filter((entry) => entry.speakerLabel !== 'You')
      .map((entry) => entry.speakerLabel),
  ).size;

  return {
    dateLabel: session.startTime ? new Date(session.startTime).toLocaleString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }) : 'Unknown',
    durationLabel: durationMs > 0 ? `${Math.max(1, Math.round(durationMs / 60000))} minutes` : 'Unknown',
    speakerCount,
  };
}
