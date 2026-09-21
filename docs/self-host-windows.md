# Self-host CodeFriends on a spare Windows PC ($0)

Run the **Node** API (`apps/server`) on a machine you already own, keep users/DMs in a local **SQLite** file, serve the built **popout** from that same process, and put a **Cloudflare Tunnel** in front so you do not open inbound ports or pay for a VPS.

This is a different $0 path than [Vercel popout + Cloudflare Worker/D1](../README.md#0-deploy-not-already-live). Pick one backend. You can still keep `www` / `app` on Vercel and mail on Google while `codefriends.1ststep.ai` points at this PC.

**Cost:** $0 if you already have the PC, electricity, and free Cloudflare / (optional) Vercel accounts. Cloudflare Tunnel itself has a free tier. No credentials are stored in this repo.

## What you get

| Piece | Where it runs |
| --- | --- |
| API + WebSocket | `apps/server` on `http://127.0.0.1:8787` |
| Popout UI | Built `apps/popout/dist`, served as static files from that same port |
| Database | SQLite file (`CODEFRIENDS_DB`) |
| Public HTTPS + WSS | Cloudflare Tunnel (quick URL **or** named hostname) |

Same-origin popout: leave `VITE_CODEFRIENDS_API_URL` and `VITE_CODEFRIENDS_WS_URL` **unset** when you build. The SPA then calls `/api` and `/ws` on whatever host the browser opened.

## 1. Install Node 20

1. Download **Node.js 20 LTS** (64-bit Windows installer) from [https://nodejs.org](https://nodejs.org).
2. The installer includes **npm**. Tick the option that adds Node to `PATH`.
3. Open a **new** Command Prompt:

```bat
node -v
npm -v
```

You need `v20` or newer (`package.json` `engines.node` is `>=20`).

`better-sqlite3` usually installs from a prebuilt binary on Windows x64. If `npm install` fails compiling it, install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the **Desktop development with C++** workload and retry.

Also install **Git for Windows** if `git` is missing: [https://git-scm.com](https://git-scm.com).

## 2. Clone

```bat
cd /d C:\src
git clone https://github.com/1ststepai/codefriends.git
cd codefriends
```

Use any folder you like. The helper scripts find the repo from `scripts\windows\` (two levels up). **Do not copy those `.cmd` files** into the Startup folder — create shortcuts instead, or `%~dp0` will point at the wrong place.

## 3. `.env` (SQLite path + DEV login for a demo)

```bat
copy .env.example .env
notepad .env
```

Minimum demo (passwordless usernames). Uncomment / add:

```env
HOST=127.0.0.1
PORT=8787

# Persist outside the clone so a fresh git pull cannot surprise you.
# Forward slashes are fine on Windows.
CODEFRIENDS_DB=C:/codefriends-data/codefriends.sqlite

# Built popout. Default is already apps/popout/dist — set only if you moved it.
# CODEFRIENDS_POPOUT_DIR=C:/src/codefriends/apps/popout/dist

# Passwordless POST /api/auth/login { "username": "maya" }.
# On by default when NODE_ENV is not production. Set =1 so a later
# NODE_ENV=production does not silently turn it off.
CODEFRIENDS_DEV_LOGIN=1
CODEFRIENDS_SEED=1
CODEFRIENDS_MOCK_PROVIDERS=0

# Private monitor at /admin and GET /metrics. Unset = those routes 404.
# Use a long random secret. A normal popout login cannot open this page.
# CODEFRIENDS_ADMIN_TOKEN=

# Leave VITE_* unset so the built popout uses same-origin /api and /ws.
```

Create the data folder:

```bat
mkdir C:\codefriends-data
```

**DEV login on a public URL is a demo, not an account system.** Anyone who can reach the hostname can sign in as `maya` / `parker` / any new username. Do not treat that as production auth. Set `CODEFRIENDS_DEV_LOGIN=0` (and `NODE_ENV=production`) when you no longer want that path.

Public URLs — set these **after** you know the hostname (step 6):

| Tunnel | `CODEFRIENDS_PUBLIC_URL` and `CODEFRIENDS_POPOUT_URL` |
| --- | --- |
| Named (`codefriends.1ststep.ai`) | `https://codefriends.1ststep.ai` — you know this before the first start |
| Quick tunnel | whatever `cloudflared` printed (`https://<random>.trycloudflare.com`) — **changes every restart** |

Both vars should be the **same origin** when the Node process serves the popout. They matter for CORS extras, OAuth redirects, and `GET /api/auth/providers` → `popoutUrl`. DEV login works without them; Google login does not.

Do not put Cloudflare tokens, tunnel JSON, or OAuth client secrets into git. `.env` is gitignored.

## 4. Install, build popout, start the API

From the repo root:

```bat
npm install
npm run build -w @codefriends/popout
npm run start -w @codefriends/server
```

Or double-click [`scripts/windows/start-server.cmd`](../scripts/windows/start-server.cmd) after `npm install` and the popout build.

Expected log lines:

- `CodeFriends server http://127.0.0.1:8787`
- `Store: sqlite (C:\codefriends-data\codefriends.sqlite)` (or your path)
- `Dev username login: on`
- `Popout static: …\apps\popout\dist`

If you see `Popout static: off`, `apps/popout/dist/index.html` is missing — rerun the popout build.

### Check on the PC (no tunnel yet)

| URL | Expect |
| --- | --- |
| http://127.0.0.1:8787/health | JSON `{ "ok": true, "store": "sqlite", … }` |
| http://127.0.0.1:8787/ | Popout login (static SPA) |
| http://127.0.0.1:8787/admin | Private monitor (404 until `CODEFRIENDS_ADMIN_TOKEN` is set) |
| Sign in as `maya` | Friends list; seed roster is already friends |

Leave that Command Prompt open. Closing it stops the server.

Optional fake “agents online” (second window):

```bat
npm run demo:agents
```

### Admin monitor (this PC only)

The popout has no link to this. Bookmark it.

1. Set `CODEFRIENDS_ADMIN_TOKEN` in `.env` to a long random value (not a user password — there is no admin role).
2. Restart the Node server. The log line should say `Admin monitor: http://127.0.0.1:8787/admin`.
3. Open [http://127.0.0.1:8787/admin](http://127.0.0.1:8787/admin) on the PC (works even if the tunnel is down) and paste the token. Or:

```bat
curl -s -H "Authorization: Bearer YOUR_TOKEN" http://127.0.0.1:8787/metrics
```

If the token is unset or wrong, `/admin` and `/metrics` return **404** (empty), same as an unknown path — not the popout. Samples land in `<dir of CODEFRIENDS_DB>\monitor\` (override with `CODEFRIENDS_MONITOR_DIR`). Details: [monitoring-dashboard.md](./monitoring-dashboard.md).

## 5. Cloudflare Tunnel

Install `cloudflared` (one-time), then pick **quick** or **named**.

```bat
winget install --id Cloudflare.cloudflared
```

Or download the Windows amd64 build from [Cloudflare’s install page](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/). Open a **new** Command Prompt after install and check:

```bat
cloudflared -v
```

The tunnel is **outbound**. You do not forward ports on the router. Keep Windows **Sleep** off while the box is plugged in (Settings → System → Power), or the tunnel dies when the PC sleeps.

### 5a. Quick tunnel — fine for a one-off demo

```bat
cloudflared tunnel --url http://127.0.0.1:8787
```

Same command: [`scripts/windows/start-tunnel.cmd`](../scripts/windows/start-tunnel.cmd).

`cloudflared` prints a URL like `https://something-random.trycloudflare.com`. Open that. HTTPS and WebSockets (`wss://…/ws`) go through the tunnel to `:8787`.

**The hostname rotates every time you restart `cloudflared`.** Bookmarks, Cursor `codefriends.popoutUrl` / `codefriends.serverUrl`, and Google OAuth redirect URIs all break on the next launch. There is no “keep last quick-tunnel URL” flag. For anything you want to find again tomorrow, use a named tunnel.

After you copy the printed URL, put it in `.env` as both `CODEFRIENDS_PUBLIC_URL` and `CODEFRIENDS_POPOUT_URL`, then restart the Node server. Do that again after every quick-tunnel restart.

### 5b. Named tunnel — stable `https://codefriends.1ststep.ai`

A named tunnel needs a Cloudflare account and a hostname you control. This repo does **not** include account ids, tunnel UUIDs, or credential JSON. You create those on the machine (they land under `%USERPROFILE%\.cloudflared\`).

1. Log in (opens a browser):

   ```bat
   cloudflared tunnel login
   ```

2. Create a tunnel **once** (pick your own name if you want; `codefriends` matches the examples):

   ```bat
   cloudflared tunnel create codefriends
   ```

   That prints a **tunnel id** (UUID) and writes `%USERPROFILE%\.cloudflared\<id>.json`. Do not commit that file.

3. Point ingress at the local Node port. Example `%USERPROFILE%\.cloudflared\config.yml` — replace the id and Windows username; do not invent someone else’s:

   ```yml
   tunnel: <tunnel-id-from-create>
   credentials-file: C:\Users\<you>\.cloudflared\<tunnel-id>.json
   ingress:
     - hostname: codefriends.1ststep.ai
       service: http://127.0.0.1:8787
     - service: http_status:404
   ```

4. DNS for `codefriends.1ststep.ai`:

   - **Zone already on Cloudflare:**  
     `cloudflared tunnel route dns codefriends codefriends.1ststep.ai`  
     (creates a CNAME to `<tunnel-id>.cfargotunnel.com`).
   - **Zone still on HostGator (or any other DNS):** create that same CNAME yourself at the current DNS host. You can add **only** `codefriends` without moving `www` / `app` / MX. A full zone move is optional; see [§7](#7-moving-1ststepai-dns-from-hostgator-to-cloudflare).

5. Run it:

   ```bat
   cloudflared tunnel run codefriends
   ```

   [`scripts/windows/start-tunnel-named.cmd`](../scripts/windows/start-tunnel-named.cmd) is the same command. It does nothing useful until steps 1–4 exist on that PC.

6. Set `.env` (stable — you can do this before the first run):

   ```env
   CODEFRIENDS_PUBLIC_URL=https://codefriends.1ststep.ai
   CODEFRIENDS_POPOUT_URL=https://codefriends.1ststep.ai
   ```

   Restart the Node server. Open `https://codefriends.1ststep.ai/health` and the popout at `/`.

This repo never needs a Cloudflare API token. Do not paste tunnel tokens into `.env` or into these scripts.

## 6. Start with Windows (Startup folder)

No extra Windows service is required.

1. Confirm `start-server.cmd` and the tunnel script work when double-clicked.
2. `Win+R` → `shell:startup` → Enter.
3. Right-click → **New → Shortcut**:
   - Target: `C:\src\codefriends\scripts\windows\start-server.cmd` (your clone path)
   - Name: `CodeFriends server`
4. Second shortcut: `start-tunnel.cmd` (quick) **or** `start-tunnel-named.cmd` (stable hostname).
5. Sign out / reboot once and confirm both windows come back.

Start the **server before** the tunnel (or retry the tunnel if `:8787` is not up yet). `cloudflared` will error if nothing is listening; the named-tunnel script does not wait.

To stop: close the two console windows, or remove the shortcuts.

## 7. Moving `1ststep.ai` DNS from HostGator to Cloudflare

Only needed if you want the **whole zone** on Cloudflare (orange-cloud proxy, named-tunnel `route dns`, etc.). You can skip this and add a single `codefriends` CNAME at HostGator ([§5b](#5b-named-tunnel--stable-httpscodefriends1ststepai)).

**Do this before you change nameservers.** A zone move that only copies a subset of records will break the marketing site and mail.

### Preserve these (screenshot + export first)

At HostGator (cPanel → Zone Editor, or their DNS table), save **every** record. Recreate the same names, types, and values in Cloudflare → **DNS → Records** while the domain is still on HostGator nameservers (Cloudflare will show the zone as pending).

| What | Typical HostGator / current role | Cloudflare notes |
| --- | --- | --- |
| **Vercel `www`** | `CNAME` `www` → Vercel (`cname.vercel-dns.com` or whatever is there **today**) | Copy the **existing** target. Proxy: **DNS only** (grey cloud) unless you are deliberately using Vercel’s Cloudflare integration. |
| **Vercel `app`** | `CNAME` `app` → same Vercel target (or a Vercel `*.vercel.app` host) | Same: copy, don’t invent. Grey cloud. |
| **Apex `1ststep.ai`** | A / AAAA / ALIAS / CNAME flattening to Vercel or HostGator | Recreate exactly. Vercel apex is usually A records they list in the project’s DNS UI — use **those**, not a guess. |
| **Google MX** | `MX` on `@` to Google (`ASPMX.L.GOOGLE.COM`, `ALT1`…`ALT4`, with the priorities you already have) | Copy host, priority, and target **verbatim**. MX must stay **DNS only**. |
| **Google / mail TXT** | SPF (`v=spf1 include:_spf.google.com …`), DKIM (`google._domainkey` or similar), DMARC (`_dmarc`), `google-site-verification` | Copy every TXT. Missing SPF/DKIM is how mail starts landing in spam. |
| **Other** | Autodiscover, `www` extras, HostGator parking, old A records | If you do not know it, keep it until you do. |

Do **not** replace Google MX with Cloudflare Email Routing unless you intend to leave Google Workspace. Do **not** point `www` or `app` at the Windows tunnel — those stay on Vercel.

After the table in Cloudflare matches the screenshot:

1. Cloudflare → Overview → copy the two assigned nameservers.
2. At the **registrar** (may still be HostGator), replace HostGator nameservers with Cloudflare’s.
3. Wait for the zone to show **Active**. Mail and Vercel should keep working if the records were copied correctly.
4. Then add `codefriends` → named tunnel ([§5b](#5b-named-tunnel--stable-httpscodefriends1ststepai)).

This document does not list live IPs or verification strings. Those belong in your DNS panel, not in git.

## 8. Point the popout / editor at the public host

| Setting | Named tunnel example | Quick tunnel |
| --- | --- | --- |
| Browser | `https://codefriends.1ststep.ai` | the printed `https://<random>.trycloudflare.com` |
| Cursor `codefriends.popoutUrl` | `https://codefriends.1ststep.ai` | same printed URL (update after every restart) |
| Cursor `codefriends.serverUrl` | `https://codefriends.1ststep.ai` | same |

Google OAuth (optional): authorized redirect URI must be `{CODEFRIENDS_PUBLIC_URL}/api/auth/gemini/callback`. That is unusable on a rotating quick-tunnel URL.

## Honest limits

- One Windows process = presence lives **in that process memory**. Sleep, reboot, or a crash drops everyone until they reconnect. SQLite still has users, friends, and DMs.
- Free Cloudflare Tunnel / Quick Tunnels are not an SLA. Quick-tunnel URLs **rotate**.
- This box is a single point of failure. The Worker + D1 path stays the better always-on $0 API if you do not want to keep a PC awake.
- `better-sqlite3` is native. Prefer Node 20 x64; don’t mix 32-bit Node with 64-bit prebuilds.
- DEV login is passwordless. Treat a public demo as disposable.

## Scripts

| File | Does |
| --- | --- |
| [`scripts/windows/start-server.cmd`](../scripts/windows/start-server.cmd) | `cd` to repo root, refuse to start without `node_modules` + popout `dist`, then `npm run start -w @codefriends/server` |
| [`scripts/windows/start-tunnel.cmd`](../scripts/windows/start-tunnel.cmd) | Quick tunnel to `http://127.0.0.1:8787` (URL rotates) |
| [`scripts/windows/start-tunnel-named.cmd`](../scripts/windows/start-tunnel-named.cmd) | `cloudflared tunnel run codefriends` — needs a tunnel you created locally |

No secrets in those files. Edit the named-tunnel script only if you chose a different tunnel name.
