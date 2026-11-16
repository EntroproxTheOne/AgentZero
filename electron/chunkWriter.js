import fs from 'fs';

/**
 * Appends recording chunks to a file in order. A write failure (disk full,
 * permissions, drive removed) never throws out of here: it is recorded in
 * `failure`, reported once through `onError`, later chunks are dropped, and
 * everything written before the failure stays on disk for recovery.
 */
export class AsyncChunkWriter {
  constructor(filePath, { onError } = {}) {
    this.filePath = filePath;
    this.onError = onError;
    this.failure = null;
    this.queue = [];
    this.processing = false;
    this.finalizing = false;
    this.idleWaiters = [];
    this.stream = fs.createWriteStream(filePath, { flags: 'a' });
    // Permanent handler: an 'error' event with no listener would crash Electron.
    this.stream.on('error', (error) => this.fail(error));
  }

  fail(error) {
    if (this.failure) return;
    this.failure = error;
    this.queue.length = 0;
    console.error(`[ChunkWriter] Writing ${this.filePath} failed:`, error.message);
    try {
      this.onError?.(error);
    } catch {
      // A broken listener must not take the writer down with it.
    }
    this.releaseWaiters();
  }

  enqueue(arrayBuffer) {
    if (this.finalizing || this.failure) return;
    const buffer = Buffer.isBuffer(arrayBuffer) ? arrayBuffer : Buffer.from(arrayBuffer);
    this.queue.push(buffer);
    if (!this.processing) {
      void this.processQueue();
    }
  }

  async waitForIdle() {
    if (!this.processing && this.queue.length === 0) return;
    await new Promise((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  /** Flush and close. Resolves even after a failure (check `failure`). */
  async finalize() {
    this.finalizing = true;
    await this.waitForIdle();
    if (this.stream.destroyed || this.stream.writableEnded) return;
    await new Promise((resolve) => {
      const done = () => resolve();
      this.stream.once('error', done);
      this.stream.end(done);
    });
  }

  async processQueue() {
    this.processing = true;
    while (this.queue.length > 0 && !this.failure) {
      const chunk = this.queue.shift();
      let canContinue = true;
      try {
        canContinue = this.stream.write(chunk);
      } catch (error) {
        this.fail(error);
        break;
      }
      if (!canContinue && !this.failure) {
        await new Promise((resolve) => {
          const finish = () => {
            this.stream.off('drain', finish);
            this.stream.off('error', finish);
            this.stream.off('close', finish);
            resolve();
          };
          this.stream.once('drain', finish);
          this.stream.once('error', finish);
          this.stream.once('close', finish);
        });
      }
    }
    this.processing = false;
    this.releaseWaiters();
  }

  releaseWaiters() {
    if (this.processing) return;
    const waiters = [...this.idleWaiters];
    this.idleWaiters.length = 0;
    waiters.forEach((resolve) => resolve());
  }
}
