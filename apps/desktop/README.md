# CodeFriends desktop (`apps/desktop`)

Thin **Tauri 2** shell around the existing `apps/popout` UI. Chat still lives in the popout; this package only owns the native window, tray, and `codefriends://` handler.

**Why Tauri (not Electron):** Rust + the system WebView is a smaller install than shipping Chromium, and the UI is already a Vite SPA. Latest Tauri 2 crates want **Rust 1.88+** (`rustup default stable`; this repo compiled on 1.98). Electron remains a fine fallback if WebKitGTK / WebView2 ever fights a host OS; it is not needed for v1.

Linux packages used here: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`.

## Run locally

From the repo root (Node 20+):

```bash
npm install
npm run dev          # API :8787 + Vite popout :5173
```

In another terminal:

```bash
npm run desktop      # waits for :5173, then opens the native window
```

Or one command:

```bash
npm run dev:desktop
```

Packaged binary (builds `apps/popout/dist`, then the native app):

```bash
npm run desktop:build
```

Linux CI/dev boxes typically produce a `.deb` under `apps/desktop/src-tauri/target/release/bundle/`. macOS `.dmg` and Windows NSIS need a local smoke on those OSes.

## Env (optional)

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODEFRIENDS_POPOUT_URL` | `http://127.0.0.1:5173` (dev) | WebView origin. Point at `:8787` after a popout production build if the Node server is serving `dist`. |
| `CODEFRIENDS_API_URL` | `http://127.0.0.1:8787` | Injected into the WebView for packaged builds (Vite `VITE_*` still wins if the popout was built with them). |
| `CODEFRIENDS_WS_URL` | derived from the API URL | Same, for `/ws`. |
| `CODEFRIENDS_POPOUT_WAIT_MS` | `60000` | How long `npm run desktop` waits for the popout origin.

## Deep links

Scheme: `codefriends://`. Example:

```
codefriends://open?provider=cursor&handoff=…
codefriends://open?dm=<user-id>
```

The shell copies the query string onto the popout origin and focuses the window. OS registration is bundled for installed apps; `tauri dev` also calls `register_all` on Linux (and Windows debug) so unpackaged runs can claim the scheme. **macOS only registers on an installed `.app`.**

To have the IDE badge open this app instead of a browser tab, set `codefriends.popoutUrl` (or `CODEFRIENDS_POPOUT_URL` in **connect plugins**) to `codefriends://open`. The **server** `CODEFRIENDS_POPOUT_URL` must stay an http(s) URL (`https://codefriends.1ststep.ai` in production) so Google can redirect the browser after OAuth.

## Tray

Left-click (Windows/macOS) or the menu: **Open CodeFriends**. Right-click: **Available** / **Away** (dispatches into the popout WebSocket) and **Quit**. Closing the window hides to the tray; it does not quit.

Linux tray visibility depends on a StatusNotifier / AppIndicator host. XFCE needs a plugin such as `xfce4-sntray-plugin`; GNOME may need an AppIndicator extension. This Linux VM: window + StatusNotifier item verified (CodeFriends square mark in the tray next to the clock); the sntray plugin ate right-clicks as panel settings, so the Open / Available / Away / Quit menu needs a macOS/Windows (or another Linux DE) smoke.

Regenerate bundle / tray PNGs from the official square mark with `npm run icon -w @codefriends/desktop` (source: `apps/popout/public/brand/icon.png`).

## Follow-ups (not this slice)

- Visual refresh of the popout (rail + thread layout, invite card, focus mode)
- Native OS notifications for DMs
- Auto-update channel
- Green/grey tray icon that tracks live presence
- Mixed-content workarounds if a packaged Windows WebView (`https://*.localhost`) must call a local `http://127.0.0.1` API — prefer serving the popout from the Node origin or a production `https` Worker
