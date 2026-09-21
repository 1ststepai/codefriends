import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import type { ServerConfig } from "./config.js";
import { WRITE_PAGE_MS, WRITE_WARN_MS, writeMax5m, type SqliteStats } from "./db/sqlite.js";
import { renderLoginPage, renderMonitorPage } from "./monitor-page.js";

export const SAMPLE_INTERVAL_MS = 30_000;
export const HTTP_WINDOW_MS = 3_600_000;
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const ALERT_SUPPRESS_MS = 15 * 60 * 1000;
export const ADMIN_COOKIE = "CODEFRIENDS_ADMIN_TOKEN";
const HEALTH_TIMEOUT_MS = 2_000;
const ERROR_RING = 20;
const AUTH_MISS_MAX = 10;
const AUTH_MISS_WINDOW_MS = 60_000;

export interface HttpSample {
  t: number;
  ms: number;
  status: number;
}

export interface ErrorEntry {
  t: number;
  route: string;
  message: string;
}

export interface SamplePoint {
  t: number;
  p50Ms: number;
  p95Ms: number;
  httpCount: number;
  httpErrors: number;
  onlineCount: number;
  writeMs: number | null;
  rttMs: number | null;
  healthOk: boolean;
}

export interface MetricsSnapshot {
  ok: true;
  name: "codefriends";
  uptimeSec: number;
  memory: { rss: number; heapUsed: number; heapTotal: number };
  http: {
    windowSec: number;
    count: number;
    errors: number;
    histogramMs: { le10: number; le50: number; le200: number; le1000: number; gt1000: number };
    p50Ms: number;
    p95Ms: number;
  };
  sqlite: {
    connections: number | null;
    busy: boolean;
    writeLatencyMs: { last: number | null; max5m: number | null };
    lastWriteMs: number | null;
    note: string;
  };
  lastError: ErrorEntry | null;
  errors: ErrorEntry[];
  onlineCount: number;
  wsClients: number;
  store: string;
  auth: { gemini: boolean; google: boolean; devLogin: boolean };
  tunnel: { cloudflared: "up" | "missing" | "unknown"; listeningLocal: boolean };
  health: {
    ok: boolean;
    timeout: boolean;
    rttMs: number | null;
    store: string | null;
    t: number | null;
  };
}

export interface Monitor {
  recordHttp(path: string, status: number, ms: number): void;
  recordError(route: string, message: string): void;
  noteWrite(ms: number): void;
  handle(req: Request, res: Response): Promise<boolean>;
  snapshot(): Promise<MetricsSnapshot>;
  sampleNow(): Promise<void>;
  start(loopbackOrigin: string, listening: () => boolean): void;
  stop(): void;
  hourSamples(): SamplePoint[];
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    timingSafeEqual(right, right);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function sanitizeMonitorMessage(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/CODEFRIENDS_ADMIN_TOKEN=\S+/gi, "CODEFRIENDS_ADMIN_TOKEN=[redacted]")
    .replace(/token=([^&\s]+)/gi, "token=[redacted]")
    .slice(0, 280);
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

export function histogram(values: number[]): MetricsSnapshot["http"]["histogramMs"] {
  const buckets = { le10: 0, le50: 0, le200: 0, le1000: 0, gt1000: 0 };
  for (const ms of values) {
    if (ms <= 10) buckets.le10 += 1;
    else if (ms <= 50) buckets.le50 += 1;
    else if (ms <= 200) buckets.le200 += 1;
    else if (ms <= 1000) buckets.le1000 += 1;
    else buckets.gt1000 += 1;
  }
  return buckets;
}

export function pruneMonitorDir(dir: string, now = Date.now(), keepMs = RETENTION_MS): void {
  if (!dir || !existsSync(dir)) return;
  const oldest = now - keepMs;
  for (const name of readdirSync(dir)) {
    const day = /^samples-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
    if (!day) continue;
    const start = Date.parse(`${day[1]}T00:00:00Z`);
    if (Number.isFinite(start) && start < oldest) unlinkSync(join(dir, name));
  }
  const alertsPath = join(dir, "alerts.jsonl");
  if (!existsSync(alertsPath)) return;
  const kept = readFileSync(alertsPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .filter((line) => {
      try {
        const row = JSON.parse(line) as { t?: unknown };
        return typeof row.t === "number" && row.t >= oldest;
      } catch {
        return false;
      }
    });
  writeFileSync(alertsPath, kept.length ? `${kept.join("\n")}\n` : "");
}

export function detectCloudflared(): "up" | "missing" | "unknown" {
  try {
    if (process.platform === "linux") {
      for (const pid of readdirSync("/proc")) {
        if (!/^\d+$/.test(pid)) continue;
        try {
          if (readFileSync(`/proc/${pid}/comm`, "utf8").trim() === "cloudflared") return "up";
        } catch {
          /* process exited */
        }
      }
      return "missing";
    }
    if (process.platform === "win32") {
      const out = execFileSync("tasklist", ["/FI", "IMAGENAME eq cloudflared.exe", "/NH"], {
        encoding: "utf8",
        timeout: 2000,
        windowsHide: true,
      });
      return /cloudflared\.exe/i.test(out) ? "up" : "missing";
    }
    const out = execFileSync("ps", ["-A", "-o", "comm="], { encoding: "utf8", timeout: 2000 });
    return out.split("\n").some((line) => {
      const name = line.trim();
      return name === "cloudflared" || name.endsWith("/cloudflared");
    })
      ? "up"
      : "missing";
  } catch {
    return "unknown";
  }
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      return part.slice(idx + 1).trim();
    }
  }
  return undefined;
}

