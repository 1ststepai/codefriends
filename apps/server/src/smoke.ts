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
import { HELP_PACKET_SECTION_HEADINGS } from "@codefriends/shared";
import {
  buildAdapters,
  defaultRuntimeConfig,
  describeProviders,
  popoutRedirect,
} from "@codefriends/core";
import { startServer } from "./app.js";
import { runMonitorTests } from "./monitor.test.js";

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

async function inviteAndStatus(dbPath: string) {
  const server = await startServer({
    port: 0,
    seed: false,
    dbPath,
    config: { dbPath, devLogin: true, popoutUrl: "http://127.0.0.1:5173" },
  });
  try {
    const kit = await login(server.url, "kit");
    const jules = await login(server.url, "jules");
    const nori = await login(server.url, "nori");

    const created = await json<{ token: string; url: string }>(
      await fetch(`${server.url}/api/invites`, {
        method: "POST",
        headers: { authorization: `Bearer ${kit.token}` },
      }),
      "create invite",
    );
    assert.match(created.url, /[?&]invite=/);
    assert.ok(created.token.length >= 16);

    const peeked = await json<{ inviter: { username: string } }>(
      await fetch(`${server.url}/api/invites/${created.token}`),
      "peek invite",
    );
    assert.equal(peeked.inviter.username, "kit");

    const own = await fetch(`${server.url}/api/invites/accept`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${kit.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ token: created.token }),
    });
    assert.equal(own.status, 400, "cannot accept your own invite");

    const a = connect(server.url, kit.token);
    const b = connect(server.url, jules.token);
    await Promise.all([a.ready, b.ready]);
    await a.waitFor("hello_ok");
    await b.waitFor("hello_ok");

    const accepted = await json<{ friend: { username: string }; friends: Array<{ username: string }> }>(
      await fetch(`${server.url}/api/invites/accept`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${jules.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ token: created.url }),
      }),
      "accept invite",
    );
    assert.equal(accepted.friend.username, "kit");
    assert.ok(accepted.friends.some((f) => f.username === "kit"));

    const friendsPush = await a.waitFor("friends");
    assert.equal(friendsPush.type, "friends");
    if (friendsPush.type === "friends") {
      assert.ok(friendsPush.friends.some((f) => f.username === "jules"));
    }

    const reused = await json<{ friend: { username: string } }>(
      await fetch(`${server.url}/api/invites/accept`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${nori.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ token: created.token }),
      }),
      "reuse invite",
    );
    assert.equal(reused.friend.username, "kit");

    const workingOn = `shipping invites ${Date.now()}`;
    a.ws.send(JSON.stringify({ type: "presence", statusText: workingOn, client: "cursor" }));
    const presence = await waitForMatch(b, (msg) => {
      return msg.type === "presence" && msg.user.statusText === workingOn && msg.user.client === "cursor";
    });
    assert.equal(presence.type, "presence");

    const profile = await json<{
      user: {
        githubUrl: string;
        website: string;
        tools: string[];
        twitterUrl: string;
        facebookUrl: string;
        telegramUrl: string;
        whatsappUrl: string;
        currentlyBuilding: string;
        ownsBusiness: boolean;
        businessNote: string;
        wantsToHelpOthersBuild: boolean;
      };
    }>(
      await fetch(`${server.url}/api/me/profile`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${kit.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          githubUrl: "https://github.com/kit-codes",
          website: "https://kit.example",
          tools: "Cursor, Rust",
          twitterUrl: "@kitcodes",
          facebookUrl: "https://facebook.com/kit.codes",
          telegramUrl: "kitcodes",
          whatsappUrl: "+1 555 123 4567",
          currentlyBuilding: "a pairing lesson",
          ownsBusiness: true,
          businessNote: "weekend study club",
          wantsToHelpOthersBuild: true,
        }),
      }),
      "update profile",
    );
    assert.match(profile.user.githubUrl, /github\.com\/kit-codes/);
    assert.deepEqual(profile.user.tools, ["Cursor", "Rust"]);
    assert.equal(profile.user.twitterUrl, "https://x.com/kitcodes");
    assert.match(profile.user.facebookUrl, /facebook\.com\/kit\.codes/);
    assert.equal(profile.user.telegramUrl, "https://t.me/kitcodes");
    assert.equal(profile.user.whatsappUrl, "https://wa.me/15551234567");
    assert.equal(profile.user.currentlyBuilding, "a pairing lesson");
    assert.equal(profile.user.ownsBusiness, true);
    assert.equal(profile.user.businessNote, "weekend study club");
    assert.equal(profile.user.wantsToHelpOthersBuild, true);

    const fetched = await json<{
      user: {
        twitterUrl: string;
        facebookUrl: string;
        telegramUrl: string;
        whatsappUrl: string;
        currentlyBuilding: string;
        ownsBusiness: boolean;
        wantsToHelpOthersBuild: boolean;
      };
    }>(
      await fetch(`${server.url}/api/me`, {
        headers: { authorization: `Bearer ${kit.token}` },
      }),
      "fetch profile",
    );
    assert.equal(fetched.user.twitterUrl, "https://x.com/kitcodes");
    assert.equal(fetched.user.telegramUrl, "https://t.me/kitcodes");
    assert.equal(fetched.user.whatsappUrl, "https://wa.me/15551234567");
    assert.equal(fetched.user.currentlyBuilding, "a pairing lesson");
    assert.equal(fetched.user.ownsBusiness, true);
    assert.equal(fetched.user.wantsToHelpOthersBuild, true);

    const cleared = await json<{
      user: {
        telegramUrl: string;
        twitterUrl: string;
        currentlyBuilding: string;
        wantsToHelpOthersBuild: boolean;
        ownsBusiness: boolean;
      };
    }>(
      await fetch(`${server.url}/api/me/profile`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${kit.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ telegramUrl: "", currentlyBuilding: "", wantsToHelpOthersBuild: false }),
      }),
      "clear telegram",
    );
    assert.equal(cleared.user.telegramUrl, "");
    assert.equal(cleared.user.twitterUrl, "https://x.com/kitcodes");
    assert.equal(cleared.user.currentlyBuilding, "");
    assert.equal(cleared.user.wantsToHelpOthersBuild, false);
    assert.equal(cleared.user.ownsBusiness, true);

    const afterClear = await json<{
      user: { telegramUrl: string; twitterUrl: string; currentlyBuilding: string; ownsBusiness: boolean };
    }>(
      await fetch(`${server.url}/api/me`, {
        headers: { authorization: `Bearer ${kit.token}` },
      }),
      "fetch after clear",
    );
    assert.equal(afterClear.user.telegramUrl, "");
    assert.equal(afterClear.user.twitterUrl, "https://x.com/kitcodes");
    assert.equal(afterClear.user.currentlyBuilding, "");
    assert.equal(afterClear.user.ownsBusiness, true);

    const profilePush = await waitForMatch(b, (msg) => {
      return (
        msg.type === "presence" &&
        msg.user.username === "kit" &&
        Boolean(msg.user.githubUrl?.includes("kit-codes")) &&
        (msg.user.tools ?? []).includes("Rust") &&
        msg.user.twitterUrl === "https://x.com/kitcodes"
      );
    });
    assert.equal(profilePush.type, "presence");

    const badGithub = await fetch(`${server.url}/api/me/profile`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${kit.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ githubUrl: "https://gitlab.com/kit" }),
    });
    assert.equal(badGithub.status, 400, "githubUrl must be github.com");

    const badScheme = await fetch(`${server.url}/api/me/profile`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${kit.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ twitterUrl: "javascript:alert(1)" }),
    });
    assert.equal(badScheme.status, 400, "javascript: socials must be rejected");

    await server.store.db.prepare("UPDATE invites SET expires_at = 1").run();
    const stale = await fetch(`${server.url}/api/invites/${created.token}`);
    assert.equal(stale.status, 404, "expired invite must 404");

    a.ws.close();
    b.ws.close();
  } finally {
    await server.close();
  }
}

