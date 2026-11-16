import { AI_CONFIG, capTranscriptContext } from './config.js';
import { buildMeetingHighlightsPrompt } from './prompts.js';
import { parseJsonText, validateHighlights } from './schemas.js';
import { generateGeminiJson } from './providers/gemini.js';
import { updateArtifactsFile } from './artifactStore.js';
import { normalizeTranscriptEntries } from '../text/normalize.js';

export async function generateMeetingHighlights(session) {
  const startedAt = new Date().toISOString();

  await updateArtifactsFile(session.artifactsPath, (current) => ({
    ...current,
    highlights: {
      ...current.highlights,
      status: 'loading',
      error: null,
      updatedAt: startedAt,
    },
  }));

  try {
    const normalizedEntries = normalizeTranscriptEntries(session.transcriptEntries);
    const transcriptLines = normalizedEntries.map((entry) => `${entry.speakerLabel}: ${entry.text}`);
    const contextMeta = capTranscriptContext(transcriptLines, {
      reservedTokens: 3500,
    });

    const prompt = buildMeetingHighlightsPrompt({
      transcriptText: contextMeta.text,
      contextMeta,
      meetingTitle: session.title,
    });

    const response = await generateGeminiJson({
      tier: 'big',
      prompt,
      maxOutputTokens: AI_CONFIG.highlightsMaxCompletionTokens,
      usageFile: session.artifactsPath,
      purpose: 'highlights',
      context: session.contextText ?? '',
    });

    const highlights = validateHighlights(parseJsonText(response.text));

    return updateArtifactsFile(session.artifactsPath, (current) => ({
      ...current,
      highlights: {
        status: 'ready',
        updatedAt: new Date().toISOString(),
        error: null,
        ...highlights,
      },
      debug: {
        ...current.debug,
        highlights: [...current.debug.highlights.slice(-9), {
          model: response.model,
          usedSearch: response.usedSearch,
          updatedAt: new Date().toISOString(),
          latencyMs: response.latencyMs,
          estimatedInputTokens: contextMeta.estimatedTokens,
          transcriptTruncated: contextMeta.truncated,
          transcriptLines: contextMeta.lineCount,
        }],
      },
    }));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return updateArtifactsFile(session.artifactsPath, (current) => ({
      ...current,
      highlights: {
        ...current.highlights,
        status: 'error',
        error: errorMessage,
        updatedAt: new Date().toISOString(),
      },
      debug: {
        ...current.debug,
        highlights: [...current.debug.highlights.slice(-9), {
          model: AI_CONFIG.models.big,
          updatedAt: new Date().toISOString(),
          error: errorMessage,
        }],
      },
    }));
  }
}
