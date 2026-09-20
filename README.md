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
│ CodeFriends · N     │  handoff   │ installable as a PWA     │
└─────────┬───────────┘            └────────────┬─────────────┘
          │ GET /api/presence                   │ HTTP + WebSocket
          └──────────────► apps/server ◄────────┘
                           SQLite + sessions
```

| Path | Role |
| --- | --- |
| `apps/server` | Multi-provider identity, friend graph, presence, 1:1 DMs over WebSocket |
| `apps/popout` | Full dark UI (the thing in the concept mockup) |
| `extensions/cursor` | VS Code-compatible status bar + opt-in **Connect CodeFriends?** prompt — **no chat webview** |
| `plugins/claude` | Claude Code plugin: SessionStart prompt + `/codefriends` (`?provider=claude`) |
| `plugins/codex` | Codex plugin: SessionStart prompt + skill (`?provider=codex`) |
| `plugins/gemini` | Gemini CLI extension: SessionStart prompt + `/codefriends` (`?provider=gemini`) |
| `packages/connect-client` | Tiny local companion CLI used by those plugins (also works for generic/Ollama GUIs) |
| `packages/shared` | Shared TypeScript types, protocol, and connect-prompt policy |

**Out of scope for this slice:** native Claude / Codex / Gemini extensions, voice, Live Share, payments, a public cloud deploy.

## Persistence

User accounts, **linked provider identities**, friend edges, and 1:1 DM history live in **SQLite** (`better-sqlite3`). Presence sockets stay in memory; `last_seen` / status fields are written back to the database.

| Item | Default |
| --- | --- |
| File | `apps/server/data/codefriends.sqlite` (gitignored) |
| Override | `CODEFRIENDS_DB=/absolute/or/relative/path.sqlite` |
| Schema | `apps/server/src/db/sqlite.ts` (named migrations) |

A process restart keeps users, identities, friends, and DMs. Seed data (`maya` / `parker` / …) is **idempotent** — it is inserted only when missing, never wiped.

**Why SQLite:** one file, no extra daemon, fine for a laptop demo and an early single-node deploy. The SQL is ordinary (`users`, `identities`, `sessions`, `friends`, `messages`). Moving to Postgres later means swapping `apps/server/src/db/sqlite.ts` for a `pg` driver and keeping the same table names — do not sprinkle sqlite-only APIs outside that module.

Sessions are random 32-byte bearer tokens; only a SHA-256 hash is stored. There are **no passwords**. One-time **handoff** codes (also hashed, ~2 minutes) let the Cursor extension open the popout already signed in.

## Auth: provider-native identity

CodeFriends users are **not** “Sign in with GitHub.” A person signs in with the account they already use in a coding tool. The same human can appear **once** in the friends graph after linking Cursor + Claude (or any pair) onto one CodeFriends user id.

```
identities (provider, subject)  ──►  users.id
     cursor  /  claude  /  codex  /  gemini  /  dev
```

- **Login** with a provider identity finds that row, or creates a user.
- **Link** (already signed in, then complete another provider) attaches a second `(provider, subject)` to the same user.
- Identities are never auto-merged by email. Linking is explicit.
- GitHub is **not** a login provider. If it appears later, it would only be optional linking.

### Provider status (honest)

| Provider | Product account | Status | What is actually possible |
| --- | --- | --- | --- |
| **Gemini** | Gemini via **Google account** | **Implemented** (Sign in with Google / OIDC + PKCE) | Public, registerable OAuth client. Button is `live` once env vars are set; otherwise `unconfigured`. |
| **Cursor** | Cursor account | **Blocked** | No public “Sign in with Cursor” identity API. Cursor’s OAuth support is MCP-outbound (the IDE talking to *your* server), not Cursor account identity for a third-party app. |
| **Claude** | Claude.ai / Anthropic | **Blocked** | No public third-party identity OAuth. Consumer OAuth tokens are reserved for Claude.ai / Claude Code; using them in other products violates Anthropic’s terms. |
| **Codex** | ChatGPT / Codex | **Blocked** | “Sign in with ChatGPT” is a real identity product but **partner-only** (no self-serve app registration). Codex CLI OAuth is first-party — do not impersonate that client. |
| **Dev username** | local demo | **Dev only** | `POST /api/auth/login { "username": "maya" }` — no password. On when `NODE_ENV` is not `production`, or `CODEFRIENDS_DEV_LOGIN=1`. |

Each blocked provider still has a **typed adapter** (`start` / `complete` when an official program exists). `GET /api/auth/providers` returns the same catalog the popout renders — including `blockedReason` and `nextStep`.

`CODEFRIENDS_MOCK_PROVIDERS=1` enables `POST /api/auth/:provider/mock { "subject": "…" }` so smoke tests and architecture demos can exercise linking **without pretending the official login works**.

### Gemini / Google env (production-shaped login)

Gemini consumer identity **is** a Google account. Create a Google Cloud **Web** OAuth client and set:

| Variable | Purpose |
| --- | --- |
| `GEMINI_GOOGLE_CLIENT_ID` | OAuth client id |
| `GEMINI_GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `GEMINI_GOOGLE_CALLBACK_URL` | Must match the console redirect URI, default `http://127.0.0.1:8787/api/auth/gemini/callback` |
| `CODEFRIENDS_PUBLIC_URL` | Server origin used to build callbacks if the Gemini callback env is omitted |
| `CODEFRIENDS_POPOUT_URL` | Where the OAuth callback sends the browser (`?handoff=`) |