async function waitForMatch(
  client: ReturnType<typeof connect>,
  match: (msg: WsServerMessage) => boolean,
  timeoutMs = 3000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const msg = await client.next(deadline - Date.now());
    if (match(msg)) return msg;
  }
  throw new Error("timed out waiting for matching WS message");
}

async function schoolBoard(dbPath: string) {
  const server = await startServer({
    port: 0,
    seed: false,
    dbPath,
    config: { dbPath, devLogin: true },
  });
  try {
    const maya = await login(server.url, "maya");
    const kit = await login(server.url, "kit");

    const denied = await fetch(`${server.url}/api/topics`);
    assert.equal(denied.status, 401, "board is signed-in only");

    const created = await json<{ topic: { id: string; title: string; authorUsername: string } }>(
      await fetch(`${server.url}/api/topics`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${maya.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: "How do you read a stack trace?",
          body: "I keep getting lost after the first frame.",
        }),
      }),
      "create topic",
    );
    assert.equal(created.topic.authorUsername, "maya");
    assert.match(created.topic.title, /stack trace/);

    const empty = await fetch(`${server.url}/api/topics`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${maya.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "   ", body: "notes" }),
    });
    assert.equal(empty.status, 400, "empty title rejected");

    const listed = await json<{ topics: Array<{ id: string; replyCount: number }> }>(
      await fetch(`${server.url}/api/topics`, {
        headers: { authorization: `Bearer ${kit.token}` },
      }),
      "list topics as another signed-in user",
    );
    assert.equal(listed.topics.length, 1);
    assert.equal(listed.topics[0].id, created.topic.id);

    const replied = await json<{ reply: { body: string }; replies: Array<{ body: string }> }>(
      await fetch(`${server.url}/api/topics/${created.topic.id}/replies`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${kit.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ body: "Start at the first line that is your code." }),
      }),
      "reply",
    );
    assert.match(replied.reply.body, /your code/);

    const opened = await json<{ topic: { replyCount: number }; replies: Array<{ authorUsername: string }> }>(
      await fetch(`${server.url}/api/topics/${created.topic.id}`, {
        headers: { authorization: `Bearer ${maya.token}` },
      }),
      "open topic",
    );
    assert.equal(opened.topic.replyCount, 1);
    assert.equal(opened.replies[0].authorUsername, "kit");

    const missing = await fetch(`${server.url}/api/topics/not-a-topic`, {
      headers: { authorization: `Bearer ${maya.token}` },
    });
    assert.equal(missing.status, 404);
  } finally {
    await server.close();
  }
}

