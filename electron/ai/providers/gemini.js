import { GoogleGenAI } from '@google/genai';
import { AI_CONFIG } from '../config.js';
import { getConfiguredSecret } from '../../runtimeConfig.js';

class SlidingWindowRateLimiter {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.timestamps = [];
  }

  async waitForTurn() {
    if (!AI_CONFIG.geminiRateLimitEnabled || this.limit <= 0 || this.windowMs <= 0) {
      return;
    }

    while (true) {
      const now = Date.now();
      this.timestamps = this.timestamps.filter((timestamp) => now - timestamp < this.windowMs);

      if (this.timestamps.length < this.limit) {
        this.timestamps.push(now);
        return;
      }

      const waitMs = Math.max(50, this.windowMs - (now - this.timestamps[0]));
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

const geminiLimiter = new SlidingWindowRateLimiter(
  AI_CONFIG.geminiRequestsPerMinute,
  AI_CONFIG.geminiRateLimitWindowMs,
);

let cachedClient = null;

function getGeminiClient() {
  if (cachedClient) return cachedClient;

  const apiKey = getConfiguredSecret('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  cachedClient = new GoogleGenAI({ apiKey });
  return cachedClient;
}

function extractGeminiText(response) {
  if (typeof response?.text === 'string' && response.text.trim()) {
    return response.text.trim();
  }

  throw new Error('Gemini response did not include text');
}

function getModelCandidates({ tier, model, fallbackModels = [] }) {
  const configuredModels = tier ? AI_CONFIG.modelChains[tier] : null;
  const candidates = configuredModels?.length
    ? configuredModels
    : [model, ...fallbackModels];

  return [...new Set(candidates.filter((candidate) => typeof candidate === 'string' && candidate.trim()))];
}

function formatFailure(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function generateGeminiJson({
  tier = 'fast',
  model,
  fallbackModels,
  prompt,
  maxOutputTokens,
  useSearch = false,
}) {
  const candidates = getModelCandidates({ tier, model, fallbackModels });
  if (candidates.length === 0) {
    throw new Error('No Gemini models are configured');
  }

  const searchModes = useSearch ? [true, false] : [false];
  const failures = [];
  const client = getGeminiClient();

  for (const includeSearch of searchModes) {
    for (const candidate of candidates) {
      try {
        await geminiLimiter.waitForTurn();
        const startedAt = Date.now();
        const response = await client.models.generateContent({
          model: candidate,
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            maxOutputTokens: maxOutputTokens ?? AI_CONFIG.highlightsMaxCompletionTokens,
            ...(includeSearch ? { tools: [{ googleSearch: {} }] } : {}),
          },
        });

        return {
          text: extractGeminiText(response),
          latencyMs: Date.now() - startedAt,
          raw: response,
          model: candidate,
          usedSearch: includeSearch,
        };
      } catch (error) {
        failures.push(`${candidate}${includeSearch ? ' with Search' : ''}: ${formatFailure(error)}`);
        console.warn(`[Gemini] Request failed for ${candidate}${includeSearch ? ' with Search' : ''}:`, error);
      }
    }
  }

  throw new Error(`Gemini request failed across all configured models. ${failures.join(' | ')}`);
}
