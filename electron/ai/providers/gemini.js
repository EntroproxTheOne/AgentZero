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

export async function generateGeminiJson({
  model,
  prompt,
  maxOutputTokens,
}) {
  await geminiLimiter.waitForTurn();

  const client = getGeminiClient();
  const startedAt = Date.now();
  const response = await client.models.generateContent({
    model,
    contents: prompt,
    config: {
      temperature: 0.2,
      topP: 0.95,
      responseMimeType: 'application/json',
      maxOutputTokens: maxOutputTokens ?? AI_CONFIG.highlightsMaxCompletionTokens,
    },
  });

  return {
    text: extractGeminiText(response),
    latencyMs: Date.now() - startedAt,
    raw: response,
  };
}