async function buildLibrary(dbPath: string) {
  const server = await startServer({
    port: 0,
    seed: false,
    dbPath,
    config: { dbPath, devLogin: true },
  });
  try {
    const maya = await login(server.url, "maya");
    const kit = await login(server.url, "kit");

    const denied = await fetch(`${server.url}/api/library`);
    assert.equal(denied.status, 401, "library is signed-in only");

    const listed = await json<{
      items: Array<{ id: string; title: string; source: string; url: string; authorUsername: string }>;
    }>(
      await fetch(`${server.url}/api/library`, {
        headers: { authorization: `Bearer ${kit.token}` },
      }),
      "list official shelf as user B",
    );
    const official = listed.items.filter((item) => item.source === "official");
    assert.ok(
      official.length >= 17,
      "official 1stStep shelf must include starters, Help packet, School Paths 01–08, and path help packets",
    );
    assert.equal(official[0]?.url, "https://github.com/1ststepai/ai-user-starter-kit");
    const officialUrls = official.map((item) => item.url);
    for (const url of [
      "https://github.com/1ststepai/ai-user-starter-kit",
      "https://github.com/1ststepai/auto-model-router",
      "https://github.com/1ststepai/codefriends",
      "https://github.com/1ststepai/repo-next-steps",
      "https://github.com/1ststepai/1ststep-os-audit",
      "https://github.com/1ststepai/1ststep-os",
      "https://github.com/1ststepai/codefriends/blob/main/docs/help-packet.md",
      "https://github.com/1ststepai/codefriends/blob/main/docs/school-paths/README.md",
      "https://github.com/1ststepai/codefriends/blob/main/docs/school-paths/path-01-friend-visible-demo.md",
      "https://github.com/1ststepai/codefriends/blob/main/docs/school-paths/path-08-recovery-and-backups.md",
      "https://github.com/1ststepai/codefriends/blob/main/docs/help-packets/README.md",
    ]) {
      assert.ok(officialUrls.includes(url), `official shelf missing ${url}`);
    }
    assert.ok(official.some((item) => item.title === "1stStep OS Audit"));
    assert.ok(official.some((item) => item.title === "1stStep OS"));
    assert.ok(official.some((item) => item.title === "School Paths"));
    assert.ok(official.some((item) => item.title === "Path 01: Friend-visible demo"));
    assert.ok(official.some((item) => item.title === "Path help packets"));
    assert.ok(official.every((item) => item.authorUsername === "1ststep"));
    assert.ok(listed.items.every((item) => item.source === "official"));

    const created = await json<{ item: { id: string; title: string; source: string; authorUsername: string } }>(
      await fetch(`${server.url}/api/library`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${maya.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: "Maya’s ChatGPT project",
          description: "A lesson we built together this week.",
          url: "https://chatgpt.com/share/example-lesson",
          kind: "chatgpt",
        }),
      }),
      "create community item as user A",
    );
    assert.equal(created.item.source, "community");
    assert.equal(created.item.authorUsername, "maya");

    const asKit = await json<{ items: Array<{ id: string; source: string; title: string }> }>(
      await fetch(`${server.url}/api/library`, {
        headers: { authorization: `Bearer ${kit.token}` },
      }),
      "list as user B after community add",
    );
    assert.equal(asKit.items[0].source, "official");
    assert.ok(asKit.items.some((item) => item.id === created.item.id && item.title.includes("ChatGPT")));

    const badJs = await fetch(`${server.url}/api/library`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${maya.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "nope",
        description: "script",
        url: "javascript:alert(1)",
        kind: "other",
      }),
    });
    assert.equal(badJs.status, 400, "javascript: URL rejected");

    const badHttp = await fetch(`${server.url}/api/library`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${maya.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "nope",
        description: "insecure",
        url: "http://example.com/demo",
        kind: "demo",
      }),
    });
    assert.equal(badHttp.status, 400, "http URL rejected");

    const steal = await fetch(`${server.url}/api/library/${created.item.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${kit.token}` },
    });
    assert.equal(steal.status, 403, "cannot delete someone else's item");

    const withIds = await json<{ items: Array<{ id: string; source: string }> }>(
      await fetch(`${server.url}/api/library`, {
        headers: { authorization: `Bearer ${maya.token}` },
      }),
      "reload ids",
    );
    const seeded = withIds.items.find((item) => item.source === "official");
    assert.ok(seeded);
    const dropOfficial = await fetch(`${server.url}/api/library/${seeded.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${maya.token}` },
    });
    assert.equal(dropOfficial.status, 403, "cannot delete official shelf item");

    await json<{ ok: boolean }>(
      await fetch(`${server.url}/api/library/${created.item.id}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${maya.token}` },
      }),
      "delete own community item",
    );
  } finally {
    await server.close();
  }
}

