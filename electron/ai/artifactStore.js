import fs from 'fs/promises';

const writeChains = new Map();

function defaultArtifacts({ meetingId, dbId, title, transcriptPath, artifactsPath }) {
  return {
    version: 1,
    meetingId,
    dbId,
    title,
    transcriptPath,
    artifactsPath,
    liveInsights: {
      status: 'idle',
      updatedAt: null,
      error: null,
      jargon: [],
      liveQuestions: [],
      suggestions: [],
    },
    highlights: {
      status: 'idle',
      updatedAt: null,
      error: null,
      summary: '',
      keyDiscussionPoints: [],
      actionItems: [],
    },
    minutesOfMeeting: {
      status: 'idle',
      updatedAt: null,
      error: null,
      content: null,
    },
    quickLook: {
      lastUpdatedAt: null,
      error: null,
      history: [],
    },
    debug: {
      liveAnalysis: [],
      highlights: [],
      minutesOfMeeting: [],
      quickLook: [],
    },
  };
}

async function ensureFile(filePath, seedData) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify(seedData, null, 2), 'utf8');
  }
}

export async function initializeArtifactsFile(filePath, seedData) {
  const initialData = defaultArtifacts(seedData);
  await ensureFile(filePath, initialData);
  return readArtifactsFile(filePath);
}

export async function readArtifactsFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function updateArtifactsFile(filePath, updater) {
  const currentChain = writeChains.get(filePath) || Promise.resolve();
  const nextChain = currentChain.then(async () => {
    const current = await readArtifactsFile(filePath);
    if (!current) {
      throw new Error(`Artifacts file not initialized: ${filePath}`);
    }

    const updated = await updater(current);
    await fs.writeFile(filePath, JSON.stringify(updated, null, 2), 'utf8');
    return updated;
  });

  writeChains.set(filePath, nextChain.catch(() => null));
  return nextChain;
}
