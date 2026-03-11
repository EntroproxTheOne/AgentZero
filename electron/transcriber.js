import { getDB } from './db.js';

/**
 * Mock function to simulate transcribing an audio/video chunk.
 * In a real application, this would pipe the buffer to Whisper or Deepgram.
 */
export async function transcribeChunk(meetingId, buffer) {
  const db = getDB();
  
  // Simulate network/processing delay
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Create a mock transcript
  const speakers = ['Speaker A', 'Speaker B'];
  const mockText = "This is a simulated transcription of the recorded chunk discussing project updates.";
  const speaker = speakers[Math.floor(Math.random() * speakers.length)];
  const timestamp = Date.now();

  try {
    const stmt = db.prepare('INSERT INTO Transcripts (meeting_id, speaker_label, text, timestamp) VALUES (?, ?, ?, ?)');
    stmt.run(meetingId, speaker, mockText, timestamp);
    console.log(`[Transcription inserted] ${speaker}: ${mockText}`);
  } catch (err) {
    console.error('Error inserting transcript:', err);
  }
}
