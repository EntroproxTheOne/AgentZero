const BATCH_SAMPLES = 4000;

class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.micAccum = new Float32Array(BATCH_SAMPLES);
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
    // Down-mix every channel to mono: computer sound is often stereo, and a voice
    // panned to one side must not be lost.
    const channels = inputs[0];
    if (!channels || channels.length === 0 || !channels[0]) {
      return true;
    }

    const channelCount = channels.length;
    const frameLength = channels[0].length;

    for (let index = 0; index < frameLength; index += 1) {
      if (this.sampleCount >= BATCH_SAMPLES) {
        this.flush();
      }

      let sum = 0;
      for (let channel = 0; channel < channelCount; channel += 1) {
        sum += channels[channel][index];
      }
      this.micAccum[this.sampleCount] = sum / channelCount;
      this.sampleCount += 1;
    }

    return true;
  }

  flush() {
    const pcm = new Int16Array(this.sampleCount);

    for (let index = 0; index < this.sampleCount; index += 1) {
      pcm[index] = this.toInt16(this.micAccum[index]);
    }

    const buffer = pcm.buffer;
    this.port.postMessage({ type: 'audio-chunk', buffer }, [buffer]);

    this.micAccum = new Float32Array(BATCH_SAMPLES);
    this.sampleCount = 0;
  }

  toInt16(value) {
    const clamped = Math.max(-1, Math.min(1, value));
    return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
