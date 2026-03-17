import { AI_CONFIG, capTranscriptContext } from './config.js';
import { buildQuickLookPrompt } from './prompts.js';
import { extractLooseJsonStringField, parseJsonText, validateQuickLook } from './schemas.js';
import { generateGeminiJson } from './providers/gemini.js';
import { updateArtifactsFile } from './artifactStore.js';

export async function answerQuickLookQuestion(session, { question, history }) {
  const transcriptLines = session.transcriptEntries.map((entry) => `${entry.speakerLabel}: ${entry.text}`);
  const contextMeta = capTranscriptContext(transcriptLines, {
    reservedTokens: 3000,
  });

  const trimmedHistory = Array.isArray(history)
    ? history.slice(-AI_CONFIG.quickLookHistoryTurns)
    : [];

  const prompt = buildQuickLookPrompt({
    transcriptText: contextMeta.text,
    contextMeta,
    question,
    chatHistory: trimmedHistory,
  });

  const response = await generateGeminiJson({
    model: AI_CONFIG.models.quickLook,
    prompt,
    maxOutputTokens: AI_CONFIG.quickLookMaxCompletionTokens,
  });

  let quickLook;
  try {
    quickLook = validateQuickLook(parseJsonText(response.text));
  } catch (error) {
    const recoveredAnswer = extractLooseJsonStringField(response.text, 'answer');
    if (!recoveredAnswer) {
      throw error;
    }
    quickLook = validateQuickLook({ answer: recoveredAnswer });
  }
  const updatedAt = new Date().toISOString();

  await updateArtifactsFile(session.artifactsPath, (current) => ({
    ...current,
    quickLook: {
      lastUpdatedAt: updatedAt,
      error: null,
      history: [...trimmedHistory.slice(-AI_CONFIG.quickLookHistoryTurns + 1), { role: 'user', text: question }, { role: 'ai', text: quickLook.answer }],
    },
    debug: {
      ...current.debug,
      quickLook: [...current.debug.quickLook.slice(-19), {
        model: AI_CONFIG.models.quickLook,
        updatedAt,
        latencyMs: response.latencyMs,
        estimatedInputTokens: contextMeta.estimatedTokens,
        transcriptTruncated: contextMeta.truncated,
        transcriptLines: contextMeta.lineCount,
      }],
    },
  }));

  return quickLook;
}
