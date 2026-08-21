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
