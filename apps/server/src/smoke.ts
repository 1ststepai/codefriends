/**
 * Proves two users can go online and exchange a 1:1 DM over WebSocket.
 * Starts an ephemeral server — no extra process required.
 */
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import type { WsServerMessage } from "@codefriends/shared";
import { startServer } from "./app.js";

async function login(base: string, username: string) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username }),
  });
  assert.equal(res.ok, true, `login ${username} failed: ${res.status}`);
  return (await res.json()) as {
    token: string;
    user: { id: string; username: string };
  };
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

async function main() {
  const server = await startServer({ port: 0, seed: true });
  try {
    const maya = await login(server.url, "maya");
    const parker = await login(server.url, "parker");

    const a = connect(server.url, maya.token);
    const b = connect(server.url, parker.token);
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

    const presence = await fetch(`${server.url}/api/presence`);
    const summary = (await presence.json()) as { onlineCount: number };
    assert.equal(summary.onlineCount, 2, "both users should be online");

    a.ws.send(
      JSON.stringify({
        type: "dm",
        to: parker.user.id,
        text: "shipping the popout so it does not eat IDE RAM",
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

    const health = await fetch(`${server.url}/health`);
    assert.equal((await health.json() as { ok: boolean }).ok, true);

    a.ws.close();
    b.ws.close();
    console.log("smoke ok: maya + parker online, 1:1 DM delivered");
  } finally {
    await server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
