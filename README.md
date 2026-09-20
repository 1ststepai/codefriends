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
│ CodeFriends · N     │  handoff   │ static SPA / PWA         │
└─────────┬───────────┘            └────────────┬─────────────┘
          │ GET /api/presence                   │ HTTP + WebSocket
          └──────────────► API (D1 + hub) ◄─────┘
                           Cloudflare Worker  (prod, $0)
                           or apps/server     (local / Node fallback)
```

| Path | Role |
| --- | --- |
| `apps/popout` | Full dark UI. Static build; production target is **Vercel** (or Cloudflare Pages) |
| `apps/worker` | **$0 production API**: Cloudflare Workers + D1 + Durable Object presence hub |
| `apps/server` | Local Node + `better-sqlite3` (smoke / `npm run dev`). Optional Fly/Render + Turso fallback |
| `packages/core` | Shared store, SQL migrations, auth, HTTP + WS handlers |
| `extensions/cursor` | VS Code-compatible status bar + opt-in **Connect CodeFriends?** prompt — **no chat webview** |
| `plugins/claude` | Claude Code plugin: SessionStart prompt + `/codefriends` (`?provider=claude`) |
| `plugins/codex` | Codex plugin: SessionStart prompt + skill (`?provider=codex`) |
| `plugins/gemini` | Gemini CLI extension: SessionStart prompt + `/codefriends` (`?provider=gemini`) |
| `packages/connect-client` | Tiny local companion CLI used by those plugins (also works for generic/Ollama GUIs) |
| `packages/shared` | Shared TypeScript types, protocol, and connect-prompt policy |

**Out of scope:** voice, Live Share, media/blob storage, payments, guaranteed 2000 simultaneous sockets.

## Persistence

User accounts, **linked provider identities**, friend edges, and 1:1 DM history live in ordinary SQLite SQL (`users`, `identities`, `sessions`, `friends`, `messages`). Presence sockets stay in memory (Node) or a Cloudflare Durable Object (production); `last_seen` / status fields are written back to the database.

| Driver | When | Env |
| --- | --- | --- |
| `better-sqlite3` file | Local `npm run dev` / smoke | `CODEFRIENDS_DB` (default `apps/server/data/codefriends.sqlite`, gitignored) |
| **Cloudflare D1** | **$0 production** (`apps/worker`) | `wrangler.toml` `[[d1_databases]]` |
| Turso / libSQL | Optional Node host with ephemeral disks | `CODEFRIENDS_LIBSQL_URL` + `CODEFRIENDS_LIBSQL_AUTH_TOKEN` |

Schema + named migrations live in `packages/core/src/sql.ts` (including `002_dm_thread_cap`). A process / Worker restart keeps users, identities, friends, and DMs. Seed data (`maya` / `parker` / …) is **idempotent** — inserted only when missing, never wiped.

**DM history cap:** each 1:1 thread keeps the last **200** messages (`CODEFRIENDS_DM_HISTORY_LIMIT`). Older rows are pruned on write. Text only — no media, no blob store.

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

Expected: `smoke ok: maya + parker online, 1:1 DM delivered, history survived restart, identities linked, DM cap pruned`

`test:connect` prints the documented prompt paths (first run, Not now cooldown, Don’t ask again, already connected, host popout URLs).

## HTTP + WebSocket

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | Liveness + online count + `store` (`sqlite` / `libsql` / `d1`) + `dmHistoryLimit` |
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

## $0 deploy (not already live)

Nothing in this repo is pre-hosted. You click through **Vercel** (popout) and **Cloudflare** (API + D1 + WebSockets). No new paid plan is required if you already have a free/Hobby Vercel account; Cloudflare’s free Workers + D1 + Durable Objects tier does not need a second subscription.

**Product shape that keeps it free:** text presence + 1:1 DMs only. No images, voice, or object storage.

**Honest scale:** designed for about **1–2000 registered users** with light concurrent presence. That is **not** a guarantee of 2000 simultaneous sockets. Free-tier request and duration limits will shed load before that.

### What you click

| Where | What to create | Why |
| --- | --- | --- |
| [Cloudflare Dashboard](https://dash.cloudflare.com) → Workers & Pages | A free Workers account (if you do not have one) | Hosts the API + WebSockets |
| Cloudflare → Workers & Pages → D1 | Database named `codefriends` | Durable users / friends / DMs |
| This repo → `apps/worker/wrangler.toml` | Paste the D1 `database_id` | Worker binding |
| Cloudflare → Workers → `codefriends-api` → Settings → Variables | Secrets / vars listed below | Auth + CORS + popout redirect |
| [Vercel](https://vercel.com) → Add New Project | Import this Git repo, **Root Directory = repo root** | Builds `apps/popout` via `vercel.json` |
| Vercel → Project → Settings → Environment Variables | `VITE_CODEFRIENDS_API_URL`, `VITE_CODEFRIENDS_WS_URL` | Baked into the static SPA at **build** time |
| Google Cloud Console (optional) | Web OAuth client | Only if you want Gemini / Google login |

Chicken-and-egg: deploy the Worker first (you get `*.workers.dev`), then deploy the popout with that URL, then set `CODEFRIENDS_POPOUT_URL` on the Worker and redeploy it. Changing Vite env vars later requires a **Vercel Redeploy**.

### 1. Cloudflare API (preferred backend)

From a machine with Node 20+ and a Cloudflare login:

```bash
cd apps/worker
npx wrangler login
npx wrangler d1 create codefriends
```

Copy the printed `database_id` into `apps/worker/wrangler.toml` (replace the all-zero placeholder). Commit that id — it is not a secret.

```bash
# optional local check (uses local D1; copy .dev.vars.example → .dev.vars)
npx wrangler dev

