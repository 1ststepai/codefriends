# CodeFriends

Steam Friends–style social layer for people using **Cursor / Claude / Codex / Gemini**.

Friends list, online presence, status text, and click-to-DM — all in a **lightweight popout window / PWA**. The IDE only gets a thin status-bar badge so chat does not burn editor RAM.

> **Not affiliated with Cursor, Anthropic, OpenAI, or Google.** This is an independent community project. “Steam Friends–style” is a UX description, not a Steam or Valve product.

## Architecture

```
IDE (thin)                         Outside the IDE
┌─────────────────────┐            ┌──────────────────────────┐
│ Cursor / VS Code    │  open URL  │ apps/popout (Vite/React) │
│ status bar:         │ ─────────► │ friends + presence + DMs │
│ CodeFriends · N     │            │ installable as a PWA     │
└─────────┬───────────┘            └────────────┬─────────────┘
          │ GET /api/presence                   │ HTTP + WebSocket
          └──────────────► apps/server ◄────────┘
```

| Path | Role |
| --- | --- |
| `apps/server` | Auth, friend graph, presence, 1:1 DMs over WebSocket |
| `apps/popout` | Full dark UI (the thing in the concept mockup) |
| `extensions/cursor` | Status bar + “Open popout” — **no chat webview** |
| `packages/shared` | Shared TypeScript types and protocol |

**Out of scope for v0:** native Claude / Codex / Gemini extensions, voice, Live Share, payments.

## Auth (local demo)

**Username login.** `POST /api/auth/login { "username": "maya" }` creates the user on first use and returns a bearer token. No password. This is for local / trusted-network demos only.

GitHub OAuth is the obvious next auth path; it is not wired in v0 so a laptop demo works without registering an OAuth app.

A seed roster is loaded unless `CODEFRIENDS_SEED=0`:

`maya` · `devjay` · `sam` · `rio` · `alex` · `casey` · `taylor` · `jordan` · `parker`

They are already friends. Seed DMs exist between `maya` and `parker` so the popout matches the concept panel on first open.

## Local run

Needs Node 20+.

```bash
npm install
npm run dev
```

- API + WebSocket: <http://127.0.0.1:8787>
- Popout UI: <http://127.0.0.1:5173> (proxies `/api` and `/ws` to the server)

Open the popout in two browser profiles (or a window + a private window). Sign in as `maya` in one and `parker` in the other. Click a friend to DM. Presence and messages are live.

To install as a PWA, open the popout in Chrome / Edge and use **Install app** / **Add to dock**. That is the intended “lightweight window.”

### Cursor / VS Code extension

```bash
npm run compile -w codefriends
```

Then in Cursor/VS Code: **Extensions → Install from Location…** (or `Developer: Install Extension from Location…`) and pick `extensions/cursor`.

Or launch an Extension Development Host:

1. Open this repo
2. File → Open Folder → `extensions/cursor`
3. Run **Debug: Start Debugging** (F5)

The status bar shows `CodeFriends · N online` (or `offline` if the server is down). Click it, or run **CodeFriends: Open popout**, to focus the popout URL. Settings:

| Setting | Default |
| --- | --- |
| `codefriends.popoutUrl` | `http://127.0.0.1:5173` |
| `codefriends.serverUrl` | `http://127.0.0.1:8787` |
| `codefriends.pollMs` | `15000` |

The extension **does not** embed friends/chat in a webview.

## Smoke test

Proves two users can go online and exchange a 1:1 DM. Starts an ephemeral server; nothing else needs to be running.

```bash
npm run smoke
```

Expected: `smoke ok: maya + parker online, 1:1 DM delivered`

## HTTP + WebSocket

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | Liveness + online count |
| `POST` | `/api/auth/login` | `{ username, displayName? }` → `{ token, user }` |
| `GET` | `/api/me` | Bearer token |
| `GET` / `POST` | `/api/friends` | List / add by username |
| `GET` | `/api/messages?with=` | History |
| `GET` | `/api/presence` | Public online count (status bar) |
| `WS` | `/ws?token=` | `hello`, `presence`, `add_friend`, `dm`, `typing` |

Server state is in-memory. Restart wipes sessions and demo seed is re-applied.

## Next

- Thin native extensions for Claude / Codex / Gemini (same popout URL)
- GitHub OAuth
- Durable store (SQLite / Postgres)
- Voice and Live Share-style pairing (not v0)

## License

MIT. See [LICENSE](./LICENSE).
