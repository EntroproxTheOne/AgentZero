import fs from 'fs';

export class AsyncChunkWriter {
  constructor(filePath) {
    this.filePath = filePath;
    this.stream = fs.createWriteStream(filePath, { flags: 'a' });
    this.queue = [];
    this.processing = false;
    this.finalizing = false;
    this.idleWaiters = [];
  }

  enqueue(arrayBuffer) {
    if (this.finalizing) {
      throw new Error('Writer is finalizing and cannot accept more chunks');
    }

    const buffer = Buffer.isBuffer(arrayBuffer)
      ? arrayBuffer
      : Buffer.from(arrayBuffer);

    this.queue.push(buffer);
    if (!this.processing) {
      void this.processQueue();
    }
  }

  async waitForIdle() {
    if (!this.processing && this.queue.length === 0) {
      return;
    }

    await new Promise((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  async finalize() {
    this.finalizing = true;
    await this.waitForIdle();

    await new Promise((resolve, reject) => {
      this.stream.once('error', reject);
      this.stream.end(() => resolve());
    });
  }

  async processQueue() {
    this.processing = true;

    while (this.queue.length > 0) {
      const chunk = this.queue.shift();
      const canContinue = this.stream.write(chunk);
      if (!canContinue) {
        await new Promise((resolve, reject) => {
          const handleDrain = () => {
            this.stream.off('error', handleError);
            resolve();
          };
          const handleError = (error) => {
            this.stream.off('drain', handleDrain);
            reject(error);
          };

          this.stream.once('drain', handleDrain);
          this.stream.once('error', handleError);
        });
      }
    }

    this.processing = false;
    const waiters = [...this.idleWaiters];
    this.idleWaiters.length = 0;
    waiters.forEach((resolve) => resolve());
  }
}
