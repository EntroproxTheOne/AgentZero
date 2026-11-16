// Per-meeting cost estimate. Token counts are what Vertex AI reported for each
// call; prices are list prices and must be kept in step with the price lists.
export const PRICING = {
  usdToInr: 88,
  gemini: {
    // Vertex AI asia-south1 (non-global) list price, per 1M tokens. Verified 15 Nov 2026.
    'gemini-3.5-flash-lite': { inputPerM: 0.33, outputPerM: 2.75, verified: true },
    // Vertex AI non-global list price (owner-supplied price list, 16 Nov 2026).
    'gemini-3.5-flash': { inputPerM: 1.65, outputPerM: 9.9, verified: true },
  },
  searchPerQueryUsd: 0.014,
  // Sarvam Saaras v4 streaming STT: ₹0.49/min pay-as-you-go, excl. GST
  // (sarvam.ai/api-pricing, checked 16 Nov 2026). Billed per second of audio.
  sarvamSttInrPerHour: 0.49 * 60,
  // Batch with speaker detection (diarization): ₹0.59/min; plain batch = streaming rate.
  sarvamDiarizedInrPerHour: 0.59 * 60,
  sarvamVerified: true,
};

export function computeMeetingCost({ artifacts, startTimeMs, endTimeMs }) {
  const calls = Array.isArray(artifacts?.usage?.ai) ? artifacts.usage.ai : [];
  let aiUsd = 0;
  let searchUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let allVerified = PRICING.sarvamVerified;
  const byPurpose = {};

  for (const call of calls) {
    const price = PRICING.gemini[call.model] ?? PRICING.gemini['gemini-3.5-flash'];
    if (!PRICING.gemini[call.model]?.verified) allVerified = false;
    const usd = (call.inputTokens * price.inputPerM + call.outputTokens * price.outputPerM) / 1_000_000;
    const searches = (call.searchQueries ?? 0) * PRICING.searchPerQueryUsd;
    aiUsd += usd;
    searchUsd += searches;
    inputTokens += call.inputTokens;
    outputTokens += call.outputTokens;
    byPurpose[call.purpose] = (byPurpose[call.purpose] ?? 0) + usd + searches;
  }

  // Prefer Sarvam's billed audio duration; fall back to wall-clock meeting length.
  const billedSeconds = artifacts?.usage?.stt?.billedAudioSeconds;
  const audioMinutes = typeof billedSeconds === 'number'
    ? billedSeconds / 60
    : startTimeMs && endTimeMs ? Math.max(0, (endTimeMs - startTimeMs) / 60000) : 0;
  // Live (streaming) transcription; older meetings without usage records count wall-clock time.
  const liveSttInr = (artifacts?.usage?.stt || !artifacts?.usage?.sttBatch) ? (audioMinutes / 60) * PRICING.sarvamSttInrPerHour : 0;
  const batch = artifacts?.usage?.sttBatch;
  const batchMinutes = batch && !batch.skipped ? (batch.billedAudioSeconds ?? 0) / 60 : 0;
  const batchInr = (batchMinutes / 60) * (batch?.diarized ? PRICING.sarvamDiarizedInrPerHour : PRICING.sarvamSttInrPerHour);
  const sttInr = liveSttInr + batchInr;
  const totalInr = (aiUsd + searchUsd) * PRICING.usdToInr + sttInr;

  return {
    totalInr,
    totalUsd: totalInr / PRICING.usdToInr,
    aiInr: aiUsd * PRICING.usdToInr,
    searchInr: searchUsd * PRICING.usdToInr,
    sttInr,
    batchInr,
    speakerDetection: Boolean(batch?.diarized),
    audioMinutes: audioMinutes || batchMinutes,
    aiCalls: calls.length,
    inputTokens,
    outputTokens,
    byPurposeInr: Object.fromEntries(Object.entries(byPurpose).map(([k, v]) => [k, v * PRICING.usdToInr])),
    pricesVerified: allVerified,
  };
}
