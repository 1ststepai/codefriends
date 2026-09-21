import type { MetricsSnapshot, SamplePoint } from "./monitor.js";

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 10) return `${ms.toFixed(1)} ms`;
  return `${Math.round(ms)} ms`;
}

function fmtUptime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 48) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function fmtRss(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function writeClass(last: number | null): string {
  if (last === null) return "muted";
  if (last > 200) return "bad";
  if (last > 50) return "warn";
  return "ok";
}

function sparkline(values: number[], titles: string[], color: string): string {
  if (!values.length) return `<p class="empty">No samples yet</p>`;
  const w = 640;
  const h = 72;
  const max = Math.max(...values, 1);
  const n = values.length;
  const pts = values.map((v, i) => {
    const x = n === 1 ? 0 : (i / (n - 1)) * w;
    const y = h - (v / max) * (h - 8) - 4;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const dots = values
    .map((v, i) => {
      const x = n === 1 ? 0 : (i / (n - 1)) * w;
      const y = h - (v / max) * (h - 8) - 4;
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.2" fill="${color}"><title>${esc(titles[i] ?? String(v))}</title></circle>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img"><polyline fill="none" stroke="${color}" stroke-width="1.6" points="${pts.join(" ")}" />${dots}</svg>`;
}

export function renderLoginPage(): string {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>CodeFriends admin</title>
<style>
  :root { color-scheme: dark; --bg:#1e1e1e; --panel:#252526; --line:#3c3c3c; --text:#cccccc; --muted:#8b8b8b; --accent:#3794ff; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--text); font: 14px/1.45 "Segoe UI", ui-sans-serif, system-ui, sans-serif; }
  form { width: min(22rem, calc(100% - 2rem)); background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 1.25rem 1.4rem; }
  h1 { font-size: 1rem; font-weight: 600; margin: 0 0 .75rem; }
  label { display: block; color: var(--muted); font-size: 12px; margin-bottom: .35rem; }
  input { width: 100%; padding: .5rem .6rem; border-radius: 6px; border: 1px solid var(--line); background: #1e1e1e; color: var(--text); }
  button { margin-top: .85rem; background: var(--accent); color: #fff; border: 0; border-radius: 6px; padding: .45rem .9rem; cursor: pointer; }
  p { color: var(--muted); font-size: 12px; margin: .85rem 0 0; }
</style>
<form method="post" action="/admin/session">
  <h1>CodeFriends admin</h1>
  <label for="token">Admin token</label>
  <input id="token" name="token" type="password" autocomplete="current-password" required>
  <button type="submit">Open</button>
  <p>Same value as <code>CODEFRIENDS_ADMIN_TOKEN</code>. Use loopback or the tunnel hostname; this page is not linked from the popout.</p>
</form>
`;
}

export function renderMonitorPage(snap: MetricsSnapshot, hour: SamplePoint[]): string {
  const stripClass = snap.health.timeout || snap.health.ok === false ? "strip bad" : "strip ok";
  const healthLabel = snap.health.timeout
    ? "health timeout"
    : snap.health.ok
      ? "health ok"
      : snap.health.t
        ? "health fail"
        : "health pending";
  const p95 = hour.map((s) => s.p95Ms);
  const p95Titles = hour.map(
    (s) =>
      `${new Date(s.t).toISOString().slice(11, 19)}  p50 ${fmtMs(s.p50Ms)}  p95 ${fmtMs(s.p95Ms)}  n=${s.httpCount}  5xx=${s.httpErrors}`,
  );
  const online = hour.map((s) => s.onlineCount);
  const onlineTitles = hour.map(
    (s) => `${new Date(s.t).toISOString().slice(11, 19)}  ${s.onlineCount} online`,
  );
  const writeLabel =
    snap.sqlite.lastWriteMs === null ? "No writes since boot" : fmtMs(snap.sqlite.lastWriteMs);
  const errors =
    snap.errors.length === 0
      ? `<p class="empty">None</p>`
      : `<table><thead><tr><th>When</th><th>Route</th><th>Message</th></tr></thead><tbody>${snap.errors
          .map(
            (e) =>
              `<tr><td>${esc(new Date(e.t).toISOString().slice(11, 19))}</td><td><code>${esc(e.route)}</code></td><td>${esc(e.message)}</td></tr>`,
          )
          .join("")}</tbody></table>`;

  let tunnel = "unknown";
  let tunnelClass = "muted";
  if (snap.tunnel.cloudflared === "missing") {
    tunnel = "process missing";
    tunnelClass = "bad";
  } else if (snap.tunnel.cloudflared === "up" && !snap.tunnel.listeningLocal) {
    tunnel = "process up, not connected to local port";
    tunnelClass = "warn";
  } else if (snap.tunnel.cloudflared === "up") {
    tunnel = "up";
    tunnelClass = "ok";
  }

  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="30">
<title>CodeFriends admin</title>
<style>
  :root { color-scheme: dark; --bg:#1e1e1e; --panel:#252526; --line:#3c3c3c; --text:#cccccc; --muted:#8b8b8b; --ok:#3fb950; --warn:#dcdcaa; --bad:#f85149; --accent:#3794ff; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 "Segoe UI", ui-sans-serif, system-ui, sans-serif; }
  main { max-width: 44rem; margin: 0 auto; padding: 1.25rem 1.1rem 2.5rem; }
  h1 { font-size: 1.05rem; font-weight: 600; margin: 0 0 .8rem; }
  h2 { font-size: .78rem; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); margin: 1.25rem 0 .45rem; }
  .strip, section { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: .8rem 1rem; }
  .strip { display: flex; flex-wrap: wrap; gap: .55rem 1.1rem; }
  .strip.ok { border-color: #24402a; }
  .strip.bad { border-color: #5a1d1d; background: #2a1c1c; }
  .k { color: var(--muted); font-size: 11px; display: block; }
  .ok { color: var(--ok); } .warn { color: var(--warn); } .bad { color: var(--bad); } .muted { color: var(--muted); }
  .gauge { font-size: 1.6rem; font-weight: 650; }
  .empty, .cap { color: var(--muted); font-size: 12px; margin: .3rem 0 0; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: .28rem .35rem; border-bottom: 1px solid var(--line); vertical-align: top; }
  code { font-size: 12px; }
  svg { display: block; }
</style>
<main>
  <h1>CodeFriends</h1>
  <div class="${stripClass}">
    <div><span class="k">Loopback</span><strong>${esc(healthLabel)}</strong></div>
    <div><span class="k">Store</span><strong>${esc(snap.store)}</strong></div>
    <div><span class="k">Online</span><strong>${esc(snap.onlineCount)}</strong></div>
    <div><span class="k">Uptime</span><strong>${esc(fmtUptime(snap.uptimeSec))}</strong></div>
    <div><span class="k">RSS</span><strong>${esc(fmtRss(snap.memory.rss))}</strong></div>
    <div><span class="k">WS</span><strong>${esc(snap.wsClients)}</strong></div>
  </div>

  <h2>HTTP p95 · last hour</h2>
  <section>
    ${sparkline(p95, p95Titles, "#3794ff")}
    <p class="cap">${esc(snap.http.count)} requests / ${esc(snap.http.errors)} errors in ${esc(snap.http.windowSec)}s · p50 ${esc(fmtMs(snap.http.p50Ms))} · p95 ${esc(fmtMs(snap.http.p95Ms))}</p>
  </section>

  <h2>SQLite writes</h2>
  <section>
    <div class="gauge ${writeClass(snap.sqlite.lastWriteMs)}">${esc(writeLabel)}</div>
    <p class="cap">max 5m ${esc(fmtMs(snap.sqlite.writeLatencyMs.max5m))} · connections ${esc(snap.sqlite.connections ?? "n/a")} · busy ${esc(snap.sqlite.busy)} · yellow &gt;50ms, red &gt;200ms</p>
    <p class="cap">${esc(snap.sqlite.note)}</p>
  </section>

  <h2>Online · last hour</h2>
  <section>
    ${sparkline(online, onlineTitles, "#3fb950")}
    <p class="cap">In-memory presence. Resets on process restart.</p>
  </section>

  <h2>Last errors</h2>
  <section>${errors}</section>

  <h2>Tunnel</h2>
  <section>
    <strong class="${tunnelClass}">${esc(tunnel)}</strong>
    <p class="cap">cloudflared=${esc(snap.tunnel.cloudflared)} · listeningLocal=${esc(snap.tunnel.listeningLocal)} · Gemini/Google ${snap.auth.gemini ? "configured" : "unconfigured"}</p>
  </section>
</main>
`;
}