npx wrangler deploy
```

Dashboard clicks after deploy:

1. Workers & Pages → **codefriends-api** → Settings → **Domains** — copy `https://codefriends-api.<subdomain>.workers.dev`.
2. Settings → **Variables and Secrets**:

| Name | Production value | Secret? |
| --- | --- | --- |
| `CODEFRIENDS_PUBLIC_URL` | `https://codefriends-api.<subdomain>.workers.dev` | no |
| `CODEFRIENDS_POPOUT_URL` | `https://<your-app>.vercel.app` (set after step 2) | no |
| `CODEFRIENDS_DEV_LOGIN` | `0` for a public app; `1` only if you accept passwordless usernames on the internet | no |
| `CODEFRIENDS_SEED` | `1` to keep the demo roster; `0` for an empty friends graph | no |
| `CODEFRIENDS_MOCK_PROVIDERS` | `0` | no |
| `CODEFRIENDS_DM_HISTORY_LIMIT` | `200` | no |
| `GEMINI_GOOGLE_CLIENT_ID` / `SECRET` / `CALLBACK_URL` | only if using Google login; callback = `{CODEFRIENDS_PUBLIC_URL}/api/auth/gemini/callback` | secret for the client secret |

`GET https://codefriends-api.<subdomain>.workers.dev/health` should return `{ "ok": true, "store": "d1", ... }`. That endpoint is **not** provisioned for you until you deploy.

### 2. Vercel popout (static SPA)

1. Vercel → **Add New** → Import the GitHub repo.
2. Leave **Root Directory** as the repository root (`vercel.json` already points at `apps/popout/dist`).
3. Framework Preset: **Other**.
4. Settings → Environment Variables (Production):

| Name | Value |
| --- | --- |
| `VITE_CODEFRIENDS_API_URL` | `https://codefriends-api.<subdomain>.workers.dev` |
| `VITE_CODEFRIENDS_WS_URL` | `wss://codefriends-api.<subdomain>.workers.dev/ws` |

5. Deploy. Open the `.vercel.app` URL — you should see the login screen. Sign-in will fail until the Worker URL is reachable and CORS/`CODEFRIENDS_POPOUT_URL` match that origin.
6. Back on Cloudflare, set `CODEFRIENDS_POPOUT_URL` to the Vercel origin and **Deploy** the Worker again.

Alternative: **Cloudflare Pages** on `apps/popout/dist` with the same Vite env vars. `apps/popout/public/_redirects` is the SPA fallback.

### 3. Google OAuth (optional, still $0)

Google Cloud Console → APIs & Services → Credentials → Create OAuth client → **Web application**.

- Authorized JavaScript origins: the Vercel origin.
- Authorized redirect URI: `https://codefriends-api.<subdomain>.workers.dev/api/auth/gemini/callback` (must match `GEMINI_GOOGLE_CALLBACK_URL` exactly).

### 4. After it is up

Point the Cursor/VS Code settings (or `CODEFRIENDS_POPOUT_URL` / `CODEFRIENDS_SERVER_URL` for connect plugins) at the public URLs:

| Setting | Example |
| --- | --- |
| `codefriends.popoutUrl` | `https://<your-app>.vercel.app` |
| `codefriends.serverUrl` | `https://codefriends-api.<subdomain>.workers.dev` |

### Free-tier limits (will move; check the vendor pages)

| Vendor | Typical free cap that matters here | What happens when you exceed it |
| --- | --- | --- |
| **Vercel Hobby** | Static hosting + bandwidth cap | Popout 4xx / paused project — upgrade or wait |
| **Workers requests** | ~100k / day on the free plan | API/WS calls start failing until reset |
| **Durable Objects** | Free-plan request + duration budget (hibernating sockets are cheaper than a hot isolate) | Presence drops; clients reconnect |
| **D1** | ~5M reads / 100k writes / day, ~5 GB | Writes fail; prune + text-only DMs keep this small |
| **Turso Starter** (fallback only) | Free row / storage quota | Node fallback cannot persist |

This is **not** a SLA. A busy evening of reconnect storms can burn the Workers daily budget.

### Node fallback (still $0, worse realtime)

Use only if you already have Fly or Render free allowance. Both often **ask for a credit card** even at $0, machines **sleep**, and a local SQLite file **dies** on recycle.

1. Create a free [Turso](https://turso.tech) database (libSQL). Set `CODEFRIENDS_LIBSQL_URL` + `CODEFRIENDS_LIBSQL_AUTH_TOKEN`.
2. `apps/server/Dockerfile` + root `fly.toml` / `render.yaml` — replace placeholder app names; do not assume they exist.
3. Set `HOST=0.0.0.0`, `CODEFRIENDS_PUBLIC_URL`, `CODEFRIENDS_POPOUT_URL`, `NODE_ENV=production`.
4. Expect WebSockets to drop when the instance sleeps. Prefer `apps/worker`.

### What you do **not** need

- A paid always-on Node VM
- Checking `.env` or OAuth secrets into git
- Blob / media storage
- Postgres (ordinary SQL; D1 / libSQL / SQLite share the same schema)

## Next

- Official Cursor / Claude / Codex identity programs → fill in the existing adapters (thin connect prompts already open the popout)
- Voice and Live Share-style pairing (not this slice)

## License

MIT. See [LICENSE](./LICENSE).
