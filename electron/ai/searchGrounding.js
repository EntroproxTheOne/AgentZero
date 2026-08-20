const SEARCH_TRIGGER_PATTERN = /\b(current|latest|today|recent|news|price|cost|weather|who\s+is|who\s+was|what\s+is|what\s+are|define|definition|meaning|explain|look\s*up|search|according\s+to|this\s+week|this\s+month|20\d{2})\b/i;

export function shouldUseGoogleSearch(question) {
  return typeof question === 'string' && SEARCH_TRIGGER_PATTERN.test(question);
}

export function wasGoogleSearchUsed(response) {
  const metadata = [
    response?.groundingMetadata,
    ...(Array.isArray(response?.candidates)
      ? response.candidates.map((candidate) => candidate?.groundingMetadata)
      : []),
  ];

  return metadata.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;

    const hasWebChunk = Array.isArray(entry.groundingChunks)
      && entry.groundingChunks.some((chunk) => Boolean(chunk?.web));
    const hasWebQuery = Array.isArray(entry.webSearchQueries)
      && entry.webSearchQueries.length > 0;

    return hasWebChunk || hasWebQuery;
  });
}
