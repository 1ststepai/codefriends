/**
 * Proves two users can go online, exchange a 1:1 DM, and that the
 * conversation (plus linked identities) survives a process restart.
 * Starts an ephemeral server — no extra process required.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import type { LinkedIdentity, WsServerMessage } from "@codefriends/shared";
import { startServer } from "./app.js";

async function login(base: string, username: string) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username }),
  });
  return json<{ token: string; user: { id: string; username: string } }>(res, `login ${username}`);
}

async function json<T>(res: Response, label: string): Promise<T> {
  const text = await res.text();
  assert.equal(res.ok, true, `${label} failed: ${res.status} ${text}`);
  return JSON.parse(text) as T;
}

function connect(base: string, token: string) {
  const wsUrl = base.replace(/^http/, "ws") + `/ws?token=${token}`;
  const ws = new WebSocket(wsUrl);
  const inbox: WsServerMessage[] = [];
  const waiters: Array<(msg: WsServerMessage) => void> = [];

  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString()) as WsServerMessage;
    const waiter = waiters.shift();
    if (waiter) waiter(msg);
    else inbox.push(msg);
  });

  const next = (timeoutMs = 3000) =>
    new Promise<WsServerMessage>((resolve, reject) => {
      if (inbox.length) {
        resolve(inbox.shift()!);
        return;
      }
      const timer = setTimeout(() => reject(new Error("timed out waiting for WS message")), timeoutMs);
      waiters.push((msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });

  const waitFor = async (type: WsServerMessage["type"], timeoutMs = 3000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const msg = await next(deadline - Date.now());
      if (msg.type === type) return msg;
    }
    throw new Error(`timed out waiting for ${type}`);
  };

  const ready = new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });

  return { ws, next, waitFor, ready };
}

async function liveDm(url: string) {
  const maya = await login(url, "maya");
  const parker = await login(url, "parker");

  const a = connect(url, maya.token);
  const b = connect(url, parker.token);
  await Promise.all([a.ready, b.ready]);

  const helloA = await a.waitFor("hello_ok");
  const helloB = await b.waitFor("hello_ok");
  assert.equal(helloA.type, "hello_ok");
  assert.equal(helloB.type, "hello_ok");
  if (helloA.type === "hello_ok") {
    assert.equal(helloA.self.username, "maya");
    assert.equal(helloA.self.online, true);
    assert.ok(helloA.friends.some((f) => f.username === "parker"));
  }

  const presence = await fetch(`${url}/api/presence`);
  const summary = (await presence.json()) as { onlineCount: number };
  assert.equal(summary.onlineCount, 2, "both users should be online");

  const text = `shipping the popout so it does not eat IDE RAM ${Date.now()}`;
  a.ws.send(
    JSON.stringify({
      type: "dm",
      to: parker.user.id,
      text,
    }),
  );

  const incoming = await b.waitFor("dm");
  assert.equal(incoming.type, "dm");
  if (incoming.type === "dm") {
    assert.equal(incoming.message.from, maya.user.id);
    assert.equal(incoming.message.to, parker.user.id);
    assert.match(incoming.message.text, /popout/);
  }

  const echo = await a.waitFor("dm");
  assert.equal(echo.type, "dm");

  const health = await fetch(`${url}/health`);
  assert.equal(((await health.json()) as { ok: boolean; store?: string }).ok, true);

  a.ws.close();
  b.ws.close();
  return { maya, parker, text };
}

async function persistAcrossRestart(dbPath: string) {
  const first = await startServer({
    port: 0,
    seed: true,
    dbPath,
    config: { dbPath, devLogin: true, mockProviders: true },
  });
  let marker: string;
  let mayaId: string;
  let parkerId: string;
  try {
    const live = await liveDm(first.url);
    marker = live.text;
    mayaId = live.maya.user.id;
    parkerId = live.parker.user.id;
  } finally {
    await first.close();
  }

  const second = await startServer({
    port: 0,
    seed: true,
    dbPath,
    config: { dbPath, devLogin: true, mockProviders: true },
  });
  try {
    const maya = await login(second.url, "maya");
    assert.equal(maya.user.id, mayaId, "maya id must survive restart");
    const history = await json<{ messages: Array<{ text: string; from: string; to: string }> }>(
      await fetch(`${second.url}/api/messages?with=${parkerId}`, {
        headers: { authorization: `Bearer ${maya.token}` },
      }),
      "messages after restart",
    );
    assert.ok(
      history.messages.some((m) => m.text === marker && m.from === mayaId && m.to === parkerId),
      "1:1 DM must still be there after restart",
    );

    const cursor = await json<{ token: string; user: { id: string; username: string } }>(
      await fetch(`${second.url}/api/auth/cursor/mock`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subject: "cursor-acct-maya",
          displayName: "Maya C",
          usernameHint: "mayacursor",
        }),
      }),
      "cursor mock login",
    );

    const linked = await json<{ token: string; user: { id: string; identities?: LinkedIdentity[] } }>(
      await fetch(`${second.url}/api/auth/claude/mock`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${cursor.token}`,
        },
        body: JSON.stringify({
          subject: "claude-acct-maya",
          email: "maya@example.test",
          displayName: "Maya C",
        }),
      }),
      "claude mock link",
    );
    assert.equal(linked.user.id, cursor.user.id, "linking must keep the same CodeFriends user");

    const viaClaude = await json<{ user: { id: string; identities?: LinkedIdentity[] } }>(
      await fetch(`${second.url}/api/auth/claude/mock`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject: "claude-acct-maya" }),
      }),
      "claude mock re-login",
    );
    assert.equal(viaClaude.user.id, cursor.user.id, "same human via Claude must resolve to one user");

    const me = await json<{ identities: LinkedIdentity[] }>(
      await fetch(`${second.url}/api/me`, {
        headers: { authorization: `Bearer ${linked.token}` },
      }),
      "me identities",
    );
    const providers = me.identities.map((i) => i.provider).sort();
    assert.deepEqual(providers, ["claude", "cursor"]);
  } finally {
    await second.close();
  }
}

async function historyCap(dbPath: string) {
  const server = await startServer({
    port: 0,
    seed: false,
    dbPath,
    config: { dbPath, devLogin: true, dmHistoryLimit: 3 },
  });
  try {
    const maya = await login(server.url, "maya");
    const parker = await login(server.url, "parker");
    const added = await fetch(`${server.url}/api/friends`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${maya.token}`,
      },
      body: JSON.stringify({ username: "parker" }),
    });
    await json(added, "add friend");

    const a = connect(server.url, maya.token);
    await a.ready;
    await a.waitFor("hello_ok");

    for (let i = 0; i < 5; i += 1) {
      a.ws.send(JSON.stringify({ type: "dm", to: parker.user.id, text: `cap-${i}` }));
      await a.waitFor("dm");
    }

    const history = await json<{ messages: Array<{ text: string }> }>(
      await fetch(`${server.url}/api/messages?with=${parker.user.id}`, {
        headers: { authorization: `Bearer ${maya.token}` },
      }),
      "capped history",
    );
    assert.equal(history.messages.length, 3, "thread must keep only the last N DMs");
    assert.deepEqual(
      history.messages.map((m) => m.text),
      ["cap-2", "cap-3", "cap-4"],
    );
    a.ws.close();
  } finally {
    await server.close();
  }
}

async function servePopout(dbPath: string) {
  const popoutDir = mkdtempSync(join(tmpdir(), "codefriends-popout-"));
  mkdirSync(join(popoutDir, "assets"), { recursive: true });
  writeFileSync(join(popoutDir, "index.html"), "<!doctype html><title>popout</title><p>ok</p>");
  writeFileSync(join(popoutDir, "assets", "app.js"), "console.log('popout')");

  const server = await startServer({
    port: 0,
    seed: false,
    dbPath,
    config: { dbPath, devLogin: true, popoutDir, servePopout: true },
  });
  try {
    const home = await fetch(`${server.url}/`);
    assert.equal(home.status, 200, `GET / ${home.status}`);
    assert.match(await home.text(), /<p>ok<\/p>/);

    const asset = await fetch(`${server.url}/assets/app.js`);
    assert.equal(asset.status, 200, `GET /assets/app.js ${asset.status}`);
    assert.match(await asset.text(), /popout/);

    const spa = await fetch(`${server.url}/some/client/route`);
    assert.equal(spa.status, 200, `SPA fallback ${spa.status}`);
    assert.match(await spa.text(), /<p>ok<\/p>/);

    const health = await json<{ ok: boolean; store: string }>(
      await fetch(`${server.url}/health`),
      "health through static mount",
    );
    assert.equal(health.ok, true);
    assert.equal(health.store, "sqlite");
  } finally {
    await server.close();
  }
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "codefriends-smoke-"));
  await persistAcrossRestart(join(dir, "persist.sqlite"));
  await historyCap(join(dir, "cap.sqlite"));
  await servePopout(join(dir, "popout.sqlite"));
  console.log(
    "smoke ok: maya + parker online, 1:1 DM delivered, history survived restart, identities linked, DM cap pruned, popout static served",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
