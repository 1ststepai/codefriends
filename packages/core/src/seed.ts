import { HELP_PACKET_LIBRARY_URL, type ClientKind, type LibraryKind } from "@codefriends/shared";
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

/** GitHub blob base for in-repo docs on the official shelf (same pattern as Help packet). */
const DOCS_BLOB = "https://github.com/1ststepai/codefriends/blob/main/docs";

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
  {
    title: "Help packet",
    description:
      "Write a portable markdown brief so a friend can finish stuck work on their own AI usage, then send back a PR.",
    url: HELP_PACKET_LIBRARY_URL,
    kind: "prompt",
  },
  {
    title: "School Paths",
    description:
      "Build → Finish → Ship: eight tool-agnostic paths from friend-visible demo to restore drill.",
    url: `${DOCS_BLOB}/school-paths/README.md`,
    kind: "prompt",
  },
  {
    title: "Path 01: Friend-visible demo",
    description: "Build — presence + one DM that proves the product is alive for a signed-in friend.",
    url: `${DOCS_BLOB}/school-paths/path-01-friend-visible-demo.md`,
    kind: "prompt",
  },
  {
    title: "Path 02: Auth that isn't a toy",
    description: "Finish — real sign-in, hashed sessions, and honest blocked providers.",
    url: `${DOCS_BLOB}/school-paths/path-02-auth-that-isnt-a-toy.md`,
    kind: "prompt",
  },
  {
    title: "Path 03: Data you won't lose",
    description: "Finish — durable store, named migrations, restart survival for DMs and the board.",
    url: `${DOCS_BLOB}/school-paths/path-03-data-you-wont-lose.md`,
    kind: "prompt",
  },
  {
    title: "Path 04: Secrets & config hygiene",
    description: "Finish — env examples, matching callbacks, never commit keys.",
    url: `${DOCS_BLOB}/school-paths/path-04-secrets-and-config-hygiene.md`,
    kind: "prompt",
  },
  {
    title: "Path 05: Security & abuse basics",
    description: "Finish — bounds, auth gates, and optional security drills (session, redirect, frames, store ACL).",
    url: `${DOCS_BLOB}/school-paths/path-05-input-validation-and-abuse.md`,
    kind: "prompt",
  },
  {
    title: "Path 06: Deploy & health checks",
    description: "Finish → Ship — public https origin, /health green, smoke after deploy.",
    url: `${DOCS_BLOB}/school-paths/path-06-deploy-and-health-checks.md`,
    kind: "prompt",
  },
  {
    title: "Path 07: Observability",
    description: "Ship — readable failures and gated metrics without dumping secrets.",
    url: `${DOCS_BLOB}/school-paths/path-07-observability.md`,
    kind: "prompt",
  },
  {
    title: "Path 08: Recovery & backups",
    description: "Ship — practice one restore path before the disk dies. Seeds are not a backup.",
    url: `${DOCS_BLOB}/school-paths/path-08-recovery-and-backups.md`,
    kind: "prompt",
  },
  {
    title: "Path help packets",
    description:
      "Build → Finish → Ship packets: failure scenario, one fix, Ask your AI, prove-it, friend review.",
    url: `${DOCS_BLOB}/help-packets/README.md`,
    kind: "prompt",
  },
  {
    title: "Security: Session regenerate",
    description: "Optional Path 05 — rotate session/token after login so a planted id cannot ride auth.",
    url: `${DOCS_BLOB}/help-packets/security-session-regenerate.md`,
    kind: "prompt",
  },
  {
    title: "Security: Redirect allowlist",
    description: "Optional Path 05 — stop post-login open redirects from sending friends to phishing hosts.",
    url: `${DOCS_BLOB}/help-packets/security-redirect-allowlist.md`,
    kind: "prompt",
  },
  {
    title: "Security: Frame denial",
    description: "Optional Path 05 — X-Frame-Options / CSP frame-ancestors so your UI cannot be costumed in an iframe.",
    url: `${DOCS_BLOB}/help-packets/security-frame-denial.md`,
    kind: "prompt",
  },
  {
    title: "Security: Session-store ACL",
    description: "Optional Path 05 — lock down Redis-like session caches (or document why local sessions are enough).",
    url: `${DOCS_BLOB}/help-packets/security-session-store-acl.md`,
    kind: "prompt",
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
      if (
        existing.createdAt !== createdAt ||
        existing.title !== row.title ||
        existing.description !== row.description ||
        existing.kind !== row.kind
      ) {
        await store.db
          .prepare(
            "UPDATE library_items SET title = ?, description = ?, kind = ?, created_at = ? WHERE id = ?",
          )
          .run(row.title, row.description, row.kind, createdAt, existing.id);
      }
      continue;
    }
    await store.addLibraryItem(author.id, { ...row, createdAt }, "official");
  }
}
