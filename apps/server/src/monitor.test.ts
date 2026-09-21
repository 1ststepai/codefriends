import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./app.js";
import { defaultMonitorDir } from "./config.js";
import { createSqliteStats, withSqliteBusy, WRITE_PAGE_MS, WRITE_WARN_MS } from "./db/sqlite.js";
import { createMonitor, pruneMonitorDir, RETENTION_MS } from "./monitor.js";
import type { ServerConfig } from "./config.js";

async function json<T>(res: Response, label: string): Promise<T> {
  const text = await res.text();
  assert.equal(res.ok, true, `${label} failed: ${res.status} ${text}`);
  return JSON.parse(text) as T;
}

function stubConfig(dir: string, extra?: Partial<ServerConfig>): ServerConfig {
  return {
    publicUrl: "http://127.0.0.1:0",
    popoutUrl: "http://127.0.0.1:5173",
    sessionTtlMs: 1000,
    handoffTtlMs: 1000,
    oauthStateTtlMs: 1000,
    devLogin: true,
    mockProviders: false,
    dmHistoryLimit: 200,
    inviteTtlMs: 1000,
    storeKind: "sqlite",
    corsOrigins: [],
    google: { clientId: "", clientSecret: "", callbackUrl: "" },
    dbPath: join(dir, "db.sqlite"),
    libsqlUrl: "",
    libsqlAuthToken: "",
    host: "127.0.0.1",
    port: 0,
    popoutDir: dir,
    servePopout: false,
    adminToken: extra?.adminToken ?? "",
    monitorDir: extra?.monitorDir ?? join(dir, "monitor"),
    agentMemoryPath: extra?.agentMemoryPath ?? "",
    ...extra,
  };
}

