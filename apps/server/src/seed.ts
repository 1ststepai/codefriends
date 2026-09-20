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
  { username: "alex", displayName: "alex", client: "web", statusText: "Available" },
  { username: "casey", displayName: "casey", client: "cursor", statusText: "working on docs" },
  { username: "taylor", displayName: "taylor", client: "cursor", statusText: "pair programming" },
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

export function seedDemo(store: Store): void {
  const created = DEMO.map((row) =>
    store.createUser({
      username: row.username,
      displayName: row.displayName,
      client: row.client,
      statusText: row.statusText,
      lastSeen: Date.now() - (row.lastSeenOffset ?? 0),
    }),
  );

  for (const a of created) {
    for (const b of created) {
      if (a.id !== b.id) store.friends.get(a.id)!.add(b.id);
    }
  }

  const maya = store.userByName("maya")!;
  const parker = store.userByName("parker")!;
  store.addMessage(maya.id, parker.id, "Heyyyy, curious what you're working on.");
  store.addMessage(maya.id, parker.id, "That refactor look interesting.");
}

export const DEMO_USERNAMES = DEMO.map((d) => d.username);
