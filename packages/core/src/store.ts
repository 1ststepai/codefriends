import {
  cleanHttpUrl,
  conversationKey,
  DM_TEXT_MAX,
  isValidUsername,
  normalizeUsername,
  parseInviteToken,
  parseTools,
  REPLY_BODY_MAX,
  STATUS_TEXT_MAX,
  TOPIC_BODY_MAX,
  TOPIC_LIST_LIMIT,
  TOPIC_TITLE_MAX,
  type AuthProvider,
  type ChatMessage,
  type ClientKind,
  type ForumReply,
  type ForumTopic,
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
  githubUrl: string;
  website: string;
  tools: string;
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
  github_url?: string;
  website?: string;
  tools?: string;
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
      githubUrl: "",
      website: "",
      tools: "",
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
    if (typeof patch.statusText === "string") user.statusText = patch.statusText.slice(0, STATUS_TEXT_MAX);
    if (patch.client) user.client = patch.client;
    await this.persistUser(user);
    return user;
  }

  async updateProfile(
    userId: string,
    patch: { githubUrl?: string; website?: string; tools?: unknown },
  ): Promise<UserRecord> {
    const user = await this.getUser(userId);
    if (!user) throw new Error("Unknown user");
    if (patch.githubUrl !== undefined) user.githubUrl = cleanHttpUrl(patch.githubUrl, "github.com");
    if (patch.website !== undefined) user.website = cleanHttpUrl(patch.website);
    if (patch.tools !== undefined) user.tools = parseTools(patch.tools).join(", ");
    await this.db
      .prepare("UPDATE users SET github_url = ?, website = ?, tools = ? WHERE id = ?")
      .run(user.githubUrl, user.website, user.tools, user.id);
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
      githubUrl: user.githubUrl,
      website: user.website,
      tools: parseTools(user.tools),
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
             ORDER BY created_at DESC, rowid DESC
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

  async createTopic(authorId: string, title: string, body: string): Promise<ForumTopic> {
    const cleanedTitle = title.trim();
    const cleanedBody = body.trim();
    if (!cleanedTitle) throw new Error("Title cannot be empty");
    if (!cleanedBody) throw new Error("Write a bit about what you are learning");
    if (cleanedTitle.length > TOPIC_TITLE_MAX) throw new Error("Title is too long");
    if (cleanedBody.length > TOPIC_BODY_MAX) throw new Error("Post is too long");
    const author = await this.getUser(authorId);
    if (!author) throw new Error("Unknown user");
    const topic: ForumTopic = {
      id: randomUUID(),
      title: cleanedTitle,
      body: cleanedBody,
      authorId: author.id,
      authorUsername: author.username,
      authorDisplayName: author.displayName,
      createdAt: Date.now(),
      replyCount: 0,
    };
    await this.db
      .prepare("INSERT INTO topics (id, author_id, title, body, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(topic.id, topic.authorId, topic.title, topic.body, topic.createdAt);
    return topic;
  }

  async listTopics(limit = TOPIC_LIST_LIMIT): Promise<ForumTopic[]> {
    const cap = Math.max(1, Math.min(limit, TOPIC_LIST_LIMIT));
    const rows = await this.db
      .prepare(
        `SELECT t.id, t.author_id, t.title, t.body, t.created_at,
                u.username, u.display_name,
                (SELECT COUNT(*) FROM topic_replies r WHERE r.topic_id = t.id) as reply_count
         FROM topics t
         JOIN users u ON u.id = t.author_id
         ORDER BY t.created_at DESC
         LIMIT ?`,
      )
      .all<TopicRow>(cap);
    return rows.map(rowToTopic);
  }

  async getTopic(id: string): Promise<{ topic: ForumTopic; replies: ForumReply[] } | undefined> {
    const row = await this.db
      .prepare(
        `SELECT t.id, t.author_id, t.title, t.body, t.created_at,
                u.username, u.display_name,
                (SELECT COUNT(*) FROM topic_replies r WHERE r.topic_id = t.id) as reply_count
         FROM topics t
         JOIN users u ON u.id = t.author_id
         WHERE t.id = ?`,
      )
      .get<TopicRow>(id);
    if (!row) return undefined;
    const replies = await this.db
      .prepare(
        `SELECT r.id, r.topic_id, r.body, r.author_id, r.created_at,
                u.username, u.display_name
         FROM topic_replies r
         JOIN users u ON u.id = r.author_id
         WHERE r.topic_id = ?
         ORDER BY r.created_at ASC`,
      )
      .all<ReplyRow>(id);
    return { topic: rowToTopic(row), replies: replies.map(rowToReply) };
  }

  async addReply(topicId: string, authorId: string, body: string): Promise<ForumReply> {
    const cleaned = body.trim();
    if (!cleaned) throw new Error("Reply cannot be empty");
    if (cleaned.length > REPLY_BODY_MAX) throw new Error("Reply is too long");
    const found = await this.getTopic(topicId);
    if (!found) throw new Error("Topic not found");
    const author = await this.getUser(authorId);
    if (!author) throw new Error("Unknown user");
    const reply: ForumReply = {
      id: randomUUID(),
      topicId,
      body: cleaned,
      authorId: author.id,
      authorUsername: author.username,
      authorDisplayName: author.displayName,
      createdAt: Date.now(),
    };
    await this.db
      .prepare("INSERT INTO topic_replies (id, topic_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(reply.id, reply.topicId, reply.authorId, reply.body, reply.createdAt);
    return reply;
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

  async createInvite(userId: string): Promise<{ token: string; expiresAt: number }> {
    const token = randomHex(12);
    const now = Date.now();
    const expiresAt = now + this.config.inviteTtlMs;
    await this.db
      .prepare("INSERT INTO invites (token_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(await sha256Hex(token), userId, now, expiresAt);
    return { token, expiresAt };
  }

  async peekInvite(rawToken: string): Promise<{ inviter: UserRecord; expiresAt: number } | undefined> {
    const token = parseInviteToken(rawToken);
    if (!token) return undefined;
    const row = await this.db
      .prepare(
        `SELECT u.*, i.expires_at
         FROM invites i
         JOIN users u ON u.id = i.created_by
         WHERE i.token_hash = ? AND i.expires_at > ?`,
      )
      .get<UserRow & { expires_at: number }>(await sha256Hex(token), Date.now());
    if (!row) return undefined;
    return { inviter: rowToUser(row), expiresAt: row.expires_at };
  }

  /** Instant bidirectional friend edge. Token stays valid until expiry (reusable). */
  async acceptInvite(userId: string, rawToken: string): Promise<PublicUser> {
    const peeked = await this.peekInvite(rawToken);
    if (!peeked) throw new Error("Invite expired or not found");
    if (peeked.inviter.id === userId) throw new Error("You cannot accept your own invite");
    return this.addFriend(userId, peeked.inviter.username);
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

interface TopicRow {
  id: string;
  author_id: string;
  title: string;
  body: string;
  created_at: number;
  username: string;
  display_name: string;
  reply_count: number;
}

interface ReplyRow {
  id: string;
  topic_id: string;
  body: string;
  author_id: string;
  created_at: number;
  username: string;
  display_name: string;
}

function rowToTopic(row: TopicRow): ForumTopic {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    authorId: row.author_id,
    authorUsername: row.username,
    authorDisplayName: row.display_name,
    createdAt: Number(row.created_at),
    replyCount: Number(row.reply_count ?? 0),
  };
}

function rowToReply(row: ReplyRow): ForumReply {
  return {
    id: row.id,
    topicId: row.topic_id,
    body: row.body,
    authorId: row.author_id,
    authorUsername: row.username,
    authorDisplayName: row.display_name,
    createdAt: Number(row.created_at),
  };
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
    githubUrl: row.github_url ?? "",
    website: row.website ?? "",
    tools: row.tools ?? "",
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
