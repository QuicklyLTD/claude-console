/**
 * A pushable async iterable. Producers call `push(value)` from anywhere;
 * the iterator yields values in FIFO order. Calling `close()` flushes
 * outstanding consumers with `{done: true}`.
 *
 * Used to feed `@anthropic-ai/claude-agent-sdk.query()` streaming input.
 */
export class PushableQueue<T> implements AsyncIterableIterator<T> {
  private items: T[] = [];
  private waiters: Array<(v: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) return;
    const w = this.waiters.shift();
    if (w) w({ value, done: false });
    else this.items.push(value);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length) {
      this.waiters.shift()!({ value: undefined as unknown as T, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    return this;
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.items.length) return { value: this.items.shift()!, done: false };
    if (this.closed) return { value: undefined as unknown as T, done: true };
    return new Promise<IteratorResult<T>>((r) => this.waiters.push(r));
  }

  async return(): Promise<IteratorResult<T>> {
    this.close();
    return { value: undefined as unknown as T, done: true };
  }

  async throw(err: unknown): Promise<IteratorResult<T>> {
    this.close();
    throw err;
  }
}
