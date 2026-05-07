import type { PassThruMsg } from "@emdzej/j2534-types";

/**
 * FIFO message queue for buffering received messages.
 */
export class MessageQueue {
  private queue: PassThruMsg[] = [];
  private maxSize: number;

  constructor(maxSize = 1024) {
    this.maxSize = maxSize;
  }

  get length(): number {
    return this.queue.length;
  }

  get isEmpty(): boolean {
    return this.queue.length === 0;
  }

  get isFull(): boolean {
    return this.queue.length >= this.maxSize;
  }

  push(msg: PassThruMsg): boolean {
    if (this.isFull) {
      return false;
    }
    this.queue.push(msg);
    return true;
  }

  pop(): PassThruMsg | undefined {
    return this.queue.shift();
  }

  peek(): PassThruMsg | undefined {
    return this.queue[0];
  }

  clear(): void {
    this.queue = [];
  }

  drain(count: number): PassThruMsg[] {
    return this.queue.splice(0, Math.min(count, this.queue.length));
  }
}
