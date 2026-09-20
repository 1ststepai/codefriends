import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  isValidUsername,
  normalizeUsername,
  type AuthProvider,
  type ChatMessage,
  type ClientKind,
  type LinkedIdentity,
  type PresenceStatus,
  type PublicUser,
} from "@codefriends/shared";
import type { ServerConfig } from "./config.js";
import type { SqliteDb } from "./db/sqlite.js";
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
  readonly sockets = new Map<string, Set<import("ws").WebSocket>>();

  constructor(
    private readonly db: SqliteDb,
    private readonly config: ServerConfig,
  ) {}

  createUser(input: {
    username: string;
    displayName?: string;
    status?: PresenceStatus;
    statusText?: string;
    client?: ClientKind;
    lastSeen?: number;
  }): UserRecord {
    const username = normalizeUsername(input.username);
    if (!isValidUsername(username)) {
      throw new Error("Usernames must be 2–24 chars: letters, numbers, _ or -");
    }
    if (this.userByName(username)) {
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
    this.db
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

  getUser(id: string): UserRecord | undefined {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
    return row ? rowToUser(row) : undefined;
  }

  allUserIds(): string[] {
    return this.db.prepare("SELECT id FROM users").all().map((r) => (r as { id: string }).id);
  }

  friendIds(userId: string): string[] {
    return this.db
      .prepare("SELECT friend_id FROM friends WHERE user_id = ?")
      .all(userId)
      .map((r) => (r as { friend_id: string }).friend_id);
  }

  issueToken(userId: string): string {
    const token = randomBytes(32).toString("hex");
    const now = Date.now();
    this.db
      .prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(hashSecret(token), userId, now, now + this.config.sessionTtlMs);
    return token;
  }

  revokeToken(token: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashSecret(token));
  }

  userByToken(token: string | undefined): UserRecord | undefined {
    if (!token) return undefined;
    const row = this.db
      .prepare(
        `SELECT u.* FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ?`,
      )
      .get(hashSecret(token), Date.now()) as UserRow | undefined;
    return row ? rowToUser(row) : undefined;
  }

  userByName(username: string): UserRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM users WHERE username = ?")
      .get(normalizeUsername(username)) as UserRow | undefined;
    return row ? rowToUser(row) : undefined;
  }

  identityOwner(provider: AuthProvider, subject: string): UserRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT u.* FROM identities i
         JOIN users u ON u.id = i.user_id
         WHERE i.provider = ? AND i.subject = ?`,
      )
      .get(provider, subject) as UserRow | undefined;
    return row ? rowToUser(row) : undefined;
  }

  identitiesOf(userId: string): LinkedIdentity[] {
    return this.db
      .prepare("SELECT provider, email, display_name FROM identities WHERE user_id = ? ORDER BY created_at")
      .all(userId)
      .map((r) => {
        const row = r as { provider: AuthProvider; email: string | null; display_name: string | null };
        return {
          provider: row.provider,
          email: row.email ?? undefined,
          displayName: row.display_name ?? undefined,
        };
      });
  }

  ensureIdentity(userId: string, profile: ProviderProfile): void {
    this.db
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

  login(username: string, displayName?: string, client?: ClientKind): { user: UserRecord; token: string } {
    if (!this.config.devLogin) {
      throw new Error("Dev username login is disabled");
    }
    let user = this.userByName(username);
    if (!user) {
      user = this.createUser({ username, displayName, client });
    } else if (displayName?.trim() || client) {
      if (displayName?.trim()) user.displayName = displayName.trim();
      if (client) user.client = client;
      this.persistUser(user);
    }
    this.ensureIdentity(user.id, {
      provider: "dev",
      subject: user.username,
      displayName: user.displayName,
      usernameHint: user.username,
    });
    return { user, token: this.issueToken(user.id) };
  }

  /**
   * Find or create a CodeFriends user for a provider account.
   * If `linkUserId` is set, attach the identity to that user instead of creating another.
   */
  loginWithIdentity(
    profile: ProviderProfile,
    opts?: { linkUserId?: string; client?: ClientKind },
  ): { user: UserRecord; token: string; linked: boolean } {
    if (!profile.subject?.trim()) throw new Error("Provider subject is required");
    const existing = this.identityOwner(profile.provider, profile.subject);

    if (opts?.linkUserId) {
      const target = this.getUser(opts.linkUserId);
      if (!target) throw new Error("Session expired — sign in again before linking");
      if (existing && existing.id !== target.id) {
        throw new Error(
          `That ${profile.provider} account is already linked to @${existing.username}`,
        );
      }
      this.ensureIdentity(target.id, profile);
      if (opts.client) {
        target.client = opts.client;
        this.persistUser(target);
      }
      return { user: target, token: this.issueToken(target.id), linked: true };
    }

    if (existing) {
      if (opts?.client) {
        existing.client = opts.client;
        this.persistUser(existing);
      }
      return { user: existing, token: this.issueToken(existing.id), linked: false };
    }

    const user = this.createUser({
      username: this.uniqueUsername(usernameHint(profile)),
      displayName: profile.displayName || profile.email || usernameHint(profile),
      client: opts?.client ?? clientForProvider(profile.provider),
    });
    this.ensureIdentity(user.id, profile);
    return { user, token: this.issueToken(user.id), linked: false };
  }

  persistUser(user: UserRecord): void {
    this.db
      .prepare(
        `UPDATE users SET display_name = ?, status = ?, status_text = ?, client = ?, last_seen = ?
         WHERE id = ?`,
      )
      .run(user.displayName, user.status, user.statusText, user.client, user.lastSeen, user.id);
  }

  updatePresence(
    userId: string,
    patch: { status?: PresenceStatus; statusText?: string; client?: ClientKind },
  ): UserRecord {
    const user = this.getUser(userId);
    if (!user) throw new Error("Unknown user");
    if (patch.status) user.status = patch.status;
    if (typeof patch.statusText === "string") user.statusText = patch.statusText.slice(0, 80);
    if (patch.client) user.client = patch.client;
    this.persistUser(user);
    return user;
  }

  isConnected(userId: string): boolean {
    return (this.sockets.get(userId)?.size ?? 0) > 0;
  }

  isOnline(userId: string): boolean {
    const user = this.getUser(userId);
    if (!user || user.status === "offline") return false;
    return this.isConnected(userId);
  }

  onlineCount(): number {
    let n = 0;
    for (const id of this.allUserIds()) {
      if (this.isOnline(id)) n += 1;
    }
    return n;
  }

  toPublic(user: UserRecord, opts?: { identities?: boolean }): PublicUser {
    const online = this.isOnline(user.id);
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      status: online ? user.status : "offline",
      statusText: online ? user.statusText : lastSeenLabel(user.lastSeen),
      client: user.client,
      online,
      lastSeen: user.lastSeen,
      identities: opts?.identities ? this.identitiesOf(user.id) : undefined,
    };
  }

  friendList(userId: string): PublicUser[] {
    return this.friendIds(userId)
      .map((id) => this.getUser(id))
      .filter((u): u is UserRecord => Boolean(u))
      .map((u) => this.toPublic(u))
      .sort((a, b) => {
        if (a.online !== b.online) return a.online ? -1 : 1;
        return a.displayName.localeCompare(b.displayName);
      });
  }

  addFriend(fromId: string, username: string): PublicUser {
    const target = this.userByName(username);
    if (!target) throw new Error("No user with that username");
    if (target.id === fromId) throw new Error("You cannot add yourself");
    const now = Date.now();
    this.db
      .prepare("INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)")
      .run(fromId, target.id, now);
    this.db
      .prepare("INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)")
      .run(target.id, fromId, now);
    return this.toPublic(target);
  }

  areFriends(a: string, b: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?")
      .get(a, b);
    return Boolean(row);
  }

  addMessage(from: string, to: string, text: string): ChatMessage {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Message cannot be empty");
    if (trimmed.length > 2000) throw new Error("Message is too long");
    if (!this.areFriends(from, to)) throw new Error("You can only DM friends");
    const message: ChatMessage = {
      id: randomUUID(),
      from,
      to,
      text: trimmed,
      createdAt: Date.now(),
    };
    this.db
      .prepare("INSERT INTO messages (id, from_id, to_id, text, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(message.id, message.from, message.to, message.text, message.createdAt);
    return message;
  }

  messagesFor(userId: string): ChatMessage[] {
    return this.db
      .prepare(
        `SELECT id, from_id as "from", to_id as "to", text, created_at as createdAt
         FROM messages
         WHERE from_id = ? OR to_id = ?
         ORDER BY created_at ASC`,
      )
      .all(userId, userId) as ChatMessage[];
  }

  conversationHasMessages(a: string, b: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM messages
         WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)
         LIMIT 1`,
      )
      .get(a, b, b, a);
    return Boolean(row);
  }

  attachSocket(userId: string, socket: import("ws").WebSocket): void {
    const set = this.sockets.get(userId) ?? new Set();
    set.add(socket);
    this.sockets.set(userId, set);
  }

  detachSocket(userId: string, socket: import("ws").WebSocket): boolean {
    const set = this.sockets.get(userId);
    if (!set) return false;
    set.delete(socket);
    if (set.size === 0) {
      this.sockets.delete(userId);
      const user = this.getUser(userId);
      if (user) {
        user.lastSeen = Date.now();
        this.persistUser(user);
      }
      return true;
    }
    return false;
  }

  socketsOf(userId: string): import("ws").WebSocket[] {
    return [...(this.sockets.get(userId) ?? [])];
  }

  onlineUsers(): PublicUser[] {
    return this.allUserIds()
      .map((id) => this.getUser(id))
      .filter((u): u is UserRecord => u !== undefined && this.isOnline(u.id))
      .map((u) => this.toPublic(u));
  }

  saveOAuthState(input: {
    state: string;
    provider: AuthProvider;
    codeVerifier?: string;
    linkUserId?: string;
    client?: ClientKind;
  }): void {
    const now = Date.now();
    this.db
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

  takeOAuthState(state: string): {
    provider: AuthProvider;
    codeVerifier?: string;
    linkUserId?: string;
    client?: ClientKind;
  } | undefined {
    const row = this.db
      .prepare("SELECT * FROM oauth_states WHERE state = ? AND expires_at > ?")
      .get(state, Date.now()) as
      | {
          provider: AuthProvider;
          code_verifier: string | null;
          link_user_id: string | null;
          client: ClientKind | null;
        }
      | undefined;
    if (!row) return undefined;
    this.db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
    return {
      provider: row.provider,
      codeVerifier: row.code_verifier ?? undefined,
      linkUserId: row.link_user_id ?? undefined,
      client: row.client ?? undefined,
    };
  }

  createHandoff(userId: string): string {
    const code = randomBytes(24).toString("hex");
    const now = Date.now();
    this.db
      .prepare("INSERT INTO handoffs (code_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(hashSecret(code), userId, now, now + this.config.handoffTtlMs);
    return code;
  }

  redeemHandoff(code: string): UserRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT u.* FROM handoffs h
         JOIN users u ON u.id = h.user_id
         WHERE h.code_hash = ? AND h.expires_at > ?`,
      )
      .get(hashSecret(code), Date.now()) as UserRow | undefined;
    if (!row) return undefined;
    this.db.prepare("DELETE FROM handoffs WHERE code_hash = ?").run(hashSecret(code));
    return rowToUser(row);
  }

  uniqueUsername(hint: string): string {
    const cleaned = normalizeUsername(hint.replace(/[^a-zA-Z0-9_-]/g, ""));
    let base = isValidUsername(cleaned) ? cleaned : `user${randomBytes(3).toString("hex")}`;
    if (base.length > 20) base = base.slice(0, 20);
    if (!this.userByName(base)) return base;
    for (let i = 2; i < 1000; i += 1) {
      const candidate = `${base.slice(0, 20)}${i}`.slice(0, 24);
      if (isValidUsername(candidate) && !this.userByName(candidate)) return candidate;
    }
    return `u${randomBytes(8).toString("hex")}`.slice(0, 24);
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

export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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
  const raw = profile.usernameHint || profile.email?.split("@")[0] || profile.displayName || profile.provider;
  return raw;
}

function clientForProvider(provider: AuthProvider): ClientKind {
  if (provider === "dev") return "web";
  return provider;
}