Copy [`.env.example`](./.env.example) to `.env`. **Do not commit secrets.**

### Dev username path (local demo / smoke)

No OAuth app required. First login creates the user. Seed roster (unless `CODEFRIENDS_SEED=0`):

`maya` · `devjay` · `sam` · `rio` · `alex` · `casey` · `taylor` · `jordan` · `parker`

They are already friends. Seed DMs exist between `maya` and `parker`.

In production (`NODE_ENV=production`) this path is **off** unless you explicitly set `CODEFRIENDS_DEV_LOGIN=1`.

## Local run

Needs Node 20+ (Node 22 used in CI-ish environments).

```bash
cp .env.example .env   # optional; defaults work for the username demo
npm install
npm run dev
```

- API + WebSocket: <http://127.0.0.1:8787>
- Popout UI: <http://127.0.0.1:5173> (proxies `/api` and `/ws` to the server)
- SQLite file: `apps/server/data/codefriends.sqlite`

Open the popout in two browser profiles (or a window + a private window). Sign in as `maya` in one and `parker` in the other. Click a friend to DM. Presence and messages are live. Restart the server: the same users and DMs are still there.

To fill **Agents online** the way the concept mockup does (without a second human), keep the seed agent sockets alive:

```bash
npm run demo:agents
```

To install as a PWA, open the popout in Chrome / Edge and use **Install app** / **Add to dock**.

### Cursor / VS Code extension (opt-in, not Cursor’s login screen)

```bash
npm run compile -w codefriends
```

Then in Cursor, VS Code, or VSCodium: **Extensions → Install from Location…** and pick `extensions/cursor`.

This is an **extension** prompt. We cannot inject into Cursor’s native account login screen, and we do not claim Cursor SSO.

On activate (when there is no stored CodeFriends session), the extension shows **Connect CodeFriends?** with:

| Action | What happens |
| --- | --- |
| **Connect** | Opens/focuses the popout (`?provider=cursor` in Cursor, or `?provider=generic` in VSCodium / vanilla VS Code) and session handoff if this editor already has a token |
| **Not now** | Writes a 3-day snooze to extension `globalState`; asks again later |
| **Don’t ask again** | Persists in `globalState`; never auto-prompts |

If SecretStorage already has a CodeFriends token, the prompt is skipped. The status bar stays `CodeFriends · N online` (a quiet `$(check)` when connected). Click it, or run **CodeFriends: Open popout**.

| Setting / command | Default / notes |
| --- | --- |
| `codefriends.popoutUrl` | `http://127.0.0.1:5173` |
| `codefriends.serverUrl` | `http://127.0.0.1:8787` |
| `codefriends.pollMs` | `15000` |
| `codefriends.provider` | `auto` — Cursor app → `cursor`, otherwise `generic` |
| `codefriends.connectPrompt` | `true` — set `false` to suppress the startup prompt |
| **CodeFriends: Sign in with username (dev)** | Stores a token in SecretStorage; used only for the local demo |
| **CodeFriends: Sign out of this editor** | Clears that token |

The extension **does not** embed friends/chat in a webview.

### Other hosts (same popout, thin plugins)

Same UX idea: when someone is already in that app, ask if they also want CodeFriends. Social features stay in the popout + server.

