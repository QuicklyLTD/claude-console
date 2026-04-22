import type {
  ConfigDTO,
  CreateSessionRequest,
  SessionDetail,
  UISessionRow,
} from "@shared/protocol";

/* ---------------- auth ---------------------------------------------------- */

let _token: string | null = null;

/** Set once at app bootstrap with the token read from sessionStorage / URL. */
export function setApiToken(t: string | null): void {
  _token = t;
}

function authHeaders(): HeadersInit {
  return _token ? { "X-Bridge-Token": _token } : {};
}
function jsonHeaders(): HeadersInit {
  return { ...authHeaders(), "Content-Type": "application/json" };
}

/* ---------------- core ---------------------------------------------------- */

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}

export const api = {
  async config(): Promise<ConfigDTO> {
    return j<ConfigDTO>(await fetch("/api/config", { headers: authHeaders() }));
  },
  async listSessions(): Promise<{ sessions: UISessionRow[] }> {
    return j<{ sessions: UISessionRow[] }>(await fetch("/api/sessions", { headers: authHeaders() }));
  },
  async createSession(input: CreateSessionRequest = {}): Promise<{ session: UISessionRow }> {
    const r = await fetch("/api/sessions", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(input),
    });
    return j<{ session: UISessionRow }>(r);
  },
  async getSession(id: string): Promise<SessionDetail> {
    return j<SessionDetail>(
      await fetch(`/api/sessions/${encodeURIComponent(id)}`, { headers: authHeaders() }),
    );
  },
  async patchSession(id: string, patch: Partial<UISessionRow>): Promise<{ session: UISessionRow }> {
    const r = await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify(patch),
    });
    return j<{ session: UISessionRow }>(r);
  },
  async deleteSession(id: string): Promise<{ ok: true }> {
    return j<{ ok: true }>(
      await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: authHeaders(),
      }),
    );
  },
  async listSdkSessions(dir?: string): Promise<{ dir: string | null; sessions: unknown[] }> {
    const u = `/api/sdk-sessions${dir ? `?dir=${encodeURIComponent(dir)}` : ""}`;
    return j<{ dir: string | null; sessions: unknown[] }>(
      await fetch(u, { headers: authHeaders() }),
    );
  },
};