export async function runMonitorTests(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "codefriends-monitor-"));

  assert.equal(defaultMonitorDir(":memory:"), null);
  assert.equal(defaultMonitorDir("/data/codefriends.sqlite"), join("/data", "monitor"));
  assert.equal(defaultMonitorDir("/data/x.sqlite", "/custom"), "/custom");

  const oldDay = new Date(Date.now() - RETENTION_MS - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const keepDay = new Date().toISOString().slice(0, 10);
  const pruneDir = join(dir, "prune");
  mkdirSync(pruneDir, { recursive: true });
  writeFileSync(join(pruneDir, `samples-${oldDay}.jsonl`), "{}\n");
  writeFileSync(join(pruneDir, `samples-${keepDay}.jsonl`), "{}\n");
  writeFileSync(
    join(pruneDir, "alerts.jsonl"),
    `${JSON.stringify({ t: Date.now() - RETENTION_MS - 1000, key: "old" })}\n${JSON.stringify({ t: Date.now(), key: "new" })}\n`,
  );
  pruneMonitorDir(pruneDir);
  assert.equal(existsSync(join(pruneDir, `samples-${oldDay}.jsonl`)), false, "old samples pruned");
  assert.equal(existsSync(join(pruneDir, `samples-${keepDay}.jsonl`)), true, "fresh samples kept");
  const alertsLeft = readFileSync(join(pruneDir, "alerts.jsonl"), "utf8");
  assert.equal(alertsLeft.includes('"old"'), false);
  assert.equal(alertsLeft.includes('"new"'), true);

  const missingMem = join(dir, "no-such-memory.jsonl");
  const presentMem = join(dir, "agent-memory.jsonl");
  writeFileSync(presentMem, "");
  const stats = createSqliteStats("sqlite");
  const mon = createMonitor({
    config: stubConfig(dir, { agentMemoryPath: missingMem, adminToken: "t", monitorDir: join(dir, "mon-a") }),
    sqlite: stats,
    onlineCount: async () => 0,
    wsClients: () => 0,
  });
  mon.noteWrite(WRITE_PAGE_MS + 20);
  assert.equal(existsSync(missingMem), false, "missing agent memory path is a no-op");
  mon.stop();

  const stats2 = createSqliteStats("sqlite");
  const mon2 = createMonitor({
    config: stubConfig(dir, { agentMemoryPath: presentMem, adminToken: "t", monitorDir: join(dir, "mon-b") }),
    sqlite: stats2,
    onlineCount: async () => 0,
    wsClients: () => 0,
  });
  withSqliteBusy(stats2, true, () => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, WRITE_WARN_MS + 10);
  });
  assert.ok((stats2.lastWriteMs ?? 0) > WRITE_WARN_MS, "slow write is yellow");
  withSqliteBusy(stats2, true, () => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, WRITE_PAGE_MS + 15);
  });
  assert.ok((stats2.lastWriteMs ?? 0) > WRITE_PAGE_MS, "slower write is red");
  const snap = await mon2.snapshot();
  assert.equal(snap.sqlite.connections, 1);
  assert.equal(snap.sqlite.busy, false);
  assert.ok((snap.sqlite.writeLatencyMs.last ?? 0) > WRITE_PAGE_MS);
  mon2.noteWrite(WRITE_PAGE_MS + 40);
  const alertFile = join(dir, "mon-b", "alerts.jsonl");
  const first = readFileSync(alertFile, "utf8").trim().split("\n");
  const writes = first.filter((line) => {
    try {
      return (JSON.parse(line) as { key?: string }).key === "sqlite.write";
    } catch {
      return false;
    }
  });
  assert.ok(writes.length >= 1, "sqlite.write alert recorded");
  mon2.noteWrite(WRITE_PAGE_MS + 40);
  const second = readFileSync(alertFile, "utf8").trim().split("\n");
  const writes2 = second.filter((line) => {
    try {
      return (JSON.parse(line) as { key?: string }).key === "sqlite.write";
    } catch {
      return false;
    }
  });
  assert.equal(writes2.length, writes.length, "sqlite.write suppressed inside 15 minutes");
  assert.match(readFileSync(presentMem, "utf8"), /sqlite\.write/, "existing agent-memory file gets a line");
  mon2.stop();

  const off = await startServer({
    port: 0,
    seed: false,
    dbPath: join(dir, "off.sqlite"),
    config: { dbPath: join(dir, "off.sqlite"), devLogin: true, adminToken: "", monitorDir: null },
  });
  try {
    const metrics = await fetch(`${off.url}/metrics`);
    assert.equal(metrics.status, 404);
    assert.equal(await metrics.text(), "");
    const admin = await fetch(`${off.url}/admin`);
    assert.equal(admin.status, 404);
    const health = await json<Record<string, unknown>>(await fetch(`${off.url}/health`), "health");
    assert.deepEqual(Object.keys(health).sort(), ["dmHistoryLimit", "name", "ok", "onlineCount", "store"]);
    assert.equal(health.store, "sqlite");
  } finally {
    await off.close();
  }

  const popoutDir = mkdtempSync(join(tmpdir(), "cf-admin-popout-"));
  writeFileSync(join(popoutDir, "index.html"), "<!doctype html><title>popout</title><p>ok</p>");
  const spa = await startServer({
    port: 0,
    seed: false,
    dbPath: join(dir, "spa.sqlite"),
    config: {
      dbPath: join(dir, "spa.sqlite"),
      devLogin: true,
      adminToken: "",
      popoutDir,
      servePopout: true,
      monitorDir: null,
    },
  });
  try {
    const stolen = await fetch(`${spa.url}/admin`);
    assert.equal(stolen.status, 404);
    assert.doesNotMatch(await stolen.text(), /<p>ok<\/p>/);
    const stolenMetrics = await fetch(`${spa.url}/metrics`);
    assert.equal(stolenMetrics.status, 404);
  } finally {
    await spa.close();
  }

  const token = "monitor-test-token";
  const on = await startServer({
    port: 0,
    seed: false,
    dbPath: join(dir, "on.sqlite"),
    config: {
      dbPath: join(dir, "on.sqlite"),
      devLogin: true,
      adminToken: token,
      monitorDir: join(dir, "on-mon"),
      google: { clientId: "cid", clientSecret: "csec", callbackUrl: "http://127.0.0.1/cb" },
    },
  });
  try {
    const wrong = await fetch(`${on.url}/metrics`, { headers: { authorization: "Bearer nope" } });
    assert.equal(wrong.status, 404);
    const session = await fetch(`${on.url}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "maya" }),
    });
    const { token: userToken } = (await session.json()) as { token: string };
    const asUser = await fetch(`${on.url}/metrics`, { headers: { authorization: `Bearer ${userToken}` } });
    assert.equal(asUser.status, 404, "normal session must not unlock metrics");

    const ok = await json<Record<string, unknown>>(
      await fetch(`${on.url}/metrics`, { headers: { authorization: `Bearer ${token}` } }),
      "metrics bearer",
    );
    assert.equal(ok.ok, true);
    assert.equal(ok.name, "codefriends");
    assert.equal(typeof ok.uptimeSec, "number");
    assert.ok(ok.memory && typeof (ok.memory as { rss: number }).rss === "number");
    const http = ok.http as { count: number; histogramMs: Record<string, number>; p50Ms: number; p95Ms: number };
    assert.equal(typeof http.count, "number");
    assert.equal(typeof http.histogramMs.le10, "number");
    const sqlite = ok.sqlite as {
      connections: number;
      busy: boolean;
      writeLatencyMs: { last: number | null; max5m: number | null };
    };
    assert.equal(sqlite.connections, 1);
    assert.equal(sqlite.busy, false);
    assert.equal(typeof ok.onlineCount, "number");
    assert.equal(typeof ok.wsClients, "number");
    const auth = ok.auth as { gemini: boolean; google: boolean };
    assert.equal(auth.gemini, true);
    assert.equal(auth.google, true);
    const tunnel = ok.tunnel as { cloudflared: string; listeningLocal: boolean };
    assert.ok(["up", "missing", "unknown"].includes(tunnel.cloudflared));
    assert.equal(tunnel.listeningLocal, true);
    assert.equal("lastError" in ok, true);

    const headerOk = await fetch(`${on.url}/metrics`, { headers: { "x-admin-token": token } });
    assert.equal(headerOk.status, 200);

    const loginPage = await fetch(`${on.url}/admin`);
    assert.equal(loginPage.status, 200);
    assert.match(await loginPage.text(), /Admin token/);

    const login = await fetch(`${on.url}/admin/session`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `token=${token}`,
      redirect: "manual",
    });
    assert.equal(login.status, 303);
    const setCookie = login.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /CODEFRIENDS_ADMIN_TOKEN=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    const cookie = setCookie.split(";")[0]!;
    const dash = await fetch(`${on.url}/admin`, { headers: { cookie } });
    assert.equal(dash.status, 200);
    const html = await dash.text();
    assert.match(html, /SQLite writes/);
    assert.match(html, /Last errors/);
    assert.match(html, /Tunnel/);
    assert.doesNotMatch(html, /<p>ok<\/p>/);

    const monitorAlias = await fetch(`${on.url}/admin/monitor`, { headers: { cookie } });
    assert.equal(monitorAlias.status, 200);

    await on.monitor.sampleNow();
    const sampleFiles = readFileSync(join(dir, "on-mon", `samples-${new Date().toISOString().slice(0, 10)}.jsonl`), "utf8");
    assert.match(sampleFiles, /"p95Ms"/);
  } finally {
    await on.close();
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runMonitorTests()
    .then(() => {
      console.log("monitor tests ok");
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
