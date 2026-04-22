import type { ClientMessage, ServerMessage } from "@shared/protocol";

type Listener = (msg: ServerMessage) => void;
type StatusListener = (status: WsStatus) => void;

export type WsStatus = "connecting" | "open" | "closed" | "error";

export interface ConsoleSocketOptions {
  /** `/ws` is appended automatically. */
  baseUrl?: string;
  /** Token appended to WS URL as `?token=...`. */
  token?: string | null;
  /** Reconnect backoff cap (ms). */
  maxReconnectDelay?: number;
  /** Max messages queued while offline; oldest are dropped. */
  maxQueued?: number;
}

/**
 * Persistent WebSocket with:
 *   - Auto-reconnect w/ exponential backoff
 *   - Sequence-number tracked replay (?fromSeq=N on reconnect)
 *   - Listener fan-out (status + message)
 *   - JSON framing
 */
export class ConsoleSocket {
  #ws: WebSocket | null = null;
  #status: WsStatus = "closed";
  #listeners = new Set<Listener>();
  #statusListeners = new Set<StatusListener>();
  #reconnectAttempt = 0;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #closedByUser = false;
  #lastSeq = 0;
  #queuedOutgoing: ClientMessage[] = [];

  constructor(private readonly opts: ConsoleSocketOptions = {}) {}

  connect(): void {
    this.#closedByUser = false;
    this.#open();
  }

  close(): void {
    this.#closedByUser = true;
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#ws?.close();
  }

  send(msg: ClientMessage): void {
    if (this.#ws?.readyState === WebSocket.OPEN) {
      this.#ws.send(JSON.stringify(msg));
    } else {
      // Buffer until open. Cap to avoid unbounded growth during long outages;
      // drop oldest messages first (newest reflect current user intent).
      const cap = this.opts.maxQueued ?? 50;
      this.#queuedOutgoing.push(msg);
      while (this.#queuedOutgoing.length > cap) this.#queuedOutgoing.shift();
    }
  }

  on(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.#statusListeners.add(listener);
    listener(this.#status);
    return () => this.#statusListeners.delete(listener);
  }

  get status(): WsStatus { return this.#status; }
  get lastSeq(): number { return this.#lastSeq; }

  #setStatus(s: WsStatus): void {
    this.#status = s;
    for (const l of this.#statusListeners) l(s);
  }

  #open(): void {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const base = this.opts.baseUrl ?? `${proto}//${window.location.host}`;
    const params = new URLSearchParams();
    if (this.opts.token) params.set("token", this.opts.token);
    if (this.#lastSeq > 0) params.set("fromSeq", String(this.#lastSeq));
    const qs = params.toString();
    const url = `${base}/ws${qs ? `?${qs}` : ""}`;

    this.#setStatus("connecting");
    const ws = new WebSocket(url);
    this.#ws = ws;

    ws.addEventListener("open", () => {
      this.#reconnectAttempt = 0;
      this.#setStatus("open");
      // Flush queue.
      for (const m of this.#queuedOutgoing.splice(0)) ws.send(JSON.stringify(m));
    });

    ws.addEventListener("message", (ev) => {
      let parsed: ServerMessage;
      try { parsed = JSON.parse(ev.data as string) as ServerMessage; } catch { return; }
      if (typeof (parsed as { seq?: unknown }).seq === "number") {
        this.#lastSeq = Math.max(this.#lastSeq, parsed.seq);
      }
      for (const l of this.#listeners) l(parsed);
    });

    ws.addEventListener("error", () => this.#setStatus("error"));
    ws.addEventListener("close", () => {
      this.#setStatus("closed");
      this.#ws = null;
      if (!this.#closedByUser) this.#scheduleReconnect();
    });
  }

  #scheduleReconnect(): void {
    this.#reconnectAttempt += 1;
    const cap = this.opts.maxReconnectDelay ?? 10_000;
    const delay = Math.min(cap, 500 * 2 ** (this.#reconnectAttempt - 1)) + Math.random() * 300;
    this.#reconnectTimer = setTimeout(() => this.#open(), delay);
  }
}
