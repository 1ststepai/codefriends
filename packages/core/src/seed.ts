import type { ClientKind } from "@codefriends/shared";
import type { Store } from "./store.js";

const HOUR = 3_600_000;
const DAY = 86_400_000;

const DEMO: Array<{
  username: string;
  displayName: string;
  client: ClientKind;
  statusText: string;
  lastSeenOffset?: number;
}> = [
  { username: "maya", displayName: "maya", client: "cursor", statusText: "in a refactor" },
  { username: "devjay", displayName: "devjay", client: "claude", statusText: "Available" },
  { username: "sam", displayName: "sam", client: "codex", statusText: "Available" },
  { username: "rio", displayName: "rio", client: "gemini", statusText: "Available" },
  {
    username: "alex",
    displayName: "alex",
    client: "web",
    statusText: "Available",
    lastSeenOffset: 40 * 60_000,
  },
  {
    username: "casey",
    displayName: "casey",
    client: "cursor",
    statusText: "working on docs",
    lastSeenOffset: 25 * 60_000,
  },
  {
    username: "taylor",
    displayName: "taylor",
    client: "cursor",
    statusText: "pair programming",
    lastSeenOffset: 5 * HOUR,
  },
  {
    username: "jordan",
    displayName: "jordan",
    client: "cursor",
    statusText: "Available",
    lastSeenOffset: 2 * HOUR,
  },
  {
    username: "parker",
    displayName: "parker",
    client: "cursor",
    statusText: "Available",
    lastSeenOffset: DAY,
  },
];

/** Idempotent: inserts missing seed users/edges/DMs, never wipes existing rows. */
export async function seedDemo(store: Store): Promise<void> {
  const created = [];
  for (const row of DEMO) {
    const existing = await store.userByName(row.username);
    if (existing) {
      await store.ensureIdentity(existing.id, {
        provider: "dev",
        subject: existing.username,
        displayName: existing.displayName,
        usernameHint: existing.username,
      });
      created.push(existing);
      continue;
    }
    const user = await store.createUser({
      username: row.username,
      displayName: row.displayName,
      client: row.client,
      statusText: row.statusText,
      lastSeen: Date.now() - (row.lastSeenOffset ?? 0),
    });
    await store.ensureIdentity(user.id, {
      provider: "dev",
      subject: user.username,
      displayName: user.displayName,
      usernameHint: user.username,
    });
    created.push(user);
  }

  for (const a of created) {
    for (const b of created) {
      if (a.id !== b.id) await store.addFriend(a.id, b.username);
    }
  }

  const maya = (await store.userByName("maya"))!;
  const parker = (await store.userByName("parker"))!;
  if (!(await store.conversationHasMessages(maya.id, parker.id))) {
    await store.addMessage(maya.id, parker.id, "Heyyyy, curious what you're working on.");
    await store.addMessage(maya.id, parker.id, "That refactor look interesting.");
  }
}

export const DEMO_USERNAMES = DEMO.map((d) => d.username);
