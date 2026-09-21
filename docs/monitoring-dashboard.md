# Monitoring dashboard (spec only)

Status: **not implemented**. This document is the product and engineering spec for a later PR. It does not add routes, pages, or scripts.

Audience: whoever next changes `apps/server` on the Windows self-host that serves [https://codefriends.1ststep.ai](https://codefriends.1ststep.ai).

Verified 2026-09-21:

| Check | Result |
| --- | --- |
| `GET https://codefriends.1ststep.ai/health` | `{"ok":true,"name":"codefriends","onlineCount":1,"store":"sqlite","dmHistoryLimit":200}` |
| Store | `sqlite`, not Worker/D1 (`store` would be `"d1"`) |
| Bind | `apps/server` on `127.0.0.1:8787` ([docs/self-host-windows.md](./self-host-windows.md)) |
| Public edge | Cloudflare named tunnel `codefriends` → `http://127.0.0.1:8787`, hostname `codefriends.1ststep.ai` |
| Data file | `CODEFRIENDS_DB`, Windows example `C:/codefriends-data/codefriends.sqlite`. Default in-repo path `apps/server/data/codefriends.sqlite` (gitignored) |

The point of this monitor is **early warning**: notice SQLite write stalls or a dead tunnel before people in the popout do.

## 1. Purpose and non-goals

### Purpose

Give the person who owns the spare Windows PC one private page that answers:

- Is the Node process answering on loopback?
- Are HTTP handlers getting slower?
- Are SQLite writes slowing down (the failure mode that blocks the event loop)?
- Is `cloudflared` still running and still connected to `127.0.0.1:8787`?
- What were the last errors, and how many people are online?

Alerts start as a local log the operator (or a later agent session) can read. No one should have to SSH-equivalent into the box and tail a console window that was opened from the Startup folder.

### Non-goals

- No third-party APM (no Datadog, Sentry, New Relic, Grafana Cloud, hosted Prometheus).
- No cloud dependency required for collection or display. Cloudflare is already the tunnel; the monitor must keep working if the tunnel is down, as long as someone can open the page on the PC itself (`http://127.0.0.1:8787/...`).
- No public UI changes. Do not add a link, badge, or route in `apps/popout`. Friends never see this page.
- Not for the Cloudflare Worker + D1 deployment. That process has no `cloudflared` child and no `better-sqlite3` file. `/health` there reports `store: "d1"`. Out of scope.
- Not a replacement for `/health`. Liveness stays a tiny public JSON body.
- Not log aggregation of DM text, profiles, tokens, or SQL parameters.
- Not a Postgres-style connection pool dashboard. See [SQLite honesty](#sqlite-honesty) below.
- No production deploy and no tunnel config change in the spec PR.

## 2. Data sources

Collection runs on the Windows box. Prefer loopback. Do not poll `https://codefriends.1ststep.ai/health` on the 30s cadence: that path depends on the tunnel, so a tunnel outage looks like an app outage, and it adds public traffic.

### 2.1 Poll existing `GET /health` every 30s

Already implemented in `packages/core/src/http.ts`. Shape today:

```json
{ "ok": true, "name": "codefriends", "onlineCount": 1, "store": "sqlite", "dmHistoryLimit": 200 }
```

`onlineCount` is in-memory presence (`MemoryPresence` in the Node process), not a SQL `COUNT`. It drops to 0 on restart even though users remain in the SQLite file. `dmHistoryLimit` defaults to 200 (`CODEFRIENDS_DM_HISTORY_LIMIT`). `ok` is currently always `true` when the handler runs; a hung process simply does not answer.

Poll target: `http://127.0.0.1:8787/health` (honor `HOST` / `PORT` if they differ). Timeout: **2s**. Record:

- `t` (ms)
- `ok` / HTTP status / timeout
- `rttMs`
- `onlineCount`
- `store`
- `dmHistoryLimit` (sanity; alert only if it flips unexpectedly)

**Do not add fields to `/health`.** It is unauthenticated and already on the public hostname. New numbers belong on the admin metrics route.

### 2.2 Proposed `GET /metrics` (admin-only)

One JSON snapshot for the page and for anything that does not want to parse the log files. Suggested path: **`GET /metrics`**, same admin gate as the page ([Security](#7-security)). It is not a public Prometheus scrape.

Proposed body (names can move in the implementation PR; meanings should not):

```json
{
  "ok": true,
  "name": "codefriends",
  "uptimeSec": 86400,
  "memory": { "rss": 0, "heapUsed": 0, "heapTotal": 0 },
  "http": {
    "windowSec": 3600,
    "count": 0,
    "histogramMs": { "le10": 0, "le50": 0, "le200": 0, "le1000": 0, "gt1000": 0 },
    "p50Ms": 0,
    "p95Ms": 0
  },
  "sqlite": {
    "connections": 1,
    "busy": false,
    "writeLatencyMs": { "last": 0, "max5m": 0 },
    "note": "single better-sqlite3 handle; busy means a write is in progress on that handle, not a pool checkout"
  },
  "lastError": null,
  "onlineCount": 0,
  "tunnel": { "cloudflared": "unknown", "listeningLocal": false }
}
```

| Field | How to get it | Honest limit |
| --- | --- | --- |
| Response-time histogram | Time the existing Express middleware around `handleHttp` (and static sends if cheap). Fixed buckets: ≤10, ≤50, ≤200, ≤1000, >1000 ms. Keep a ring of the last hour in memory, plus the on-disk samples below. | This measures the Node process after the tunnel. It does not measure Cloudflare edge time. |
| Active DB connections | Constant **1** for `better-sqlite3`. `openBetterSqlite` opens one `Database`. There is no pool. | Do not invent a pool size. If `CODEFRIENDS_LIBSQL_URL` is set, report `connections: null` and skip the gauge rather than pretending libSQL has the same handle. |
| Busy flag | In-process boolean set around each `exec` / `get` / `all` / `run` on the sqlite client. | "Busy" means **this process is inside a synchronous better-sqlite3 call** (or waiting on `SQLITE_BUSY` if a timeout is configured later). It does not mean "N clients checked out". |
| SQLite write latency ms | `performance.now()` around write calls (`run` and `exec`). Chart **writes**, not reads. | Reads matter less for the contention story. A write blocks the Node event loop because the driver is synchronous. |
| Last error | Ring buffer of the last 20 caught server errors (message, route, time). No stack frames that include env or tokens. No SQL parameter values. No request bodies. | The current Express error path does not record these. Implementation adds the ring; it does not scrape the console. |
| Uptime | `process.uptime()`. | Process uptime, not tunnel uptime, not "since Windows boot". |
| Memory | `process.memoryUsage()`. | Process RSS/heap, not machine RAM. Machine RAM is the optional host block. |

#### SQLite honesty

`apps/server/src/db/sqlite.ts` sets `journal_mode = WAL` and `foreign_keys = ON`, then uses one connection for the life of the process. WAL allows one writer and concurrent readers **inside SQLite**. This app does not open extra connections, and better-sqlite3 performs the call on the JS thread, so a slow write stalls HTTP and WebSocket handling until it returns.

Implications the UI must not paper over:

- A "connection count" widget that looks like Postgres is a lie. Show `1` and the busy flag.
- Latency samples recorded **after** a write returns will show the stall, but an in-process `setInterval` will not fire **during** the stall. See [Architecture](#6-architecture).
- Do not write metric rows into `codefriends.sqlite`. The monitor must not add write load to the database it is watching.

### 2.3 `cloudflared` process and the local port

Two checks, both local:

1. **Process up.** `cloudflared` is running (the Startup shortcut runs `cloudflared tunnel run codefriends` via `scripts/windows/start-tunnel-named.cmd`).
2. **Connected to the app.** Something has a TCP connection to `127.0.0.1:8787` whose owning process is `cloudflared`. On Windows that is `Get-NetTCPConnection -LocalPort 8787` (or `netstat -ano`) correlated with the `cloudflared` PID. "Established to 8787" means the tunnel connector can reach the Node listen socket. It does not prove Cloudflare's edge is healthy worldwide.

Do not parse `%USERPROFILE%\.cloudflared\<id>.json` and do not put tunnel credentials in the monitor.

Optional later, not phase 1: `cloudflared` can expose its own Prometheus metrics if the run command gains `--metrics 127.0.0.1:20241`. That is a script change and a new local port. Skip until the process check is not enough. Do not bind those metrics on `0.0.0.0`.

Quick-tunnel (`start-tunnel.cmd`) is the same process check. The rotating `trycloudflare.com` hostname is not something the monitor should store.

### 2.4 Optional local CPU / RAM / disk

Off unless `CODEFRIENDS_MONITOR_HOST=1`.

| Signal | Use | Do not use |
| --- | --- | --- |
| RAM | `os.totalmem()` / `os.freemem()` | — |
| CPU | A short delta of `process.cpuUsage()` plus, if easy, a Windows processor counter | `os.loadavg()` — on Windows it is always `[0, 0, 0]` |
| Disk | `fs.statfs` on the directory that contains `CODEFRIENDS_DB` (Node 20) | A second SQLite query |

Disk-full on `C:\codefriends-data` is a realistic way writes start failing. Threshold suggestion: warn under **2 GB** free, alert under **500 MB**. These are starting points, not measured limits from production.

## 3. Dashboard UX

One page. Working name: **`GET /admin/monitor`**. HTML served by `apps/server`, not by the popout SPA, not by Vite, not by Vercel.

Auth: same admin gate as `/metrics`. No link from the popout. Operator bookmarks it.

Layout, top to bottom, one column, readable on a laptop browser on that PC:

1. **Live status strip.** Last loopback `/health`: ok / timeout, `store`, `onlineCount` right now, process uptime, RSS. If the last poll timed out, the strip is red even if this response somehow succeeded.
2. **Response-time sparkline (last hour).** p95 per sample (one point per 30s → about 120 points). Hover shows p50, p95, and histogram counts. Empty state: "No samples yet" for the first minute after boot, not a fake zero line.
3. **SQLite write-latency gauge.** Value = last write ms, with max-over-5-minutes as secondary text.
   - Green: ≤ 50 ms
   - Yellow: **> 50 ms**
   - Red: **> 200 ms**
   - If there has been no write since boot, say so. Do not show 0 ms as "healthy writes".
4. **Online users over time (last hour, same 30s samples).** Caption: in-memory presence, resets on process restart.
5. **Last 20 errors.** Time, route, one-line message. Newest first. "None" is a valid state.
6. **Tunnel status.** `cloudflared` running or not, and whether a connection to `127.0.0.1:8787` is owned by that process. Three states: up, process missing, process up but not connected to the port.

No charts library requirement. Inline SVG sparkline and a CSS gauge are enough. No frontend build step. Dark background is fine if it matches the popout, but this is not a popout component.

The page reads the in-memory snapshot plus the on-disk samples. It does not open `codefriends.sqlite`.

## 4. Alerting

Start with a file. Webhooks are config, default off.

### When to write an alert

Fire on **transition** into a bad state, not on every 30s sample. Suppress repeats of the same `key` for **15 minutes**.

| Key | Condition | Severity |
| --- | --- | --- |
| `health.down` | 2 consecutive loopback `/health` polls time out or return non-2xx | page |
| `health.slow` | 2 consecutive polls with `rttMs` > 2000 | warn |
| `sqlite.write` | last write **> 200 ms** (red) | page |
| `sqlite.write.warn` | 3 consecutive writes **> 50 ms** and ≤ 200 ms | warn |
| `sqlite.busy` | busy flag still true at the next 30s sample (a write that outlived the interval) | page |
| `tunnel.down` | `cloudflared` process missing, or no connection to `127.0.0.1:8787`, for 2 checks | page |
| `disk.low` | only if host metrics are on, and free space under 500 MB | page |

Resolve by appending a second line with `"state":"ok"` when the condition clears. Do not delete the bad line.

### Where

1. **`alerts.jsonl`** (required). One JSON object per line:

   ```json
   {"t":0,"key":"tunnel.down","severity":"page","state":"firing","message":"cloudflared not running"}
   ```

2. **Agent memory, only if a path is configured and present.** This repo has no agent-memory client. If `CODEFRIENDS_AGENT_MEMORY_PATH` is set and that file exists, append the same one-line summary there so a later coding-agent session on that machine can see it. If the variable is unset or the path is missing, skip silently. Do not take a dependency on Claude-mem, Cursor memory, or any network memory service.

3. **Optional webhook, off by default.** `CODEFRIENDS_ALERT_WEBHOOK_URL` empty means do not call out.
   - `CODEFRIENDS_ALERT_WEBHOOK_KIND=generic` posts the JSON line.
   - `CODEFRIENDS_ALERT_WEBHOOK_KIND=discord` posts `{"content":"<severity> <key>: <message>"}` to a Discord webhook URL.
   - Email is not a mailbox client. If the operator already has an inbound-webhook-to-email bridge, they put that URL here. Do not add SMTP, nodemailer, or an email password to `.env`.

Webhook failure must not crash the server. Log one local `alerts.jsonl` line (`key: "webhook.failed"`) and move on.

## 5. Retention

- **7 days** on disk, then auto-prune.
- Store samples as **one JSONL file per UTC day** under the monitor directory, e.g. `samples-2026-09-21.jsonl`, not inside SQLite.
- On each successful sample write, delete sample files and alert files whose date is older than 7 days. For `alerts.jsonl`, rewrite/truncate to drop lines with `t` older than 7 days (the file stays small at this sample rate).
- In-memory rings (last hour of HTTP timings, last 20 errors) die with the process. The JSONL files are the restart-safe history. The sparkline after a restart comes from today's file plus yesterday's if the hour crosses midnight.
- Expected size: one sample every 30s is about 20k lines/week, well under a few megabytes. If it ever exceeds ~50 MB, prune early rather than keeping 7 days. Mention that in the implementation, do not build a compressor.

Monitor directory:

| `CODEFRIENDS_DB` | Monitor dir |
| --- | --- |
| `C:/codefriends-data/codefriends.sqlite` | `C:/codefriends-data/monitor/` |
| default `apps/server/data/codefriends.sqlite` | `apps/server/data/monitor/` (already under gitignored `apps/server/data/`) |
| override | `CODEFRIENDS_MONITOR_DIR` if set |

`:memory:` databases (smoke tests) get an in-memory ring only. Do not create a monitor folder beside a temp smoke DB unless the test asks for it.

## 6. Architecture

Reuse `apps/server`. Do not add a service, a Worker, or a second public port.

```
Startup folder (existing)                apps/server (existing process)
┌─────────────────────────┐              ┌──────────────────────────────────┐
│ start-server.cmd        │──node────────│ Express                          │
│ start-tunnel-named.cmd  │──cloudflared─│   GET /health          (public)  │
└─────────────────────────┘      │       │   GET /metrics         (admin)   │
                                 │       │   GET /admin/monitor   (admin)   │
                                 ▼       │   sqlite wrapper timings         │
                          127.0.0.1:8787 │   30s sampler                    │
                                         └──────────────┬───────────────────┘
                                                        │ append-only files
                                                        ▼
                                         C:\codefriends-data\monitor\
                                           samples-YYYY-MM-DD.jsonl
                                           alerts.jsonl
```

### What the implementation PR adds

| Piece | Where | Size |
| --- | --- | --- |
| Write-timing + busy flag | `apps/server/src/db/sqlite.ts` (wrapper only; do not change SQL) | small |
| HTTP timing ring + last-error ring | Express layer in `apps/server/src/app.ts`, before `handleHttp` | small |
| `GET /metrics` and `GET /admin/monitor` | **Node-only routes in `apps/server`**, not in `packages/core` `handleHttp`. The Worker must not grow this surface. | one route module + one HTML string or one static file served by Express |
| Sampler | `setInterval` 30s inside the server process: read `/health` via loopback `fetch`, snapshot memory, check tunnel, append JSONL, prune | small |
| Startup | No new required shortcut. Server start is enough. Document the page URL in a short comment in `docs/self-host-windows.md` **in the implementation PR**, not this one. | docs later |

`isApiHttpPath` in `apps/server/src/config.ts` today returns true only for `/health` and `/api/*`. Everything else is the popout SPA when `apps/popout/dist/index.html` exists. **`/metrics` and `/admin/monitor` must be served before that SPA fallback**, or the operator will get the popout `index.html`. Register the routes on the Express app explicitly; do not rely on the client router.

### Event-loop caveat (do not skip)

better-sqlite3 is synchronous. While a write runs, the in-process sampler does not run, and `/metrics` does not answer. The latency is still recorded when the write finishes, so the gauge catches it after the fact. A stall that never returns (deadlock, wedged native call) will not log from inside the process.

Phase 1 accepts that limit. If it shows up in practice, add an optional **out-of-process** poller later: a few lines started from a third Startup shortcut that `curl`s `http://127.0.0.1:8787/health` every 30s and appends `health.down` to `alerts.jsonl` on timeout. That poller is not part of the first implementation unless the acceptance tests prove the in-process timer is insufficient. Do not build it "just in case" in the same PR as the page.

### Windows self-host fit

- Same `.env` as [docs/self-host-windows.md](./self-host-windows.md). New keys are optional and default safe (monitor on, webhook off, host stats off, no admin token → routes respond **404**, not a half-open dashboard).
- `start-server.cmd` and `start-tunnel-named.cmd` stay the two Startup shortcuts. The monitor rides the server process.
- Tunnel ingress stays "whole host → :8787". Security is the admin gate, not a second hostname.
- Files live next to `CODEFRIENDS_DB`, outside the git clone, so a `git pull` does not touch them. Same reason the self-host doc puts the SQLite file in `C:\codefriends-data`.

## 7. Security

There is **no admin role** today. `users` has no role column. Sessions are bearer tokens stored as SHA-256 hashes. Dev login (`CODEFRIENDS_DEV_LOGIN`) is passwordless and, on a public demo, anyone who can open the hostname can mint a session. **A normal CodeFriends session must not unlock this page.**

Gate:

- `CODEFRIENDS_ADMIN_TOKEN` in `.env` only (long random secret, not committed). Compare with a constant-time equality check.
- Send it as `Authorization: Bearer <token>` for `/metrics`.
- The HTML page can accept the same bearer header, or a cookie set by a tiny form that posts the token to the server (cookie: `HttpOnly`, `SameSite=Strict`, `Secure` when the request is HTTPS, `Path=/admin`). Do not put the token in the query string (it would land in logs and the tunnel).
- Missing or wrong token: **404** with an empty body, same as an unknown path. Do not return 401 with a hint that `/metrics` exists.
- Token unset: both routes 404. The sampler may still write local files (they are on disk the operator already has). It must not serve them over HTTP.
- `/health` stays public and small. Do not copy histogram, memory, errors, or paths into it.
- No popout link, no CORS opening for these routes beyond what same-origin already does. The page is opened on `codefriends.1ststep.ai` or on loopback. Do not add `Access-Control-Allow-Origin: *` on `/metrics`.
- `Cache-Control: no-store` on both responses.
- Error log: route + error message only. Strip bearer tokens if a message ever includes a header.
- Rate-limit admin failures in-process (for example 10 misses / minute / IP → short 404s without re-hashing). This is a spare PC, not an identity provider; the limit is to make token guessing noisy in `alerts.jsonl`, not to be a WAF.
- Discord/webhook URLs are secrets. Do not write them into `alerts.jsonl`.

The named tunnel publishes every path on :8787. Assume `/metrics` is on the internet and locked only by the token.

## 8. Phased rollout and effort

Estimates are for one person who already has the Windows box and this repo, including a local smoke and a manual look at the page. They are not a calendar commitment. S = a few hours, M = about one to two days, L = several days. Nothing here is L.

| Phase | Ships | Effort | Depends on |
| --- | --- | --- | --- |
| 0 | This spec | done | — |
| 1 | Sqlite write timer + busy flag, HTTP histogram, error ring, admin `GET /metrics`, JSONL samples, 7-day prune, routes 404 when token unset. No charts. | **S** (about 4–8 hours) | — |
| 2 | `GET /admin/monitor` with the six widgets in [§3](#3-dashboard-ux) | **M** (about 1–2 days) | phase 1 |
| 3 | Tunnel process + port check, `alerts.jsonl` transitions, optional agent-memory append | **S** (about 4–6 hours) | phase 1 |
| 4 | Webhook kind + optional host RAM/disk. Default off. | **S** (about 2–4 hours) | phase 3 |
| 5 | Out-of-process health poller, only if a real stall fails to show up in phase 1 samples | **S** (about 2–3 hours) | evidence |

**First implementation PR should be phase 1–3** (metrics + page + local alerts). That is **M overall, on the order of 2–3 days**. Phase 4–5 wait.

Do not combine this with popout features, auth redesign, or a Worker port.

## 9. Acceptance criteria (implementation PR)

- [ ] Spec-only constraint lifted in that PR; this file updated from "not implemented" to "implemented" with the real route names if they differed.
- [ ] `GET /health` response is unchanged: `ok`, `name`, `onlineCount`, `store`, `dmHistoryLimit` only.
- [ ] Live self-host still reports `store: "sqlite"`. Worker bundle has no `/metrics` and no `/admin/monitor`.
- [ ] With `CODEFRIENDS_ADMIN_TOKEN` unset, `GET /metrics` and `GET /admin/monitor` are 404 and are not the popout `index.html`.
- [ ] With the token set, wrong token is 404; right token returns JSON including `uptimeSec`, `memory`, histogram, `sqlite.busy`, `sqlite.writeLatencyMs`, `sqlite.connections` (1 for better-sqlite3), `lastError`, `onlineCount`, tunnel block.
- [ ] A deliberately slow write in a test (>50 ms and >200 ms) moves the gauge threshold the spec states. The test does not use a connection pool.
- [ ] `GET /admin/monitor` shows status strip, last-hour sparkline, write gauge, online count series, last 20 errors, tunnel status. No popout navigation entry points at it.
- [ ] Samples land in `<dir of CODEFRIENDS_DB>/monitor/` (or `CODEFRIENDS_MONITOR_DIR`) as daily JSONL, not in `codefriends.sqlite`.
- [ ] Files older than 7 days are removed by the sampler. A unit test can inject clock timestamps rather than waiting.
- [ ] `alerts.jsonl` gains a `sqlite.write` line when a write exceeds 200 ms, and does not gain a duplicate of the same key inside 15 minutes.
- [ ] Unset webhook URL causes zero outbound alert requests.
- [ ] `CODEFRIENDS_AGENT_MEMORY_PATH` unset → no error. Set to a missing path → no error. Set to an existing file → one line appended.
- [ ] Tunnel check uses the local process and port 8787, does not read cloudflared credential JSON, and does not change `scripts/windows/*.cmd` unless phase 5 is in scope.
- [ ] Error entries contain no DM body, session token, OAuth secret, or SQL bound parameters.
- [ ] `npm run smoke` still passes. New tests cover the admin 404/200 split and prune. Smoke's `:memory:` / temp DB does not require a webhook.
- [ ] `.env.example` documents the new variables as comments, with empty secrets. No real token in git.
- [ ] Self-host doc gains a short pointer to the page and the token. README gets a link only if a docs index is added; do not expand the README for this feature otherwise.

## Defaults to put in `.env.example` later

```env
# Private monitor. Unset = /metrics and /admin/monitor are 404.
# CODEFRIENDS_ADMIN_TOKEN=
# CODEFRIENDS_MONITOR_DIR=
# CODEFRIENDS_MONITOR_HOST=0
# CODEFRIENDS_AGENT_MEMORY_PATH=
# CODEFRIENDS_ALERT_WEBHOOK_URL=
# CODEFRIENDS_ALERT_WEBHOOK_KIND=generic
```

Sampler interval, retention, and the 50 ms / 200 ms thresholds are constants in code for v1, not extra env knobs.
