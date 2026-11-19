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

  // Live streaming only exists for Live-mode meetings (and meetings from older builds,
  // which had no usage record at all: count wall-clock time for those).
  const usage = artifacts?.usage ?? {};
  const wallMinutes = startTimeMs && endTimeMs ? Math.max(0, (endTimeMs - startTimeMs) / 60000) : 0;
  const liveMinutes = usage.stt
    ? (typeof usage.stt.billedAudioSeconds === 'number' ? usage.stt.billedAudioSeconds / 60 : wallMinutes)
    : (!usage.sttBatch ? wallMinutes : 0);
  const liveSttInr = (liveMinutes / 60) * PRICING.sarvamSttInrPerHour;
  const batch = usage.sttBatch;
  const batchMinutes = batch && !batch.skipped ? (batch.billedAudioSeconds ?? 0) / 60 : 0;
  const batchInr = (batchMinutes / 60) * (batch?.diarized ? PRICING.sarvamDiarizedInrPerHour : PRICING.sarvamSttInrPerHour);
  // "Go live" catch-up: earlier audio transcribed in batch without diarization.
  const catchUpMinutes = (usage.sttCatchUp?.billedAudioSeconds ?? 0) / 60;
  const catchUpInr = (catchUpMinutes / 60) * PRICING.sarvamSttInrPerHour;
  const sttInr = liveSttInr + batchInr + catchUpInr;
  const totalInr = (aiUsd + searchUsd) * PRICING.usdToInr + sttInr;

  const purposeInr = Object.fromEntries(Object.entries(byPurpose).map(([k, v]) => [k, v * PRICING.usdToInr]));
  const sum = (keys) => keys.reduce((total, key) => total + (purposeInr[key] ?? 0), 0);
  const notesKeys = ['extraction', 'highlights', 'minutes', 'minutes-repair', 'title'];
  const askKeys = ['ask', 'template', 'quicklook', 'quicklook-web', 'ask-all'];
  const liveKeys = ['live'];
  const known = new Set([...notesKeys, ...askKeys, ...liveKeys]);
  const otherInr = Object.entries(purposeInr).filter(([key]) => !known.has(key)).reduce((total, [, v]) => total + v, 0);

  return {
    totalInr,
    totalUsd: totalInr / PRICING.usdToInr,
    aiInr: aiUsd * PRICING.usdToInr,
    searchInr: searchUsd * PRICING.usdToInr,
    sttInr,
    batchInr,
    speakerDetection: Boolean(batch?.diarized),
    audioMinutes: Math.max(liveMinutes, batchMinutes, wallMinutes),
    aiCalls: calls.length,
    inputTokens,
    outputTokens,
    byPurposeInr: purposeInr,
    // The three numbers the cost card shows.
    breakdown: {
      transcriptionInr: sttInr,
      notesInr: sum(notesKeys) + otherInr,
      askInr: sum(askKeys),
      liveInsightsInr: sum(liveKeys),
    },
    pricesVerified: allVerified,
  };
}

/** Per-hour list prices for Settings. */
export function perHourRates() {
  return {
    notesTranscriptionInr: PRICING.sarvamDiarizedInrPerHour,
    liveTranscriptionInr: PRICING.sarvamSttInrPerHour,
  };
}
