/**
 * pcm-processor.js — AudioWorklet processor for dual-channel PCM capture.
 *
 * Accepts two audio inputs:
 *   input[0] = user microphone  (channel 0 in the Deepgram stream)
 *   input[1] = meeting audio    (channel 1 in the Deepgram stream)
 *
 * Accumulates ~250ms of audio at 16 kHz (4000 samples per channel),
 * then interleaves them into a single Int16Array and transfers the
 * ArrayBuffer zero-copy to the renderer via the MessagePort.
 *
 * Interleaved layout: [mic0, mtg0, mic1, mtg1, ... micN, mtgN]
 * This matches linear16 2-channel interleaved PCM expected by Deepgram.
 */

const BATCH_SAMPLES = 4000; // ~250 ms at 16 kHz

class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._micAccum  = new Float32Array(BATCH_SAMPLES);
    this._mtgAccum  = new Float32Array(BATCH_SAMPLES);
    this._count     = 0;
  }

  process(inputs) {
    // inputs[0] = mic node, inputs[1] = meeting node
    const micFrame = inputs[0]?.[0];
    const mtgFrame = inputs[1]?.[0];

    if (!micFrame && !mtgFrame) return true;

    const len = micFrame ? micFrame.length : (mtgFrame ? mtgFrame.length : 128);

    for (let i = 0; i < len; i++) {
      if (this._count >= BATCH_SAMPLES) {
        // Flush: interleave and transfer
        this._flush();
      }
      this._micAccum[this._count] = micFrame ? micFrame[i] : 0;
      this._mtgAccum[this._count] = mtgFrame ? mtgFrame[i] : 0;
      this._count++;
    }

    return true; // keep processor alive
  }

  _flush() {
    const n = this._count;
    const interleaved = new Int16Array(n * 2);
    for (let i = 0; i < n; i++) {
      interleaved[i * 2]     = this._toInt16(this._micAccum[i]);
      interleaved[i * 2 + 1] = this._toInt16(this._mtgAccum[i]);
    }
    const ab = interleaved.buffer;
    this.port.postMessage(ab, [ab]); // zero-copy transfer

    // Reset accumulators
    this._micAccum = new Float32Array(BATCH_SAMPLES);
    this._mtgAccum = new Float32Array(BATCH_SAMPLES);
    this._count    = 0;
  }

  _toInt16(f) {
    const clamped = Math.max(-1, Math.min(1, f));
    return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
