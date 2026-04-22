# Claude Console

Feature-complete, self-hosted web console for Claude Code. Built on:

- **[@anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)** — spawns the real `claude` CLI; abonelik (OAuth) veya API key otomatik kullanılır.
- **[@assistant-ui/react](https://www.npmjs.com/package/@assistant-ui/react)** — olgun chat primitif'leri + markdown.
- **WebSocket** — kalıcı, çift yönlü kanal. Her kullanıcı mesajı *yeni bir CLI süreci* değildir; aynı `query()` akışına item eklenir → prompt cache warm kalır.

## Özellikler (hepsi aktif)

| | |
|---|---|
| ✅ Kalıcı WS + streaming input (`AsyncIterable<SDKUserMessage>`) | `canUseTool` callback'i üstünden gerçek in-browser permission prompt (once/session/project/user scope) |
| ✅ `query.interrupt()` — gerçek mid-stream durdurma | Mid-session `setPermissionMode()` & `setModel()` |
| ✅ Çok-oturum yönetimi + SQLite metadata (title, cwd, model, tags, pinned, toplam cost/turns/token) | Cmd+K session picker, Cmd+N new chat, Esc interrupt |
| ✅ assistant-ui Thread + Composer + Message primitif'leri | Markdown render + GFM (`@assistant-ui/react-markdown`) |
| ✅ Tool call/result: her tool ayrı kart; input + output collapsible, hata rengi | Thinking blokları collapsible |
| ✅ Canlı maliyet / usage / cache_read / cache_create | `rate_limit_event`, `api_retry`, `compact_boundary`, `status` mesajları UI'da ince rozetler olarak |
| ✅ Dosya yedek (file-history) klasör referansı | Oturumu silince SDK JSONL'si de temizlenir |
| ✅ Structured pino logger (`data/logs/server.log`, `error.log`) | Reconnect + sequence replay — tab donsa mesajları kaybetmez |
| ✅ Tailwind + Radix + dark/light tema | Node-only SDK client bundle'ına girmez (Vite `external`) |

## Dizin yapısı

```
claude-console/
├── package.json                 # workspace root (npm workspaces)
├── tsconfig.base.json           # ortak TS base
├── shared/protocol.ts           # WS wire types — server + client
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts             # Express + WebSocketServer
│       ├── config.ts            # env → ServerConfig
│       ├── logger.ts            # pino dual-sink (console + file)
│       ├── pushable-queue.ts    # AsyncIterable pushable queue (SDK input)
│       ├── db.ts                # better-sqlite3 UI metadata
│       ├── agent-session.ts     # SDK query() sarmalayıcı + canUseTool
│       ├── ws-handler.ts        # WS router + reconnect replay + seq
│       └── http-routes.ts       # /api REST
├── client/
│   ├── package.json
│   ├── vite.config.ts           # /api + /ws proxy → server
│   ├── tailwind.config.ts
│   ├── postcss.config.mjs
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── index.css
│       ├── lib/                 # ws, emitter, api, utils
│       ├── store/               # zustand: ui, session, permission
│       ├── hooks/               # useAgentSocket, useKeyboardShortcuts
│       ├── adapter/             # ChatModelAdapter (WS → assistant-ui)
│       └── components/
│           ├── Chat/            # Chat, ToolCallBlock, ThinkingBlock
│           ├── Sidebar/         # Sidebar
│           ├── TopBar/          # TopBar
│           ├── Modals/          # Permission, Session picker, Settings, Elicitation
│           ├── FileHistory/     # FileHistoryPanel
│           ├── layout/          # StatusStrip
│           └── ui/              # shadcn-style primitives (Button, Dialog, …)
└── data/                        # SQLite + log dosyaları (.gitignored)
```

## Çalıştırma

```bash
# 0) claude CLI kurulu ve giriş yapılmış olsun (aboneliği varsa):
npm i -g @anthropic-ai/claude-code
claude auth login

# 1) Bağımlılıkları kur
cd claude-console
npm install

# 2) Dev (iki süreç paralel)
npm run dev
#   server → http://127.0.0.1:5180  +  ws://127.0.0.1:5180/ws
#   client → http://127.0.0.1:5181  (Vite dev server; /api & /ws proxy'li)
# Tarayıcıda: http://127.0.0.1:5181

# 3) Prod build
npm run build
npm start
# Tek süreç, tek port → http://127.0.0.1:5180
```

## Ortam değişkenleri

Kök `.env` (veya `.env.local`). Bkz. `.env.example`:

| Env | Varsayılan | Açıklama |
|---|---|---|
| `PORT` | `5180` | Server HTTP + WS portu |
| `HOST` | `127.0.0.1` | LAN erişimi için `0.0.0.0` |
| `CLAUDE_CWD` | — | Yeni oturumların varsayılan cwd'si |
| `CLAUDE_MODEL` | — | `sonnet` / `opus` / `haiku` / tam id |
| `CLAUDE_PERMISSION_MODE` | `default` | `default` / `acceptEdits` / `plan` / `bypassPermissions` |
| `CLAUDE_ADD_DIRS` | — | `;` ile ayrılmış ek izinli dizinler |
| `CLAUDE_MAX_TURNS` | — | Tek `/send` için agentic turn cap |
| `BRIDGE_TOKEN` | — | Tanımlıysa WS `?token=…` zorunlu |
| `LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error` |
| `ANTHROPIC_API_KEY` | — | Varsa SDK bunu kullanır; yoksa `claude login` (subscription) |

## WS Protokolü

`shared/protocol.ts` dosyası wire tiplerini tutar. Özet:

**Client → Server**

```ts
{ kind: "attach", uiSessionId, resumeSdkSessionId? }
{ kind: "send", text }
{ kind: "permission_decision", requestId, decision: { behavior: "allow"|"deny", scope, updatedInput?, message?, updatedPermissions? } }
{ kind: "interrupt" }
{ kind: "set_permission_mode", mode }
{ kind: "set_model", model }
{ kind: "apply_settings", settings }
{ kind: "ping", ts }
```

**Server → Client** (hepsi `seq: number` içerir — reconnect replay için)

```ts
{ kind: "bridge", event: "attached"|"started"|"ended"|"interrupted"|"error"|"stderr"|"reconnect_replay_start"|"reconnect_replay_end", ... }
{ kind: "sdk", message: SDKMessage }                     // ham SDK mesajı
{ kind: "permission_request", requestId, toolName, input, title, description, decisionReason, blockedPath, suggestions, ... }
{ kind: "cost_update", uiSessionId, turnCostUsd, turnDurationMs, turnTokens, sessionTotal }
{ kind: "pong", ts }
```

## Mimari kararlar

1. **Persistent `query()` + streaming input** — her prompt için yeni CLI spawn etmek yerine tek uzun ömürlü `query()`'ye `AsyncIterable` ile kullanıcı mesajları itiliyor. Prompt cache warm kalır (~10-15× daha ucuz uzun konuşmada). Control metotları (interrupt, setMode, setModel) yalnızca bu modda çalışır.
2. **Gerçek `canUseTool`** — browser'a `permission_request` WS frame'i gidiyor, UI modal açıyor, `permission_decision` geri geliyor → SDK'nın `Promise<PermissionResult>` çözüyor. `bypassPermissions` ile sessizce her şeye izin vermiyoruz.
3. **SDK JSONL tek kanonik geçmiş kaynağı** — UI tarafında ayrıca mesajları kopyalamıyoruz; sadece metadata (title, cwd, toplam cost/turn) SQLite'ta.
4. **SDK sadece sunucuda** — `@anthropic-ai/claude-agent-sdk`'nin runtime'ı Node-only (`child_process`, `better-sqlite3`). Vite config'inde `external: ["@anthropic-ai/claude-agent-sdk"]` ile client bundle'ına sızmıyor; client sadece *type* kullanıyor.
5. **Reconnect + sequence** — server her giden mesaja artan `seq` koyuyor ve son 500 frame'i cep buffer'da tutuyor. Client kopup açılırsa `?fromSeq=N` ile kaldığı yerden replay alır.
6. **Structured log** — pino + dual-sink: console (pretty) + `data/logs/server.log` (combined) + `data/logs/error.log` (yalnız hatalar). Daha önceki projelerde eksikti.
7. **Kısayol odaklı UX** — Cmd+K session picker, Cmd+N new, Cmd+\ sidebar, Cmd+, settings, Esc interrupt.

## Lisanslar

- Claude Agent SDK: Anthropic PBC (SDK README).
- assistant-ui: MIT.
- Kod: projenin kendisi MIT benzeri, istediğiniz lisansla kullanabilirsiniz.
