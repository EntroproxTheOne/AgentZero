import { AI_CONFIG, capTranscriptContext } from './config.js';
import { readArtifactsFile, updateArtifactsFile } from './artifactStore.js';
import { generateGeminiJson } from './providers/gemini.js';
import { buildMinutesOfMeetingPrompt } from './prompts.js';
import { parseJsonText, validateMinutesOfMeeting } from './schemas.js';

export async function ensureMinutesOfMeeting(session, { force = false } = {}) {
  const currentArtifacts = await readArtifactsFile(session.artifactsPath);
  const currentMinutes = currentArtifacts?.minutesOfMeeting;

  if (!force && currentMinutes?.status === 'ready' && currentMinutes.content) {
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
    const transcriptLines = session.transcriptEntries.map((entry) => `${entry.speakerLabel}: ${entry.text}`);
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
      model: AI_CONFIG.models.minutesOfMeeting,
      prompt,
      maxOutputTokens: AI_CONFIG.minutesOfMeetingMaxCompletionTokens,
    });

    const content = validateMinutesOfMeeting(parseJsonText(response.text));
    const updatedAt = new Date().toISOString();

    const updatedArtifacts = await updateArtifactsFile(session.artifactsPath, (current) => ({
      ...current,
      minutesOfMeeting: {
        status: 'ready',
        updatedAt,
        error: null,
        content,
      },
      debug: {
        ...current.debug,
        minutesOfMeeting: [...(current.debug?.minutesOfMeeting ?? []).slice(-9), {
          model: AI_CONFIG.models.minutesOfMeeting,
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

function buildMeetingMeta(session) {
  const durationMs = session.startTime && session.endTime ? session.endTime - session.startTime : 0;
  const speakerCount = new Set(
    session.transcriptEntries
      .filter((entry) => entry.speakerLabel !== 'You')
      .map((entry) => entry.speakerLabel),
  ).size;

  return {
    dateLabel: session.startTime ? new Date(session.startTime).toLocaleString('en-US', {
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