async function helpPackets(dbPath: string) {
  const server = await startServer({
    port: 0,
    seed: false,
    dbPath,
    config: { dbPath, devLogin: true },
  });
  try {
    const maya = await login(server.url, "maya");
    const kit = await login(server.url, "kit");

    const denied = await fetch(`${server.url}/api/help-packets`);
    assert.equal(denied.status, 401, "help packets are signed-in only");

    const shelf = await json<{ items: Array<{ title: string; url: string; source: string }> }>(
      await fetch(`${server.url}/api/library`, {
        headers: { authorization: `Bearer ${maya.token}` },
      }),
      "library shelf for help packet",
    );
    assert.ok(
      shelf.items.some(
        (item) => item.source === "official" && item.title === "Help packet" && item.url.includes("help-packet.md"),
      ),
      "official 1stStep shelf must include Help packet",
    );

    const emptyGoal = await fetch(`${server.url}/api/help-packets`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${maya.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "Stuck refactor", goal: "   " }),
    });
    assert.equal(emptyGoal.status, 400, "goal required");

    const created = await json<{ packet: { id: string; title: string; markdown: string; userId: string } }>(
      await fetch(`${server.url}/api/help-packets`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${maya.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: "Stuck on the popout search box",
          goal: "Search filters library items by title.",
          repoUrl: "https://github.com/1ststepai/codefriends",
          branch: "main",
          paths: "apps/popout/src/App.tsx",
          constraints: "Don't add a new dependency.",
          blocked: "Tried a local filter; empty query still hides a row.",
          successCriteria: "Empty query shows the full shelf.",
          sendBack: "PR against main.",
          libraryItemUrl: "https://github.com/1ststepai/codefriends",
        }),
      }),
      "create help packet",
    );
    assert.equal(created.packet.title, "Stuck on the popout search box");
    assert.equal(created.packet.userId, maya.user.id);
    for (const heading of HELP_PACKET_SECTION_HEADINGS) {
      assert.ok(created.packet.markdown.includes(heading), `missing ${heading}`);
    }
    assert.match(created.packet.markdown, /own account/);
    assert.match(created.packet.markdown, /voluntary/i);

    const listed = await json<{ packets: Array<{ id: string }> }>(
      await fetch(`${server.url}/api/help-packets`, {
        headers: { authorization: `Bearer ${maya.token}` },
      }),
      "list own packets",
    );
    assert.equal(listed.packets.length, 1);
    assert.equal(listed.packets[0].id, created.packet.id);

    const fetched = await json<{ packet: { markdown: string } }>(
      await fetch(`${server.url}/api/help-packets/${created.packet.id}`, {
        headers: { authorization: `Bearer ${maya.token}` },
      }),
      "fetch own packet",
    );
    for (const heading of HELP_PACKET_SECTION_HEADINGS) {
      assert.ok(fetched.packet.markdown.includes(heading), `fetched packet missing ${heading}`);
    }

    const steal = await fetch(`${server.url}/api/help-packets/${created.packet.id}`, {
      headers: { authorization: `Bearer ${kit.token}` },
    });
    assert.equal(steal.status, 403, "cannot fetch someone else's packet");

    const kitList = await json<{ packets: Array<{ id: string }> }>(
      await fetch(`${server.url}/api/help-packets`, {
        headers: { authorization: `Bearer ${kit.token}` },
      }),
      "list as other user",
    );
    assert.equal(kitList.packets.length, 0);
  } finally {
    await server.close();
  }
}

