// ffmpeg helpers (bundled ffmpeg-static). Arguments are passed as an array,
// never through a shell, so file names with spaces or quotes are safe.
import { execFile } from 'child_process';
import { app } from 'electron';
import ffmpegPath from 'ffmpeg-static';

export function ffmpegBinary() {
  return app.isPackaged ? ffmpegPath.replace('app.asar', 'app.asar.unpacked') : ffmpegPath;
}

function runFfmpeg(args, { timeoutMs = 30 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegBinary(), ['-hide_banner', ...args], { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const tail = String(stderr || '').trim().split('\n').slice(-3).join(' ');
        const failure = new Error(`ffmpeg failed: ${tail || error.message}`);
        failure.stderr = String(stderr || ''); // full banner, used for probing
        reject(failure);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

/** Media info from ffmpeg's stderr banner: duration and whether there is video/audio. */
export async function probeMedia(filePath) {
  let stderr = '';
  try {
    await runFfmpeg(['-i', filePath], { timeoutMs: 60_000 });
  } catch (error) {
    // `ffmpeg -i` with no output always "fails"; the banner is in stderr.
    stderr = error.stderr || error.message;
  }
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const durationSeconds = match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
  return {
    durationSeconds,
    hasVideo: /Stream #\S+.*Video:/.test(stderr) && !/Video:\s*(mjpeg|png)/.test(stderr),
    hasAudio: /Stream #\S+.*Audio:/.test(stderr),
  };
}

/** Any audio/video file -> mono 16 kHz MP3 (small upload, fine for speech). */
export function extractSpeechMp3(inputPath, outputPath) {
  return runFfmpeg(['-y', '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k', outputPath]);
}

/** Raw PCM s16le 16 kHz mono (live mic capture) -> MP3. */
export function pcmToMp3(pcmPath, outputPath) {
  return runFfmpeg(['-y', '-f', 's16le', '-ar', '16000', '-ac', '1', '-i', pcmPath, '-c:a', 'libmp3lame', '-b:a', '48k', outputPath]);
}

/**
 * Screen recording -> MP4 (H.264 + AAC) that QuickTime, Finder preview and
 * Windows all play. H.264 input is copied (fast); anything else is re-encoded.
 */
export async function finalizeVideoMp4(inputPath, outputPath) {
  let banner = '';
  try {
    await runFfmpeg(['-i', inputPath], { timeoutMs: 60_000 });
  } catch (error) {
    banner = error.stderr || error.message;
  }
  const isH264 = /Video:\s*h264/.test(banner);
  const hasAudio = /Stream #\S+.*Audio:/.test(banner);
  const video = isH264 ? ['-c:v', 'copy'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p'];
  const audio = hasAudio ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an'];
  return runFfmpeg(['-y', '-i', inputPath, ...video, ...audio, '-movflags', '+faststart', outputPath], { timeoutMs: 3 * 60 * 60 * 1000 });
}
