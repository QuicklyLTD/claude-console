/**
 * A pushable async iterable used to feed per-turn events into
 * assistant-ui's ChatModelAdapter.run() async generator.
 *
 * Producer: socket event handler calls `push(ev)` as SDK messages arrive,
 * and `end()` when the turn completes (on SDKResultMessage).
 * Consumer: ChatModelAdapter iterates with `for await`.
 */
export class AsyncEmitter<T> implements AsyncIterableIterator<T> {
  #items: T[] = [];
  #waiters: Array<(v: IteratorResult<T>) => void> = [];
  #closed = false;
  #error: unknown = null;

  push(value: T): void {
    if (this.#closed) return;
    const w = this.#waiters.shift();
    if (w) w({ value, done: false });
    else this.#items.push(value);
  }

  end(): void {
    if (this.#closed) return;
    this.#closed = true;
    while (this.#waiters.length) {
      this.#waiters.shift()!({ value: undefined as unknown as T, done: true });
    }
  }

  fail(err: unknown): void {
    this.#error = err;
    this.end();
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    return this;
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.#items.length) return { value: this.#items.shift()!, done: false };
    if (this.#closed) {
      if (this.#error) throw this.#error;
      return { value: undefined as unknown as T, done: true };
    }
    return new Promise<IteratorResult<T>>((r) => this.#waiters.push(r));
  }

  async return(): Promise<IteratorResult<T>> {
    this.end();
    return { value: undefined as unknown as T, done: true };
  }
}
