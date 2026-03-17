import Groq from 'groq-sdk';
import { AI_CONFIG } from '../config.js';

let cachedClient = null;

function getGroqClient() {
  if (cachedClient) return cachedClient;

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not set');
  }

  cachedClient = new Groq({ apiKey });
  return cachedClient;
}

function extractGroqText(response) {
  const text = response?.choices?.[0]?.message?.content;
  if (typeof text === 'string' && text.trim()) {
    return text.trim();
  }

  throw new Error('Groq response did not include message content');
}

export async function generateGroqJson({
  model,
  prompt,
  maxCompletionTokens = AI_CONFIG.liveAnalysisMaxCompletionTokens,
}) {
  const client = getGroqClient();
  const startedAt = Date.now();
  const response = await client.chat.completions.create({
    model,
    temperature: 0.2,
    max_completion_tokens: maxCompletionTokens,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: 'Return only valid JSON that matches the requested shape.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  return {
    text: extractGroqText(response),
    latencyMs: Date.now() - startedAt,
    raw: response,
  };
}
