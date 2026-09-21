import type { ClientKind, LibraryKind } from "@codefriends/shared";
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

export const OFFICIAL_LIBRARY_USERNAME = "1ststep";

/** Official 1stStep shelf. GitHub URLs are seeded even when a repo is private — self-hosted cohorts can open it. */
const OFFICIAL_LIBRARY: Array<{
  title: string;
  description: string;
  url: string;
  kind: LibraryKind;
}> = [
  {
    title: "AI user starter kit",
    description: "First-week toolkit — map, playbook, and safety notes. The 1stStep place to start your build.",
    url: "https://github.com/1ststepai/ai-user-starter-kit",
    kind: "github",
  },
  {
    title: "Auto model router",
    description: "Pick a lighter model when the task is small. Works across Cursor, Claude, and Codex.",
    url: "https://github.com/1ststepai/auto-model-router",
    kind: "github",
  },
  {
    title: "CodeFriends",
    description: "This school — presence, DMs, school board, and the build library. Learn with friends in the room.",
    url: "https://github.com/1ststepai/codefriends",
    kind: "github",
  },
  {
    title: "Repo next steps",
    description: "Paste a public repo URL and get a plain-English checklist of what to do next.",
    url: "https://github.com/1ststepai/repo-next-steps",
    kind: "github",
  },
  {
    title: "1stStep OS Audit",
    description: "Free offline audit of a project — evidence over docs, zero metered cost.",
    url: "https://github.com/1ststepai/1ststep-os-audit",
    kind: "github",
  },
  {
    title: "1stStep OS",
    description: "The 1stStep OS foundation is in progress. Self-hosted cohorts can open this repo to learn the system.",
    url: "https://github.com/1ststepai/1ststep-os",
    kind: "github",
  },
];

/** Idempotent official shelf. Always run — does not depend on the demo roster. */
export async function seedOfficialLibrary(store: Store): Promise<void> {
  let author = await store.userByName(OFFICIAL_LIBRARY_USERNAME);
  if (!author) {
    author = await store.createUser({
      username: OFFICIAL_LIBRARY_USERNAME,
      displayName: "1stStep",
      client: "web",
      statusText: "curating the starter shelf",
    });
    await store.ensureIdentity(author.id, {
      provider: "dev",
      subject: author.username,
      displayName: author.displayName,
      usernameHint: author.username,
    });
  }
  const seededAt = 1_700_000_000_000;
  for (const [index, row] of OFFICIAL_LIBRARY.entries()) {
    const createdAt = seededAt + index;
    const existing = await store.findOfficialLibraryByUrl(row.url);
    if (existing) {
      if (existing.createdAt !== createdAt) {
        await store.db.prepare("UPDATE library_items SET created_at = ? WHERE id = ?").run(createdAt, existing.id);
      }
      continue;
    }
    await store.addLibraryItem(author.id, { ...row, createdAt }, "official");
  }
}
