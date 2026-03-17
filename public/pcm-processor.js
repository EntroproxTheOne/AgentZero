const BATCH_SAMPLES = 4000;

class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.micAccum = new Float32Array(BATCH_SAMPLES);
    this.meetingAccum = new Float32Array(BATCH_SAMPLES);
    this.sampleCount = 0;

    this.port.onmessage = (event) => {
      if (event.data?.type === 'flush') {
        if (this.sampleCount > 0) {
          this.flush();
        }
        this.port.postMessage({ type: 'flush-complete' });
      }
    };
  }

  process(inputs) {
    const micFrame = inputs[0]?.[0];
    const meetingFrame = inputs[1]?.[0];

    if (!micFrame && !meetingFrame) {
      return true;
    }

    const frameLength = micFrame ? micFrame.length : (meetingFrame ? meetingFrame.length : 128);

    for (let index = 0; index < frameLength; index += 1) {
      if (this.sampleCount >= BATCH_SAMPLES) {
        this.flush();
      }

      this.micAccum[this.sampleCount] = micFrame ? micFrame[index] : 0;
      this.meetingAccum[this.sampleCount] = meetingFrame ? meetingFrame[index] : 0;
      this.sampleCount += 1;
    }

    return true;
  }

  flush() {
    const interleaved = new Int16Array(this.sampleCount * 2);

    for (let index = 0; index < this.sampleCount; index += 1) {
      interleaved[index * 2] = this.toInt16(this.micAccum[index]);
      interleaved[index * 2 + 1] = this.toInt16(this.meetingAccum[index]);
    }

    const buffer = interleaved.buffer;
    this.port.postMessage({ type: 'audio-chunk', buffer }, [buffer]);

    this.micAccum = new Float32Array(BATCH_SAMPLES);
    this.meetingAccum = new Float32Array(BATCH_SAMPLES);
    this.sampleCount = 0;
  }

  toInt16(value) {
    const clamped = Math.max(-1, Math.min(1, value));
    return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