| Host | Install | Opens popout with | Identity it can actually do | What it cannot do |
| --- | --- | --- | --- | --- |
| **Cursor** | `extensions/cursor` | `?provider=cursor` | Extension opt-in + optional stored session handoff | Cursor account SSO |
| **VS Code / VSCodium / Continue-style** | same `extensions/cursor` (`provider=generic`) | `?provider=generic` | CodeFriends identity (dev username / Gemini Google) | “Login with VS Code” |
| **Claude Code** | `plugins/claude` (`claude plugin marketplace add` this repo, or `--plugin-dir plugins/claude`) | `?provider=claude` | SessionStart notice + `/codefriends` / `/codefriends-not-now` / `/codefriends-never` | Claude.ai / Claude Code OAuth |
| **Codex** | `plugins/codex` (repo marketplace `.agents/plugins/marketplace.json`) | `?provider=codex` | SessionStart notice + `codefriends` skill | Sign in with ChatGPT (partner-only) |
| **Gemini CLI** | `gemini extensions install ./plugins/gemini` | `?provider=gemini` | SessionStart notice + `/codefriends`; **Sign in with Google** in the popout when `GEMINI_GOOGLE_*` is set | Replacing Gemini CLI’s own login |
| **Ollama / Open WebUI / SillyTavern / any GUI** | Browser popout, or the VS Code extension, or `node packages/connect-client/connect.mjs --provider generic --prompt` | `?provider=generic` (alias of local CodeFriends identity, not `dev` SSO) | Opt-in CodeFriends username / Google | **No** “login with Ollama.” Ollama has no account SSO |

CLI plugins persist **Not now** / **Don’t ask again** per host in `~/.codefriends/connect-state.json`. A stored `sessionToken` there (or SecretStorage in the VS Code extension) skips the nag.

```bash
# Generic companion (also what the host plugins run)
node packages/connect-client/connect.mjs --provider generic --prompt
node packages/connect-client/connect.mjs --provider claude --action connect
```

Prompt-path checks (first run, dismiss, don’t ask again, already connected):

```bash
npm run test:connect
```

## Smoke test

Proves two users can go online, exchange a 1:1 DM, **and that history is still there after a server restart**. Also exercises mock provider linking (one CodeFriends user, Cursor + Claude subjects). Starts an ephemeral server with a temp SQLite file.

```bash
npm run smoke
npm run test:connect
```

Expected: `smoke ok: maya + parker online, 1:1 DM delivered, history survived restart, identities linked`

`test:connect` prints the documented prompt paths (first run, Not now cooldown, Don’t ask again, already connected, host popout URLs).

## HTTP + WebSocket

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | Liveness + online count + `store: "sqlite"` |
| `GET` | `/api/auth/providers` | Catalog: live / unconfigured / blocked / dev / mock |
| `POST` | `/api/auth/login` | Dev only. `{ username, displayName?, client? }` → `{ token, user }` |
| `GET` | `/api/auth/gemini/start` | Google OIDC (needs env). `?link=1&token=` to attach to the current user |
| `GET` | `/api/auth/gemini/callback` | Exchanges the code, then redirects to the popout with `?handoff=` |
| `GET` | `/api/auth/:provider/start` | Cursor / Claude / Codex return **501** with the blocked reason |
| `POST` | `/api/auth/:provider/mock` | Only if `CODEFRIENDS_MOCK_PROVIDERS=1`. `{ subject }` |
| `POST` | `/api/auth/handoff` | Bearer → one-time popout code |
| `POST` | `/api/auth/handoff/redeem` | `{ code }` → `{ token, user }` |
| `POST` | `/api/auth/logout` | Revokes that bearer token |
| `GET` | `/api/me` | User + friends + linked identities |
| `GET` / `POST` | `/api/friends` | List / add by username |
| `GET` | `/api/messages?with=` | History |
| `GET` | `/api/presence` | Public online count (status bar) |
| `WS` | `/ws?token=` | `hello`, `presence`, `add_friend`, `dm`, `typing` (unchanged) |

## Deploy notes (not done here)

Run `apps/server` on a single VM with a durable disk for the SQLite file (or set `CODEFRIENDS_DB`). Put TLS in front. Set `NODE_ENV=production`, configure Gemini/Google OAuth redirect URLs for the public origin, and leave `CODEFRIENDS_DEV_LOGIN` / `CODEFRIENDS_MOCK_PROVIDERS` off. Postgres is the later scale step, not a requirement to leave localhost.

## Next

- Official Cursor / Claude / Codex identity programs → fill in the existing adapters (thin connect prompts already open the popout)
- Voice and Live Share-style pairing (not this slice)

## License

MIT. See [LICENSE](./LICENSE).
