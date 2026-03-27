const MOJIBAKE_PATTERN = /(à¤|à¥|Ã.|â€|Â|ðŸ|Ð|Ñ)/;

export function normalizeText(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text) return '';
  return repairMojibake(text);
}

export function normalizeTranscriptEntries(entries = []) {
  return entries.map((entry) => ({
    ...entry,
    speakerLabel: normalizeText(entry.speakerLabel),
    text: normalizeText(entry.text),
  }));
}

function repairMojibake(text) {
  if (!MOJIBAKE_PATTERN.test(text)) {
    return text;
  }

  try {
    const repaired = Buffer.from(text, 'latin1').toString('utf8').trim();
    if (looksMoreReadable(repaired, text)) {
      return repaired;
    }
  } catch {
    // ignored
  }

  return text;
}

function looksMoreReadable(candidate, original) {
  if (!candidate || candidate === original) return false;
  const originalHits = countMojibakeMarkers(original);
  const candidateHits = countMojibakeMarkers(candidate);
  return candidateHits < originalHits;
}

function countMojibakeMarkers(text) {
  const matches = text.match(MOJIBAKE_PATTERN);
  return matches ? matches.length : 0;
}