function adminTokenFrom(req: Request): string | undefined {
  const auth = req.headers.authorization;
  const bearer = typeof auth === "string" ? /^Bearer\s+(.+)$/i.exec(auth) : null;
  if (bearer?.[1]) return bearer[1].trim();
  const header = req.headers["x-admin-token"];
  if (typeof header === "string" && header.trim()) return header.trim();
  return cookieValue(req.headers.cookie, ADMIN_COOKIE);
}

function clientIp(req: Request): string {
  return req.socket.remoteAddress ?? "unknown";
}

function noStore(res: Response): void {
  res.setHeader("cache-control", "no-store");
}

function send404(res: Response): void {
  noStore(res);
  res.status(404).end();
}

function utcDay(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

function appendJsonl(file: string, row: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(row)}\n`);
}

function loadHourSamples(dir: string | null, now: number): SamplePoint[] {
  if (!dir) return [];
  const out: SamplePoint[] = [];
  const cutoff = now - HTTP_WINDOW_MS;
  for (const delta of [0, 1]) {
    const day = utcDay(now - delta * 24 * 60 * 60 * 1000);
    const file = join(dir, `samples-${day}.jsonl`);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line) continue;
      try {
        const row = JSON.parse(line) as SamplePoint;
        if (typeof row.t === "number" && row.t >= cutoff) out.push(row);
      } catch {
        /* skip bad line */
      }
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

export interface MonitorHooks {
  config: ServerConfig;
  sqlite: SqliteStats;
  onlineCount: () => Promise<number>;
  wsClients: () => number;
}

export function createMonitor(hooks: MonitorHooks): Monitor {
  const httpRing: HttpSample[] = [];
  const errors: ErrorEntry[] = [];
  const samples: SamplePoint[] = [];
  const authFails = new Map<string, number[]>();
  const lastAlert = new Map<string, { t: number; firing: boolean }>();
  let healthFails = 0;
  let tunnelFails = 0;
  let lastHealth: MetricsSnapshot["health"] = {
    ok: true,
    timeout: false,
    rttMs: null,
    store: null,
    t: null,
  };
  let loopbackOrigin = "";
  let listening: () => boolean = () => false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let sawBusyAtSample = false;

  const sqliteNote =
    hooks.sqlite.connections === 1
      ? "single better-sqlite3 handle; busy means a write is in progress on that handle, not a pool checkout"
      : "not better-sqlite3; write-latency gauge skipped";

  const trimHttp = (now: number) => {
    const cutoff = now - HTTP_WINDOW_MS;
    while (httpRing.length && httpRing[0]!.t < cutoff) httpRing.shift();
  };

  const recordHttp = (path: string, status: number, ms: number) => {
    const t = Date.now();
    httpRing.push({ t, ms, status });
    trimHttp(t);
    if (status >= 500) recordError(path, `HTTP ${status}`);
  };

  const recordError = (route: string, message: string) => {
    errors.unshift({
      t: Date.now(),
      route: route.slice(0, 120),
      message: sanitizeMonitorMessage(message),
    });
    if (errors.length > ERROR_RING) errors.length = ERROR_RING;
  };

  const fireAlert = (key: string, severity: "page" | "warn", message: string, firing: boolean) => {
    const now = Date.now();
    const prev = lastAlert.get(key);
    if (firing) {
      if (prev?.firing && now - prev.t < ALERT_SUPPRESS_MS) return;
    } else if (!prev?.firing) {
      return;
    }
    lastAlert.set(key, { t: now, firing });
    const row = { t: now, key, severity, state: firing ? "firing" : "ok", message };
    const line = JSON.stringify(row);
    if (hooks.config.monitorDir) {
      appendJsonl(join(hooks.config.monitorDir, "alerts.jsonl"), row);
    }
    const mem = hooks.config.agentMemoryPath;
    if (mem) {
      try {
        if (existsSync(mem)) appendFileSync(mem, `${line}\n`);
      } catch {
        /* missing or unwritable path is a no-op */
      }
    }
  };

  const noteWrite = (ms: number) => {
    if (ms > WRITE_PAGE_MS) fireAlert("sqlite.write", "page", `write ${Math.round(ms)} ms`, true);
    else fireAlert("sqlite.write", "page", `write ${Math.round(ms)} ms`, false);
    if (hooks.sqlite.consecutiveWarn >= 3) {
      fireAlert("sqlite.write.warn", "warn", `${hooks.sqlite.consecutiveWarn} consecutive writes > ${WRITE_WARN_MS} ms`, true);
    } else {
      fireAlert("sqlite.write.warn", "warn", "writes recovered", false);
    }
  };

  hooks.sqlite.onWrite = noteWrite;

  const authorized = (req: Request, res: Response): boolean => {
    const token = hooks.config.adminToken;
    if (!token) {
      send404(res);
      return false;
    }
    const ip = clientIp(req);
    const now = Date.now();
    const recent = (authFails.get(ip) ?? []).filter((t) => now - t < AUTH_MISS_WINDOW_MS);
    authFails.set(ip, recent);
    if (recent.length >= AUTH_MISS_MAX) {
      send404(res);
      return false;
    }
    const got = adminTokenFrom(req);
    if (got && safeEqual(got, token)) return true;
    recent.push(now);
    authFails.set(ip, recent);
    send404(res);
    return false;
  };

  const snapshot = async (): Promise<MetricsSnapshot> => {
    const now = Date.now();
    trimHttp(now);
    const durations = httpRing.map((s) => s.ms);
    const mem = process.memoryUsage();
    const lastWrite = hooks.sqlite.lastWriteMs;
    return {
      ok: true,
      name: "codefriends",
      uptimeSec: Math.floor(process.uptime()),
      memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
      http: {
        windowSec: HTTP_WINDOW_MS / 1000,
        count: httpRing.length,
        errors: httpRing.filter((s) => s.status >= 500).length,
        histogramMs: histogram(durations),
        p50Ms: percentile(durations, 50),
        p95Ms: percentile(durations, 95),
      },
      sqlite: {
        connections: hooks.sqlite.connections,
        busy: hooks.sqlite.busy,
        writeLatencyMs: { last: lastWrite, max5m: writeMax5m(hooks.sqlite, now) },
        lastWriteMs: lastWrite,
        note: sqliteNote,
      },
      lastError: errors[0] ?? null,
      errors: [...errors],
      onlineCount: await hooks.onlineCount(),
      wsClients: hooks.wsClients(),
      store: hooks.config.storeKind,
      auth: {
        gemini: Boolean(hooks.config.google.clientId && hooks.config.google.clientSecret),
        google: Boolean(hooks.config.google.clientId && hooks.config.google.clientSecret),
        devLogin: hooks.config.devLogin,
      },
      tunnel: {
        cloudflared: detectCloudflared(),
        listeningLocal: listening(),
      },
      health: lastHealth,
    };
  };

  const sampleNow = async () => {
    const origin = loopbackOrigin;
    let rttMs: number | null = null;
    let healthOk = false;
    let timeout = false;
    let store: string | null = null;
    const t0 = performance.now();
    if (origin) {
      try {
        const res = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
        rttMs = performance.now() - t0;
        healthOk = res.ok;
        if (res.ok) {
          const body = (await res.json()) as { store?: string };
          store = typeof body.store === "string" ? body.store : null;
        }
      } catch {
        rttMs = performance.now() - t0;
        timeout = rttMs >= HEALTH_TIMEOUT_MS - 5;
      }
    }
    lastHealth = { ok: healthOk, timeout, rttMs, store, t: Date.now() };
    if (!healthOk) healthFails += 1;
    else healthFails = 0;
    fireAlert("health.down", "page", timeout ? "loopback /health timeout" : "loopback /health failed", healthFails >= 2);

    if (hooks.sqlite.busy) {
      if (sawBusyAtSample) fireAlert("sqlite.busy", "page", "sqlite still busy at sample", true);
      sawBusyAtSample = true;
    } else {
      sawBusyAtSample = false;
      fireAlert("sqlite.busy", "page", "sqlite idle", false);
    }

    const tunnel = detectCloudflared();
    const local = listening();
    const tunnelBad = tunnel === "missing" || (tunnel === "up" && !local);
    if (tunnelBad) tunnelFails += 1;
    else tunnelFails = 0;
    fireAlert(
      "tunnel.down",
      "page",
      tunnel === "missing" ? "cloudflared not running" : "cloudflared not connected to local port",
      tunnelFails >= 2,
    );

    const snap = await snapshot();
    const point: SamplePoint = {
      t: Date.now(),
      p50Ms: snap.http.p50Ms,
      p95Ms: snap.http.p95Ms,
      httpCount: snap.http.count,
      httpErrors: snap.http.errors,
      onlineCount: snap.onlineCount,
      writeMs: snap.sqlite.writeLatencyMs.last,
      rttMs,
      healthOk,
    };
    samples.push(point);
    const cutoff = Date.now() - HTTP_WINDOW_MS;
    while (samples.length && samples[0]!.t < cutoff) samples.shift();
    const dir = hooks.config.monitorDir;
    if (dir) {
      mkdirSync(dir, { recursive: true });
      appendJsonl(join(dir, `samples-${utcDay(point.t)}.jsonl`), point);
      pruneMonitorDir(dir);
    }
  };

  const handlePage = async (req: Request, res: Response) => {
    const token = hooks.config.adminToken;
    if (!token) {
      send404(res);
      return;
    }
    if (!adminTokenFrom(req)) {
      noStore(res);
      res.status(200).type("html").send(renderLoginPage());
      return;
    }
    if (!authorized(req, res)) return;
    const snap = await snapshot();
    noStore(res);
    res.status(200).type("html").send(renderMonitorPage(snap, samples));
  };

  const handleMetrics = async (req: Request, res: Response) => {
    if (!authorized(req, res)) return;
    const snap = await snapshot();
    noStore(res);
    res.status(200).json(snap);
  };

  const handleLogin = (req: Request, res: Response) => {
    const token = hooks.config.adminToken;
    if (!token) {
      send404(res);
      return;
    }
    const ip = clientIp(req);
    const now = Date.now();
    const recent = (authFails.get(ip) ?? []).filter((t) => now - t < AUTH_MISS_WINDOW_MS);
    if (recent.length >= AUTH_MISS_MAX) {
      send404(res);
      return;
    }
    const body = req.body as { token?: unknown } | undefined;
    const got = typeof body?.token === "string" ? body.token : "";
    if (!got || !safeEqual(got, token)) {
      recent.push(now);
      authFails.set(ip, recent);
      send404(res);
      return;
    }
    const secure = req.secure || req.headers["x-forwarded-proto"] === "https";
    const parts = [
      `${ADMIN_COOKIE}=${encodeURIComponent(token)}`,
      "HttpOnly",
      "SameSite=Strict",
      "Path=/admin",
      "Max-Age=86400",
    ];
    if (secure) parts.push("Secure");
    noStore(res);
    res.setHeader("set-cookie", parts.join("; "));
    res.redirect(303, "/admin");
  };

  const handle = async (req: Request, res: Response): Promise<boolean> => {
    const path = req.path.replace(/\/$/, "") || "/";
    const method = req.method.toUpperCase();
    if (path === "/metrics" && method === "GET") {
      await handleMetrics(req, res);
      return true;
    }
    if ((path === "/admin" || path === "/admin/monitor") && method === "GET") {
      await handlePage(req, res);
      return true;
    }
    if (path === "/admin/session" && method === "POST") {
      handleLogin(req, res);
      return true;
    }
    return false;
  };

  return {
    recordHttp,
    recordError,
    noteWrite,
    handle,
    snapshot,
    sampleNow,
    hourSamples: () => samples,
    start(origin, isListening) {
      loopbackOrigin = origin.replace(/\/$/, "");
      listening = isListening;
      const loaded = loadHourSamples(hooks.config.monitorDir, Date.now());
      samples.splice(0, samples.length, ...loaded);
      timer = setInterval(() => {
        void sampleNow();
      }, SAMPLE_INTERVAL_MS);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
