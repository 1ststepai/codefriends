import {
  conversationKey,
  DM_TEXT_MAX,
  isValidUsername,
  normalizeUsername,
  type AuthProvider,
  type ChatMessage,
  type ClientKind,
  type LinkedIdentity,
  type PresenceStatus,
  type PublicUser,
} from "@codefriends/shared";
import type { RuntimeConfig } from "./config.js";
import { randomHex, randomUUID, sha256Hex } from "./crypto.js";
import type { Presence } from "./presence.js";
import type { SqlClient } from "./sql.js";
import type { ProviderProfile } from "./auth/types.js";

export interface UserRecord {
  id: string;
  username: string;
  displayName: string;
  status: PresenceStatus;
  statusText: string;
  client: ClientKind;
  lastSeen: number;
  createdAt: number;
}

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  status: string;
  status_text: string;
  client: string;
  last_seen: number;
  created_at: number;
}

export class Store {
  constructor(
    readonly db: SqlClient,
    readonly config: RuntimeConfig,
    readonly presence: Presence,
  ) {}

  async createUser(input: {
    username: string;
    displayName?: string;
    status?: PresenceStatus;
    statusText?: string;
    client?: ClientKind;
    lastSeen?: number;
  }): Promise<UserRecord> {
    const username = normalizeUsername(input.username);
    if (!isValidUsername(username)) {
      throw new Error("Usernames must be 2–24 chars: letters, numbers, _ or -");
    }
    if (await this.userByName(username)) {
      throw new Error("That username is already taken");
    }
    const user: UserRecord = {
      id: randomUUID(),
      username,
      displayName: input.displayName?.trim() || username,
      status: input.status ?? "available",
      statusText: input.statusText ?? "Available",
      client: input.client ?? "web",
      lastSeen: input.lastSeen ?? Date.now(),
      createdAt: Date.now(),
    };
    await this.db
      .prepare(
        `INSERT INTO users (id, username, display_name, status, status_text, client, last_seen, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        user.id,
        user.username,
        user.displayName,
        user.status,
        user.statusText,
        user.client,
        user.lastSeen,
        user.createdAt,
      );
    return user;
  }

  async getUser(id: string): Promise<UserRecord | undefined> {
    const row = await this.db.prepare("SELECT * FROM users WHERE id = ?").get<UserRow>(id);
    return row ? rowToUser(row) : undefined;
  }

  async allUserIds(): Promise<string[]> {
    const rows = await this.db.prepare("SELECT id FROM users").all<{ id: string }>();
    return rows.map((r) => r.id);
  }

  async friendIds(userId: string): Promise<string[]> {
    const rows = await this.db
      .prepare("SELECT friend_id FROM friends WHERE user_id = ?")
      .all<{ friend_id: string }>(userId);
    return rows.map((r) => r.friend_id);
  }

  async issueToken(userId: string): Promise<string> {
    const token = randomHex(32);
    const now = Date.now();
    await this.db
      .prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(await sha256Hex(token), userId, now, now + this.config.sessionTtlMs);
    return token;
  }

  async revokeToken(token: string): Promise<void> {
    await this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(await sha256Hex(token));
  }

  async userByToken(token: string | undefined): Promise<UserRecord | undefined> {
    if (!token) return undefined;
    const row = await this.db
      .prepare(
        `SELECT u.* FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ?`,
      )
      .get<UserRow>(await sha256Hex(token), Date.now());
    return row ? rowToUser(row) : undefined;
  }

  async userByName(username: string): Promise<UserRecord | undefined> {
    const row = await this.db
      .prepare("SELECT * FROM users WHERE username = ?")
      .get<UserRow>(normalizeUsername(username));
    return row ? rowToUser(row) : undefined;
  }

  async identityOwner(provider: AuthProvider, subject: string): Promise<UserRecord | undefined> {
    const row = await this.db
      .prepare(
        `SELECT u.* FROM identities i
         JOIN users u ON u.id = i.user_id
         WHERE i.provider = ? AND i.subject = ?`,
      )
      .get<UserRow>(provider, subject);
    return row ? rowToUser(row) : undefined;
  }

  async identitiesOf(userId: string): Promise<LinkedIdentity[]> {
    const rows = await this.db
      .prepare("SELECT provider, email, display_name FROM identities WHERE user_id = ? ORDER BY created_at")
      .all<{ provider: AuthProvider; email: string | null; display_name: string | null }>(userId);
    return rows.map((row) => ({
      provider: row.provider,
      email: row.email ?? undefined,
      displayName: row.display_name ?? undefined,
    }));
  }

  async ensureIdentity(userId: string, profile: ProviderProfile): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO identities (id, user_id, provider, subject, email, display_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        userId,
        profile.provider,
        profile.subject,
        profile.email ?? null,
        profile.displayName ?? null,
        Date.now(),
      );
  }

  async login(
    username: string,
    displayName?: string,
    client?: ClientKind,
  ): Promise<{ user: UserRecord; token: string }> {
    if (!this.config.devLogin) {
      throw new Error("Dev username login is disabled");
    }
    let user = await this.userByName(username);
    if (!user) {
      user = await this.createUser({ username, displayName, client });
    } else if (displayName?.trim() || client) {
      if (displayName?.trim()) user.displayName = displayName.trim();
      if (client) user.client = client;
      await this.persistUser(user);
    }
    await this.ensureIdentity(user.id, {
      provider: "dev",
      subject: user.username,
      displayName: user.displayName,
      usernameHint: user.username,
    });
    return { user, token: await this.issueToken(user.id) };
  }

  /**
   * Find or create a CodeFriends user for a provider account.
   * If `linkUserId` is set, attach the identity to that user instead of creating another.
   */
  async loginWithIdentity(
    profile: ProviderProfile,
    opts?: { linkUserId?: string; client?: ClientKind },
  ): Promise<{ user: UserRecord; token: string; linked: boolean }> {
    if (!profile.subject?.trim()) throw new Error("Provider subject is required");
    const existing = await this.identityOwner(profile.provider, profile.subject);

    if (opts?.linkUserId) {
      const target = await this.getUser(opts.linkUserId);
      if (!target) throw new Error("Session expired — sign in again before linking");
      if (existing && existing.id !== target.id) {
        throw new Error(`That ${profile.provider} account is already linked to @${existing.username}`);
      }
      await this.ensureIdentity(target.id, profile);
      if (opts.client) {
        target.client = opts.client;
        await this.persistUser(target);
      }
      return { user: target, token: await this.issueToken(target.id), linked: true };
    }

    if (existing) {
      if (opts?.client) {
        existing.client = opts.client;
        await this.persistUser(existing);
      }
      return { user: existing, token: await this.issueToken(existing.id), linked: false };
    }

    const user = await this.createUser({
      username: await this.uniqueUsername(usernameHint(profile)),
      displayName: profile.displayName || profile.email || usernameHint(profile),
      client: opts?.client ?? clientForProvider(profile.provider),
    });
    await this.ensureIdentity(user.id, profile);
    return { user, token: await this.issueToken(user.id), linked: false };
  }

  async persistUser(user: UserRecord): Promise<void> {
    await this.db
      .prepare(
        `UPDATE users SET display_name = ?, status = ?, status_text = ?, client = ?, last_seen = ?
         WHERE id = ?`,
      )
      .run(user.displayName, user.status, user.statusText, user.client, user.lastSeen, user.id);
  }

  async updatePresence(
    userId: string,
    patch: { status?: PresenceStatus; statusText?: string; client?: ClientKind },
  ): Promise<UserRecord> {
    const user = await this.getUser(userId);
    if (!user) throw new Error("Unknown user");
    if (patch.status) user.status = patch.status;
    if (typeof patch.statusText === "string") user.statusText = patch.statusText.slice(0, 80);
    if (patch.client) user.client = patch.client;
    await this.persistUser(user);
    return user;
  }

  isConnected(userId: string): boolean {
    return this.presence.isConnected(userId);
  }

  async isOnline(userId: string): Promise<boolean> {
    const user = await this.getUser(userId);
    if (!user || user.status === "offline") return false;
    return this.isConnected(userId);
  }

  async onlineCount(): Promise<number> {
    let n = 0;
    for (const id of await this.allUserIds()) {
      if (await this.isOnline(id)) n += 1;
    }
    return n;
  }

  async toPublic(user: UserRecord, opts?: { identities?: boolean }): Promise<PublicUser> {
    const online = await this.isOnline(user.id);
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      status: online ? user.status : "offline",
      statusText: online ? user.statusText : lastSeenLabel(user.lastSeen),
      client: user.client,
      online,
      lastSeen: user.lastSeen,
      identities: opts?.identities ? await this.identitiesOf(user.id) : undefined,
    };
  }

  async friendList(userId: string): Promise<PublicUser[]> {
    const ids = await this.friendIds(userId);
    const friends: PublicUser[] = [];
    for (const id of ids) {
      const user = await this.getUser(id);
      if (user) friends.push(await this.toPublic(user));
    }
    return friends.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });
  }

  async addFriend(fromId: string, username: string): Promise<PublicUser> {
    const target = await this.userByName(username);
    if (!target) throw new Error("No user with that username");
    if (target.id === fromId) throw new Error("You cannot add yourself");
    const now = Date.now();
    await this.db
      .prepare("INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)")
      .run(fromId, target.id, now);
    await this.db
      .prepare("INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)")
      .run(target.id, fromId, now);
    return this.toPublic(target);
  }

  async areFriends(a: string, b: string): Promise<boolean> {
    const row = await this.db
      .prepare("SELECT 1 as ok FROM friends WHERE user_id = ? AND friend_id = ?")
      .get<{ ok: number }>(a, b);
    return Boolean(row);
  }

  async addMessage(from: string, to: string, text: string): Promise<ChatMessage> {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Message cannot be empty");
    if (trimmed.length > DM_TEXT_MAX) throw new Error("Message is too long");
    if (!(await this.areFriends(from, to))) throw new Error("You can only DM friends");
    const message: ChatMessage = {
      id: randomUUID(),
      from,
      to,
      text: trimmed,
      createdAt: Date.now(),
    };
    const thread = conversationKey(from, to);
    await this.db
      .prepare("INSERT INTO messages (id, from_id, to_id, text, created_at, thread_key) VALUES (?, ?, ?, ?, ?, ?)")
      .run(message.id, message.from, message.to, message.text, message.createdAt, thread);
    await this.pruneThread(thread);
    return message;
  }

  async pruneThread(threadKey: string): Promise<void> {
    const limit = this.config.dmHistoryLimit;
    await this.db
      .prepare(
        `DELETE FROM messages
         WHERE thread_key = ?
           AND id NOT IN (
             SELECT id FROM messages
             WHERE thread_key = ?
             ORDER BY created_at DESC, id DESC
             LIMIT ?
           )`,
      )
      .run(threadKey, threadKey, limit);
  }

  async messagesFor(userId: string, withId?: string): Promise<ChatMessage[]> {
    if (withId) {
      return this.db
        .prepare(
          `SELECT id, from_id as "from", to_id as "to", text, created_at as createdAt
           FROM messages
           WHERE thread_key = ?
           ORDER BY created_at ASC`,
        )
        .all<ChatMessage>(conversationKey(userId, withId));
    }
    return this.db
      .prepare(
        `SELECT id, from_id as "from", to_id as "to", text, created_at as createdAt
         FROM messages
         WHERE from_id = ? OR to_id = ?
         ORDER BY created_at ASC`,
      )
      .all<ChatMessage>(userId, userId);
  }

  async conversationHasMessages(a: string, b: string): Promise<boolean> {
    const row = await this.db
      .prepare(
        `SELECT 1 as ok FROM messages
         WHERE thread_key = ?
         LIMIT 1`,
      )
      .get<{ ok: number }>(conversationKey(a, b));
    return Boolean(row);
  }

  async onlineUsers(): Promise<PublicUser[]> {
    const users: PublicUser[] = [];
    for (const id of await this.allUserIds()) {
      const user = await this.getUser(id);
      if (user && (await this.isOnline(user.id))) {
        users.push(await this.toPublic(user));
      }
    }
    return users;
  }

  async saveOAuthState(input: {
    state: string;
    provider: AuthProvider;
    codeVerifier?: string;
    linkUserId?: string;
    client?: ClientKind;
  }): Promise<void> {
    const now = Date.now();
    await this.db
      .prepare(
        `INSERT INTO oauth_states (state, provider, code_verifier, link_user_id, client, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.state,
        input.provider,
        input.codeVerifier ?? null,
        input.linkUserId ?? null,
        input.client ?? null,
        now,
        now + this.config.oauthStateTtlMs,
      );
  }

  async takeOAuthState(state: string): Promise<
    | {
        provider: AuthProvider;
        codeVerifier?: string;
        linkUserId?: string;
        client?: ClientKind;
      }
    | undefined
  > {
    const row = await this.db
      .prepare("SELECT * FROM oauth_states WHERE state = ? AND expires_at > ?")
      .get<{
        provider: AuthProvider;
        code_verifier: string | null;
        link_user_id: string | null;
        client: ClientKind | null;
      }>(state, Date.now());
    if (!row) return undefined;
    await this.db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
    return {
      provider: row.provider,
      codeVerifier: row.code_verifier ?? undefined,
      linkUserId: row.link_user_id ?? undefined,
      client: row.client ?? undefined,
    };
  }

  async createHandoff(userId: string): Promise<string> {
    const code = randomHex(24);
    const now = Date.now();
    await this.db
      .prepare("INSERT INTO handoffs (code_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(await sha256Hex(code), userId, now, now + this.config.handoffTtlMs);
    return code;
  }

  async redeemHandoff(code: string): Promise<UserRecord | undefined> {
    const row = await this.db
      .prepare(
        `SELECT u.* FROM handoffs h
         JOIN users u ON u.id = h.user_id
         WHERE h.code_hash = ? AND h.expires_at > ?`,
      )
      .get<UserRow>(await sha256Hex(code), Date.now());
    if (!row) return undefined;
    await this.db.prepare("DELETE FROM handoffs WHERE code_hash = ?").run(await sha256Hex(code));
    return rowToUser(row);
  }

  async uniqueUsername(hint: string): Promise<string> {
    const cleaned = normalizeUsername(hint.replace(/[^a-zA-Z0-9_-]/g, ""));
    let base = isValidUsername(cleaned) ? cleaned : `user${randomHex(3)}`;
    if (base.length > 20) base = base.slice(0, 20);
    if (!(await this.userByName(base))) return base;
    for (let i = 2; i < 1000; i += 1) {
      const candidate = `${base.slice(0, 20)}${i}`.slice(0, 24);
      if (isValidUsername(candidate) && !(await this.userByName(candidate))) return candidate;
    }
    return `u${randomHex(8)}`.slice(0, 24);
  }
}

export function lastSeenLabel(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 60_000) return "last seen just now";
  if (delta < 3_600_000) return `last seen ${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `last seen ${Math.round(delta / 3_600_000)}h ago`;
  if (delta < 172_800_000) return "last seen yesterday";
  return `last seen ${Math.round(delta / 86_400_000)}d ago`;
}

function rowToUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    status: row.status as PresenceStatus,
    statusText: row.status_text,
    client: row.client as ClientKind,
    lastSeen: row.last_seen,
    createdAt: row.created_at,
  };
}

function usernameHint(profile: ProviderProfile): string {
  return profile.usernameHint || profile.email?.split("@")[0] || profile.displayName || profile.provider;
}

function clientForProvider(provider: AuthProvider): ClientKind {
  if (provider === "dev") return "web";
  return provider;
}