function googleAuthCatalogAndRedirects() {
  const live = defaultRuntimeConfig({
    devLogin: false,
    popoutUrl: "https://codefriends.1ststep.ai",
    publicUrl: "https://codefriends.1ststep.ai",
    google: {
      clientId: "id.apps.googleusercontent.com",
      clientSecret: "secret",
      callbackUrl: "https://codefriends.1ststep.ai/api/auth/gemini/callback",
    },
  });
  const catalog = describeProviders(live, buildAdapters(live));
  assert.equal(catalog[0]?.id, "gemini");
  assert.equal(catalog[0]?.label, "Google");
  assert.equal(catalog[0]?.availability, "live");
  assert.equal(catalog[0]?.startPath, "/api/auth/gemini/start");
  for (const id of ["cursor", "claude", "codex"] as const) {
    const listed = catalog.find((p) => p.id === id);
    assert.equal(listed?.availability, "blocked");
    assert.ok(listed?.blockedReason);
  }
  assert.equal(catalog.find((p) => p.id === "dev")?.availability, "blocked");

  const blankCallback = defaultRuntimeConfig({
    publicUrl: "https://codefriends.1ststep.ai",
    google: { clientId: "id", clientSecret: "secret", callbackUrl: "  " },
  });
  assert.equal(blankCallback.google.callbackUrl, "https://codefriends.1ststep.ai/api/auth/gemini/callback");

  assert.equal(
    popoutRedirect(live, { handoff: "abc", provider: "gemini" }),
    "https://codefriends.1ststep.ai/?handoff=abc&provider=gemini",
  );

  const desktop = defaultRuntimeConfig({
    popoutUrl: "codefriends://open",
    publicUrl: "https://codefriends.1ststep.ai",
  });
  assert.equal(
    popoutRedirect(desktop, { handoff: "xyz" }),
    "https://codefriends.1ststep.ai/?handoff=xyz",
  );
}

