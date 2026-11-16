import { AI_CONFIG, capTranscriptContext } from './config.js';
import { buildQuickLookPrompt } from './prompts.js';
import { extractLooseJsonStringField, parseJsonText, validateQuickLook } from './schemas.js';
import { generateGeminiJson } from './providers/gemini.js';
import { updateArtifactsFile } from './artifactStore.js';

export async function answerQuickLookQuestion(session, { question, history, webSearch = false }) {
  if (webSearch) return answerFromWeb(session, question);
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

  const tier = isComplexQuestion(question) ? 'big' : 'fast';
  const response = await generateGeminiJson({
    tier,
    prompt,
    maxOutputTokens: AI_CONFIG.quickLookMaxCompletionTokens,
    useSearch: false,
    usageFile: session?.artifactsPath ?? null,
    purpose: 'quicklook',
    context: session?.contextText ?? '',
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

  return {
    ...quickLook,
    usedSearch: response.usedSearch,
  };
}

function isComplexQuestion(question) {
  return question.trim().length > 180
    || /\b(analy[sz]e|compare|contrast|trade[- ]?off|strategy|detailed|step[- ]by[- ]step|why|how should)\b/i.test(question);
}

/**
 * Web mode: only the question itself is sent, with Google Search grounding.
 * No transcript, chat history, client or project data, since Search runs
 * outside the Mumbai region.
 */
async function answerFromWeb(session, question) {
  const prompt = [
    'Answer the question below using Google Search for current, factual information.',
    'Be concise (at most 5 sentences) and name your sources in plain words.',
    'Respond as JSON: {"answer": "..."}',
    '',
    `Question: ${question}`,
  ].join('\n');
  const response = await generateGeminiJson({
    tier: 'fast',
    prompt,
    maxOutputTokens: AI_CONFIG.quickLookMaxCompletionTokens,
    useSearch: true,
    usageFile: session?.artifactsPath ?? null,
    purpose: 'quicklook-web',
  });
  let answer;
  try {
    answer = validateQuickLook(parseJsonText(response.text)).answer;
  } catch {
    answer = extractLooseJsonStringField(response.text, 'answer') || response.text.trim();
  }
  return { answer, usedSearch: response.usedSearch };
}