async function googleOauthHandoff(dbPath: string) {
  const popoutUrl = "https://codefriends.1ststep.ai";
  const callbackUrl = "http://127.0.0.1:8787/api/auth/gemini/callback";
  const server = await startServer({
    port: 0,
    seed: false,
    dbPath,
    config: {
      dbPath,
      devLogin: false,
      popoutUrl,
      google: {
        clientId: "test-client-id.apps.googleusercontent.com",
        clientSecret: "test-secret",
        callbackUrl,
      },
    },
  });
  const originalFetch = globalThis.fetch;
  try {
    const catalog = await json<{
      providers: Array<{
        id: string;
        label: string;
        availability: string;
        startPath?: string;
        blockedReason?: string;
      }>;
    }>(await fetch(`${server.url}/api/auth/providers`), "providers catalog");
    const google = catalog.providers.find((p) => p.id === "gemini");
    assert.equal(google?.label, "Google");
    assert.equal(google?.availability, "live");
    assert.equal(google?.startPath, "/api/auth/gemini/start");
    const cursor = catalog.providers.find((p) => p.id === "cursor");
    assert.equal(cursor?.availability, "blocked");
    assert.ok(cursor?.blockedReason);

    const blockedStart = await fetch(`${server.url}/api/auth/cursor/start`, { redirect: "manual" });
    assert.equal(blockedStart.status, 501);
    const blockedBody = (await blockedStart.json()) as { error?: string };
    assert.match(blockedBody.error ?? "", /Cursor does not publish/);

    const started = await fetch(`${server.url}/api/auth/gemini/start?client=web`, { redirect: "manual" });
    assert.equal(started.status, 302);
    const authUrl = new URL(started.headers.get("location") ?? "");
    assert.equal(authUrl.origin + authUrl.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(authUrl.searchParams.get("client_id"), "test-client-id.apps.googleusercontent.com");
    assert.equal(authUrl.searchParams.get("redirect_uri"), callbackUrl);
    assert.equal(authUrl.searchParams.get("code_challenge_method"), "S256");
    assert.ok(authUrl.searchParams.get("code_challenge"));
    const state = authUrl.searchParams.get("state");
    assert.ok(state);

    const expired = await fetch(`${server.url}/api/auth/gemini/callback?code=nope&state=bogus`, {
      redirect: "manual",
    });
    assert.equal(expired.status, 302);
    const expiredAt = new URL(expired.headers.get("location") ?? "");
    assert.equal(expiredAt.origin, popoutUrl);
    assert.match(expiredAt.searchParams.get("error") ?? "", /state expired/i);

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(JSON.stringify({ access_token: "tok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
        return new Response(
          JSON.stringify({ sub: "google-sub-1", email: "evan@example.com", name: "Evan" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const callback = await fetch(
      `${server.url}/api/auth/gemini/callback?code=fake-code&state=${encodeURIComponent(state!)}`,
      { redirect: "manual" },
    );
    assert.equal(callback.status, 302);
    const back = new URL(callback.headers.get("location") ?? "");
    assert.equal(back.origin, popoutUrl);
    const handoff = back.searchParams.get("handoff");
    assert.ok(handoff);
    assert.equal(back.searchParams.get("provider"), "gemini");

    const redeemed = await json<{ token: string; user: { displayName: string; username: string } }>(
      await fetch(`${server.url}/api/auth/handoff/redeem`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: handoff, client: "web" }),
      }),
      "redeem google handoff",
    );
    assert.equal(redeemed.user.displayName, "Evan");

    const me = await json<{ identities: LinkedIdentity[] }>(
      await fetch(`${server.url}/api/me`, { headers: { authorization: `Bearer ${redeemed.token}` } }),
      "me after google",
    );
    assert.equal(me.identities[0]?.provider, "gemini");
    assert.equal(me.identities[0]?.email, "evan@example.com");

    const reused = await fetch(`${server.url}/api/auth/handoff/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: handoff }),
    });
    assert.equal(reused.status, 400, "handoff is one-time");
  } finally {
    globalThis.fetch = originalFetch;
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
    config: { dbPath, devLogin: true, popoutDir, servePopout: true, adminToken: "", monitorDir: null },
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

    const desktop = await fetch(`${server.url}/health`, { headers: { Origin: "tauri://localhost" } });
    assert.equal(desktop.headers.get("access-control-allow-origin"), "tauri://localhost");

    const metrics = await fetch(`${server.url}/metrics`);
    assert.equal(metrics.status, 404, "metrics stays hidden when admin token is unset");
    assert.doesNotMatch(await metrics.text(), /<p>ok<\/p>/);
    const admin = await fetch(`${server.url}/admin`);
    assert.equal(admin.status, 404, "admin stays hidden when admin token is unset");
    assert.doesNotMatch(await admin.text(), /<p>ok<\/p>/);
  } finally {
    await server.close();
  }
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "codefriends-smoke-"));
  googleAuthCatalogAndRedirects();
  await persistAcrossRestart(join(dir, "persist.sqlite"));
  await historyCap(join(dir, "cap.sqlite"));
  await inviteAndStatus(join(dir, "invite.sqlite"));
  await schoolBoard(join(dir, "board.sqlite"));
  await buildLibrary(join(dir, "library.sqlite"));
  await helpPackets(join(dir, "help-packets.sqlite"));
  await servePopout(join(dir, "popout.sqlite"));
  await runMonitorTests();
  await googleOauthHandoff(join(dir, "google-oauth.sqlite"));
  console.log(
    "smoke ok: maya + parker online, 1:1 DM delivered, history survived restart, identities linked, DM cap pruned, invite accepted, status broadcast, profile shared, socials cleared, school board topic+reply, build library official+community, help packet create+fetch, popout static served, admin metrics gated, google oauth start/callback/handoff",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
