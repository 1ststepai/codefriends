import {
  cleanHttpUrl,
  cleanHttpsUrl,
  cleanSocialUrl,
  conversationKey,
  DM_TEXT_MAX,
  HELP_PACKET_LIST_LIMIT,
  HELP_PACKET_MARKDOWN_MAX,
  HELP_PACKET_TITLE_MAX,
  isLibraryKind,
  isValidUsername,
  LIBRARY_DESCRIPTION_MAX,
  LIBRARY_LIST_LIMIT,
  LIBRARY_TITLE_MAX,
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
  type FriendRequest,
  type FriendRequestStatus,
  type HelpPacket,
  type LibraryItem,
  type LibraryKind,
  type LibrarySource,
  type LinkedIdentity,
  type PresenceStatus,
  type PublicUser,
  type VerificationMethod,
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
  twitterUrl: string;
  facebookUrl: string;
  telegramUrl: string;
  whatsappUrl: string;
  currentlyBuilding: string;
  ownsBusiness: boolean;
  businessNote: string;
  wantsToHelpOthersBuild: boolean;
  anchorEmail?: string;
  anchorPhone?: string;
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
  twitter_url?: string;
  facebook_url?: string;
  telegram_url?: string;
  whatsapp_url?: string;
  currently_building?: string;
  owns_business?: number;
  business_note?: string;
  wants_to_help_others_build?: number;
  anchor_email?: string | null;
  anchor_phone?: string | null;
  created_at: number;
}

const OTP_MAX_ATTEMPTS = 5;
const LINKABLE_PROVIDERS = ["cursor", "claude", "codex", "gemini"] as const satisfies readonly AuthProvider[];

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
      twitterUrl: "",
      facebookUrl: "",
      telegramUrl: "",
      whatsappUrl: "",
      currentlyBuilding: "",
      ownsBusiness: false,
      businessNote: "",
      wantsToHelpOthersBuild: false,
      anchorEmail: undefined,
      anchorPhone: undefined,
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
      .prepare(
        `SELECT provider, email, display_name, verified_at, verification_method
         FROM identities WHERE user_id = ? ORDER BY created_at`,
      )
      .all<{
        provider: AuthProvider;
        email: string | null;
        display_name: string | null;
        verified_at: number | null;
        verification_method: VerificationMethod | null;
      }>(userId);
    return rows.map((row) => ({
      provider: row.provider,
      email: row.email ?? undefined,
      displayName: row.display_name ?? undefined,
      verifiedAt: row.verified_at ?? undefined,
      verificationMethod: row.verification_method ?? undefined,
    }));
  }

  async ensureIdentity(
    userId: string,
    profile: ProviderProfile,
    opts?: { verificationMethod?: VerificationMethod; verifiedAt?: number },
  ): Promise<void> {
    const now = Date.now();
    const method = opts?.verificationMethod;
    const verifiedAt = opts?.verifiedAt ?? (method ? now : undefined);
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO identities
           (id, user_id, provider, subject, email, display_name, created_at, verified_at, verification_method)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        userId,
        profile.provider,
        profile.subject,
        profile.email ?? null,
        profile.displayName ?? null,
        now,
        verifiedAt ?? null,
        method ?? null,
      );
    if (method && verifiedAt) {
      await this.db
        .prepare(
          `UPDATE identities
           SET verified_at = COALESCE(verified_at, ?),
               verification_method = COALESCE(verification_method, ?),
               email = COALESCE(?, email),
               display_name = COALESCE(?, display_name)
           WHERE user_id = ? AND provider = ? AND subject = ?`,
        )
        .run(
          verifiedAt,
          method,
          profile.email ?? null,
          profile.displayName ?? null,
          userId,
          profile.provider,
          profile.subject,
        );
    }
  }

  async detachIdentity(userId: string, provider: AuthProvider): Promise<LinkedIdentity[]> {
    if (provider === "dev") throw new Error("Dev identity cannot be detached");
    const existing = await this.identitiesOf(userId);
    if (!existing.some((row) => row.provider === provider)) {
      throw new Error(`No ${provider} identity linked`);
    }
    const user = await this.getUser(userId);
    const remaining = existing.filter((row) => row.provider !== provider);
    if (remaining.length === 0 && !user?.anchorEmail && !user?.anchorPhone) {
      throw new Error("Keep at least one linked tool identity or an email/phone anchor");
    }
    await this.db
      .prepare("DELETE FROM identities WHERE user_id = ? AND provider = ?")
      .run(userId, provider);
    return this.identitiesOf(userId);
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
    await this.ensureIdentity(
      user.id,
      {
        provider: "dev",
        subject: user.username,
        displayName: user.displayName,
        usernameHint: user.username,
      },
      { verificationMethod: "dev" },
    );
    return { user, token: await this.issueToken(user.id) };
  }

  /**
   * Find or create a CodeFriends user for a provider account.
   * If `linkUserId` is set, attach the identity to that user instead of creating another.
   */
  async loginWithIdentity(
    profile: ProviderProfile,
    opts?: {
      linkUserId?: string;
      client?: ClientKind;
      verificationMethod?: VerificationMethod;
    },
  ): Promise<{ user: UserRecord; token: string; linked: boolean }> {
    if (!profile.subject?.trim()) throw new Error("Provider subject is required");
    const existing = await this.identityOwner(profile.provider, profile.subject);
    const method =
      opts?.verificationMethod ??
      (profile.provider === "gemini" ? "oidc" : this.config.mockProviders ? "mock" : undefined);

    if (opts?.linkUserId) {
      const target = await this.getUser(opts.linkUserId);
      if (!target) throw new Error("Session expired — sign in again before linking");
      if (existing && existing.id !== target.id) {
        throw new Error(`That ${profile.provider} account is already linked to @${existing.username}`);
      }
      await this.ensureIdentity(target.id, profile, method ? { verificationMethod: method } : undefined);
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
      if (method) {
        await this.ensureIdentity(existing.id, profile, { verificationMethod: method });
      }
      return { user: existing, token: await this.issueToken(existing.id), linked: false };
    }

    const user = await this.createUser({
      username: await this.uniqueUsername(usernameHint(profile)),
      displayName: profile.displayName || profile.email || usernameHint(profile),
      client: opts?.client ?? clientForProvider(profile.provider),
    });
    await this.ensureIdentity(user.id, profile, method ? { verificationMethod: method } : undefined);
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
    patch: {
      githubUrl?: string;
      website?: string;
      tools?: unknown;
      twitterUrl?: string;
      facebookUrl?: string;
      telegramUrl?: string;
      whatsappUrl?: string;
      currentlyBuilding?: string;
      ownsBusiness?: unknown;
      businessNote?: string;
      wantsToHelpOthersBuild?: unknown;
    },
  ): Promise<UserRecord> {
    const user = await this.getUser(userId);
    if (!user) throw new Error("Unknown user");
    if (patch.githubUrl !== undefined) user.githubUrl = cleanHttpUrl(patch.githubUrl, "github.com");
    if (patch.website !== undefined) user.website = cleanHttpUrl(patch.website);
    if (patch.twitterUrl !== undefined) user.twitterUrl = cleanSocialUrl(patch.twitterUrl, "twitter");
    if (patch.facebookUrl !== undefined) user.facebookUrl = cleanSocialUrl(patch.facebookUrl, "facebook");
    if (patch.telegramUrl !== undefined) user.telegramUrl = cleanSocialUrl(patch.telegramUrl, "telegram");
    if (patch.whatsappUrl !== undefined) user.whatsappUrl = cleanSocialUrl(patch.whatsappUrl, "whatsapp");
    if (patch.currentlyBuilding !== undefined) user.currentlyBuilding = cleanNote(patch.currentlyBuilding);
    if (patch.ownsBusiness !== undefined) user.ownsBusiness = asBool(patch.ownsBusiness);
    if (patch.businessNote !== undefined) user.businessNote = cleanNote(patch.businessNote);
    if (patch.wantsToHelpOthersBuild !== undefined) {
      user.wantsToHelpOthersBuild = asBool(patch.wantsToHelpOthersBuild);
    }
    if (patch.tools !== undefined) user.tools = parseTools(patch.tools).join(", ");
    await this.db
      .prepare(
        `UPDATE users SET github_url = ?, website = ?, tools = ?, twitter_url = ?, facebook_url = ?, telegram_url = ?, whatsapp_url = ?, currently_building = ?, owns_business = ?, business_note = ?, wants_to_help_others_build = ? WHERE id = ?`,
      )
      .run(
        user.githubUrl,
        user.website,
        user.tools,
        user.twitterUrl,
        user.facebookUrl,
        user.telegramUrl,
        user.whatsappUrl,
        user.currentlyBuilding,
        user.ownsBusiness ? 1 : 0,
        user.businessNote,
        user.wantsToHelpOthersBuild ? 1 : 0,
        user.id,
      );
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

  async toPublic(user: UserRecord, opts?: { identities?: boolean; self?: boolean }): Promise<PublicUser> {
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
      twitterUrl: user.twitterUrl,
      facebookUrl: user.facebookUrl,
      telegramUrl: user.telegramUrl,
      whatsappUrl: user.whatsappUrl,
      currentlyBuilding: user.currentlyBuilding,
      ownsBusiness: user.ownsBusiness,
      businessNote: user.businessNote,
      wantsToHelpOthersBuild: user.wantsToHelpOthersBuild,
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

  /** Instant mutual friendship (invite accept + seed). Prefer requestFriend for username adds. */
  async addFriend(fromId: string, username: string): Promise<PublicUser> {
    const target = await this.userByName(username);
    if (!target) throw new Error("No user with that username");
    if (target.id === fromId) throw new Error("You cannot add yourself");
    await this.connectFriends(fromId, target.id);
    return this.toPublic(target);
  }

  async connectFriends(a: string, b: string): Promise<void> {
    const now = Date.now();
    await this.db
      .prepare("INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)")
      .run(a, b, now);
    await this.db
      .prepare("INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)")
      .run(b, a, now);
    await this.db
      .prepare(
        `UPDATE friend_requests
         SET status = 'accepted', responded_at = ?
         WHERE status = 'pending'
           AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))`,
      )
      .run(now, a, b, b, a);
  }

  async requestFriend(fromId: string, username: string): Promise<FriendRequest> {
    const target = await this.userByName(username);
    if (!target) throw new Error("No user with that username");
    if (target.id === fromId) throw new Error("You cannot add yourself");
    if (await this.areFriends(fromId, target.id)) {
      throw new Error("You are already friends");
    }

    const reverse = await this.db
      .prepare(
        `SELECT id FROM friend_requests
         WHERE from_id = ? AND to_id = ? AND status = 'pending'`,
      )
      .get<{ id: string }>(target.id, fromId);
    if (reverse) {
      await this.acceptFriendRequest(fromId, reverse.id);
      const accepted = await this.getFriendRequest(reverse.id);
      if (!accepted) throw new Error("Friend request missing after accept");
      return this.hydrateFriendRequest(accepted);
    }

    const existing = await this.db
      .prepare(`SELECT id, status FROM friend_requests WHERE from_id = ? AND to_id = ?`)
      .get<{ id: string; status: FriendRequestStatus }>(fromId, target.id);
    if (existing?.status === "pending") {
      const pending = await this.getFriendRequest(existing.id);
      if (!pending) throw new Error("Friend request missing");
      return this.hydrateFriendRequest(pending);
    }

    const id = randomUUID();
    const now = Date.now();
    if (existing) {
      await this.db
        .prepare(
          `UPDATE friend_requests SET status = 'pending', created_at = ?, responded_at = NULL WHERE id = ?`,
        )
        .run(now, existing.id);
      const refreshed = await this.getFriendRequest(existing.id);
      if (!refreshed) throw new Error("Friend request missing");
      return this.hydrateFriendRequest(refreshed);
    }

    await this.db
      .prepare(
        `INSERT INTO friend_requests (id, from_id, to_id, status, created_at, responded_at)
         VALUES (?, ?, ?, 'pending', ?, NULL)`,
      )
      .run(id, fromId, target.id, now);
    const created = await this.getFriendRequest(id);
    if (!created) throw new Error("Friend request missing");
    return this.hydrateFriendRequest(created);
  }

  async listFriendRequests(userId: string): Promise<{ incoming: FriendRequest[]; outgoing: FriendRequest[] }> {
    const rows = await this.db
      .prepare(
        `SELECT id, from_id, to_id, status, created_at, responded_at
         FROM friend_requests
         WHERE status = 'pending' AND (from_id = ? OR to_id = ?)
         ORDER BY created_at DESC`,
      )
      .all<FriendRequestRow>(userId, userId);
    const incoming: FriendRequest[] = [];
    const outgoing: FriendRequest[] = [];
    for (const row of rows) {
      const req = await this.hydrateFriendRequest(row);
      if (row.to_id === userId) incoming.push(req);
      else outgoing.push(req);
    }
    return { incoming, outgoing };
  }

  async acceptFriendRequest(userId: string, requestId: string): Promise<PublicUser> {
    const row = await this.getFriendRequest(requestId);
    if (!row || row.status !== "pending") throw new Error("Friend request not found");
    if (row.to_id !== userId) throw new Error("Only the recipient can accept");
    await this.connectFriends(row.from_id, row.to_id);
    const from = await this.getUser(row.from_id);
    if (!from) throw new Error("User not found");
    return this.toPublic(from);
  }

  async declineFriendRequest(userId: string, requestId: string): Promise<void> {
    const row = await this.getFriendRequest(requestId);
    if (!row || row.status !== "pending") throw new Error("Friend request not found");
    if (row.to_id !== userId) throw new Error("Only the recipient can decline");
    await this.db
      .prepare(`UPDATE friend_requests SET status = 'declined', responded_at = ? WHERE id = ?`)
      .run(Date.now(), requestId);
  }

  async cancelFriendRequest(userId: string, requestId: string): Promise<void> {
    const row = await this.getFriendRequest(requestId);
    if (!row || row.status !== "pending") throw new Error("Friend request not found");
    if (row.from_id !== userId) throw new Error("Only the sender can cancel");
    await this.db.prepare(`DELETE FROM friend_requests WHERE id = ?`).run(requestId);
  }

  private async getFriendRequest(id: string): Promise<FriendRequestRow | undefined> {
    return this.db
      .prepare(
        `SELECT id, from_id, to_id, status, created_at, responded_at FROM friend_requests WHERE id = ?`,
      )
      .get<FriendRequestRow>(id);
  }

  private async hydrateFriendRequest(row: FriendRequestRow): Promise<FriendRequest> {
    const from = await this.getUser(row.from_id);
    const to = await this.getUser(row.to_id);
    return {
      id: row.id,
      fromId: row.from_id,
      toId: row.to_id,
      status: row.status,
      createdAt: Number(row.created_at),
      respondedAt: row.responded_at == null ? undefined : Number(row.responded_at),
      from: from ? await this.toPublic(from) : undefined,
      to: to ? await this.toPublic(to) : undefined,
    };
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

  async addLibraryItem(
    authorId: string,
    input: { title: string; description: string; url: string; kind: string; createdAt?: number },
    source: LibrarySource = "community",
  ): Promise<LibraryItem> {
    const title = input.title.trim();
    const description = input.description.trim();
    if (!title) throw new Error("Title cannot be empty");
    if (!description) throw new Error("Add a short description");
    if (title.length > LIBRARY_TITLE_MAX) throw new Error("Title is too long");
    if (description.length > LIBRARY_DESCRIPTION_MAX) throw new Error("Description is too long");
    if (!isLibraryKind(input.kind)) throw new Error("Pick a kind: GitHub, ChatGPT project, Demo, Prompt pack, or Other");
    const url = cleanHttpsUrl(input.url);
    const author = await this.getUser(authorId);
    if (!author) throw new Error("Unknown user");
    const now = input.createdAt ?? Date.now();
    const item: LibraryItem = {
      id: randomUUID(),
      title,
      description,
      url,
      kind: input.kind,
      source,
      authorId: author.id,
      authorUsername: author.username,
      authorDisplayName: author.displayName,
      createdAt: now,
      updatedAt: now,
    };
    await this.db
      .prepare(
        `INSERT INTO library_items (id, author_id, title, description, url, kind, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        item.id,
        item.authorId,
        item.title,
        item.description,
        item.url,
        item.kind,
        item.source,
        item.createdAt,
        item.updatedAt,
      );
    return item;
  }

  async listLibraryItems(limit = LIBRARY_LIST_LIMIT): Promise<LibraryItem[]> {
    const cap = Math.max(1, Math.min(limit, LIBRARY_LIST_LIMIT));
    const rows = await this.db
      .prepare(
        `SELECT i.id, i.author_id, i.title, i.description, i.url, i.kind, i.source,
                i.created_at, i.updated_at, u.username, u.display_name
         FROM library_items i
         JOIN users u ON u.id = i.author_id
         ORDER BY CASE i.source WHEN 'official' THEN 0 ELSE 1 END, i.created_at DESC
         LIMIT ?`,
      )
      .all<LibraryRow>(cap);
    const items = rows.map(rowToLibraryItem);
    const official = items.filter((item) => item.source === "official").sort((a, b) => a.createdAt - b.createdAt);
    const community = items.filter((item) => item.source !== "official");
    return [...official, ...community];
  }

  async getLibraryItem(id: string): Promise<LibraryItem | undefined> {
    const row = await this.db
      .prepare(
        `SELECT i.id, i.author_id, i.title, i.description, i.url, i.kind, i.source,
                i.created_at, i.updated_at, u.username, u.display_name
         FROM library_items i
         JOIN users u ON u.id = i.author_id
         WHERE i.id = ?`,
      )
      .get<LibraryRow>(id);
    return row ? rowToLibraryItem(row) : undefined;
  }

  async findOfficialLibraryByUrl(url: string): Promise<LibraryItem | undefined> {
    const row = await this.db
      .prepare(
        `SELECT i.id, i.author_id, i.title, i.description, i.url, i.kind, i.source,
                i.created_at, i.updated_at, u.username, u.display_name
         FROM library_items i
         JOIN users u ON u.id = i.author_id
         WHERE i.source = 'official' AND i.url = ?`,
      )
      .get<LibraryRow>(url);
    return row ? rowToLibraryItem(row) : undefined;
  }

  async deleteLibraryItem(userId: string, id: string): Promise<void> {
    const item = await this.getLibraryItem(id);
    if (!item) throw new Error("Item not found");
    if (item.authorId !== userId) throw new Error("You can only remove your own item");
    await this.db.prepare("DELETE FROM library_items WHERE id = ?").run(id);
  }

  async addHelpPacket(userId: string, input: { title: string; markdown: string }): Promise<HelpPacket> {
    const title = input.title.trim();
    const markdown = input.markdown.trim();
    if (!title) throw new Error("Title cannot be empty");
    if (!markdown) throw new Error("Packet cannot be empty");
    if (title.length > HELP_PACKET_TITLE_MAX) throw new Error("Title is too long");
    if (markdown.length > HELP_PACKET_MARKDOWN_MAX) throw new Error("Packet is too long");
    const author = await this.getUser(userId);
    if (!author) throw new Error("Unknown user");
    const packet: HelpPacket = {
      id: randomUUID(),
      userId: author.id,
      title,
      markdown,
      createdAt: Date.now(),
    };
    await this.db
      .prepare("INSERT INTO help_packets (id, user_id, title, markdown, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(packet.id, packet.userId, packet.title, packet.markdown, packet.createdAt);
    return packet;
  }

  async listHelpPackets(userId: string, limit = HELP_PACKET_LIST_LIMIT): Promise<HelpPacket[]> {
    const cap = Math.max(1, Math.min(limit, HELP_PACKET_LIST_LIMIT));
    const rows = await this.db
      .prepare(
        `SELECT id, user_id, title, markdown, created_at
         FROM help_packets
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all<HelpPacketRow>(userId, cap);
    return rows.map(rowToHelpPacket);
  }

  async getHelpPacket(id: string): Promise<HelpPacket | undefined> {
    const row = await this.db
      .prepare("SELECT id, user_id, title, markdown, created_at FROM help_packets WHERE id = ?")
      .get<HelpPacketRow>(id);
    return row ? rowToHelpPacket(row) : undefined;
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

  /**
   * Start email or phone OTP for login / account create, or to attach an anchor while signed in.
   * Delivery is mock/log only until an SMS/email provider is wired (see docs/identity-friends.md).
   */
  async startAnchorOtp(input: {
    email?: string;
    phone?: string;
    userId?: string;
  }): Promise<{ challengeId: string; kind: "email" | "phone"; expiresInMs: number; mockCode?: string }> {
    const email = input.email ? normalizeEmail(input.email) : "";
    const phone = input.phone ? normalizePhone(input.phone) : "";
    if (email && phone) throw new Error("Provide email or phone, not both");
    if (!email && !phone) throw new Error("Provide an email or phone number");
    const kind = email ? "email" : "phone";
    const destination = email || phone;
    if (kind === "email" && !isValidEmail(destination)) throw new Error("Enter a valid email");
    if (kind === "phone" && !isValidPhone(destination)) throw new Error("Enter a valid phone (8–15 digits)");

    if (input.userId) {
      const taken = await this.userByAnchor(kind, destination);
      if (taken && taken.id !== input.userId) {
        throw new Error(`That ${kind} is already the anchor for @${taken.username}`);
      }
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const challengeId = randomUUID();
    const now = Date.now();
    await this.db
      .prepare(
        `INSERT INTO otp_challenges
           (id, kind, destination, code_hash, purpose, user_id, created_at, expires_at, attempts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(
        challengeId,
        kind,
        destination,
        await sha256Hex(code),
        input.userId ? "anchor_verify" : "anchor_login",
        input.userId ?? null,
        now,
        now + this.config.otpTtlMs,
      );
    return {
      challengeId,
      kind,
      expiresInMs: this.config.otpTtlMs,
      ...(this.config.otpMock ? { mockCode: code } : {}),
    };
  }

  async verifyAnchorOtp(input: {
    challengeId: string;
    code: string;
    client?: ClientKind;
    expectedUserId?: string;
  }): Promise<{ user: UserRecord; token: string; created: boolean }> {
    const row = await this.db
      .prepare(
        `SELECT * FROM otp_challenges WHERE id = ? AND expires_at > ?`,
      )
      .get<{
        id: string;
        kind: "email" | "phone";
        destination: string;
        code_hash: string;
        purpose: string;
        user_id: string | null;
        attempts: number;
      }>(input.challengeId, Date.now());
    if (!row) throw new Error("Code expired or not found");
    if (input.expectedUserId && row.user_id !== input.expectedUserId) {
      throw new Error("Anchor challenge belongs to a different session");
    }
    if (row.attempts >= OTP_MAX_ATTEMPTS) {
      await this.db.prepare("DELETE FROM otp_challenges WHERE id = ?").run(row.id);
      throw new Error("Too many attempts — request a new code");
    }
    const ok = (await sha256Hex(String(input.code ?? "").trim())) === row.code_hash;
    if (!ok) {
      await this.db
        .prepare("UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = ?")
        .run(row.id);
      throw new Error("Incorrect code");
    }
    await this.db.prepare("DELETE FROM otp_challenges WHERE id = ?").run(row.id);

    if (row.purpose === "anchor_verify" && row.user_id) {
      const user = await this.getUser(row.user_id);
      if (!user) throw new Error("Session expired — sign in again");
      await this.setAnchor(user.id, row.kind, row.destination);
      const refreshed = (await this.getUser(user.id))!;
      if (input.client) {
        refreshed.client = input.client;
        await this.persistUser(refreshed);
      }
      return { user: refreshed, token: await this.issueToken(refreshed.id), created: false };
    }

    let user = await this.userByAnchor(row.kind, row.destination);
    let created = false;
    if (!user) {
      const hint =
        row.kind === "email"
          ? row.destination.split("@")[0] ?? "user"
          : `p${row.destination.slice(-4)}`;
      user = await this.createUser({
        username: await this.uniqueUsername(hint),
        displayName: row.kind === "email" ? row.destination.split("@")[0] : `User ${row.destination.slice(-4)}`,
        client: input.client ?? "web",
      });
      created = true;
    } else if (input.client) {
      user.client = input.client;
      await this.persistUser(user);
    }
    await this.setAnchor(user.id, row.kind, row.destination);
    return { user: (await this.getUser(user.id))!, token: await this.issueToken(user.id), created };
  }

  async userByAnchor(kind: "email" | "phone", destination: string): Promise<UserRecord | undefined> {
    const column = kind === "email" ? "anchor_email" : "anchor_phone";
    const row = await this.db
      .prepare(`SELECT * FROM users WHERE ${column} = ?`)
      .get<UserRow>(destination);
    return row ? rowToUser(row) : undefined;
  }

  async setAnchor(userId: string, kind: "email" | "phone", destination: string): Promise<void> {
    const taken = await this.userByAnchor(kind, destination);
    if (taken && taken.id !== userId) {
      throw new Error(`That ${kind} is already the anchor for @${taken.username}`);
    }
    if (kind === "email") {
      await this.db.prepare("UPDATE users SET anchor_email = ? WHERE id = ?").run(destination, userId);
    } else {
      await this.db.prepare("UPDATE users SET anchor_phone = ? WHERE id = ?").run(destination, userId);
    }
  }

  async anchorsOf(userId: string): Promise<{ email?: string; phone?: string }> {
    const user = await this.getUser(userId);
    return {
      email: user?.anchorEmail,
      phone: user?.anchorPhone,
    };
  }

  /**
   * One-time code the signed-in user shows to a local plugin / connect-client.
   * Completing it attaches a verified tool identity — not OAuth.
   */
  async startIdentityLink(
    userId: string,
    provider: AuthProvider,
  ): Promise<{ code: string; provider: AuthProvider; expiresInMs: number }> {
    if (!LINKABLE_PROVIDERS.includes(provider as (typeof LINKABLE_PROVIDERS)[number])) {
      throw new Error("Only cursor, claude, codex, or gemini can be linked this way");
    }
    const code = randomHex(12);
    const now = Date.now();
    await this.db
      .prepare(
        `INSERT INTO identity_link_codes (code_hash, user_id, provider, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(await sha256Hex(code), userId, provider, now, now + this.config.linkCodeTtlMs);
    return { code, provider, expiresInMs: this.config.linkCodeTtlMs };
  }

  async completeIdentityLink(input: {
    code: string;
    provider: AuthProvider;
    subject: string;
    email?: string;
    displayName?: string;
    client?: ClientKind;
  }): Promise<{ user: UserRecord; linked: true }> {
    if (!input.subject?.trim()) throw new Error("subject is required — a stable local account id");
    if (!LINKABLE_PROVIDERS.includes(input.provider as (typeof LINKABLE_PROVIDERS)[number])) {
      throw new Error("Unknown linkable provider");
    }
    const row = await this.db
      .prepare(
        `SELECT user_id, provider FROM identity_link_codes
         WHERE code_hash = ? AND expires_at > ?`,
      )
      .get<{ user_id: string; provider: AuthProvider }>(await sha256Hex(input.code.trim()), Date.now());
    if (!row) throw new Error("Link code expired or already used");
    if (row.provider !== input.provider) {
      throw new Error(`This code is for ${row.provider}, not ${input.provider}`);
    }
    await this.db
      .prepare("DELETE FROM identity_link_codes WHERE code_hash = ?")
      .run(await sha256Hex(input.code.trim()));

    const target = await this.getUser(row.user_id);
    if (!target) throw new Error("User not found");
    const owner = await this.identityOwner(input.provider, input.subject.trim());
    if (owner && owner.id !== target.id) {
      throw new Error(`That ${input.provider} account is already linked to @${owner.username}`);
    }
    await this.ensureIdentity(
      target.id,
      {
        provider: input.provider,
        subject: input.subject.trim(),
        email: input.email,
        displayName: input.displayName,
      },
      { verificationMethod: "link_code" },
    );
    if (input.client) {
      target.client = input.client;
      await this.persistUser(target);
    }
    return { user: (await this.getUser(target.id))!, linked: true };
  }

  /** Resolve a tool identity to the unified CodeFriends user + presence. */
  async resolvePresenceByIdentity(
    provider: AuthProvider,
    subject: string,
  ): Promise<PublicUser | undefined> {
    const owner = await this.identityOwner(provider, subject);
    if (!owner) return undefined;
    return this.toPublic(owner, { identities: true });
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

interface LibraryRow {
  id: string;
  author_id: string;
  title: string;
  description: string;
  url: string;
  kind: LibraryKind;
  source: LibrarySource;
  created_at: number;
  updated_at: number | null;
  username: string;
  display_name: string;
}

interface HelpPacketRow {
  id: string;
  user_id: string;
  title: string;
  markdown: string;
  created_at: number;
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

function rowToLibraryItem(row: LibraryRow): LibraryItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    url: row.url,
    kind: row.kind,
    source: row.source,
    authorId: row.author_id,
    authorUsername: row.username,
    authorDisplayName: row.display_name,
    createdAt: Number(row.created_at),
    updatedAt: row.updated_at == null ? undefined : Number(row.updated_at),
  };
}

function rowToHelpPacket(row: HelpPacketRow): HelpPacket {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    markdown: row.markdown,
    createdAt: Number(row.created_at),
  };
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
    twitterUrl: row.twitter_url ?? "",
    facebookUrl: row.facebook_url ?? "",
    telegramUrl: row.telegram_url ?? "",
    whatsappUrl: row.whatsapp_url ?? "",
    currentlyBuilding: row.currently_building ?? "",
    ownsBusiness: Boolean(row.owns_business),
    businessNote: row.business_note ?? "",
    wantsToHelpOthersBuild: Boolean(row.wants_to_help_others_build),
    anchorEmail: row.anchor_email ?? undefined,
    anchorPhone: row.anchor_phone ?? undefined,
    createdAt: row.created_at,
  };
}

interface FriendRequestRow {
  id: string;
  from_id: string;
  to_id: string;
  status: FriendRequestStatus;
  created_at: number;
  responded_at: number | null;
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  return plus ? `+${digits}` : digits;
}

function isValidEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) && raw.length <= 254;
}

function isValidPhone(raw: string): boolean {
  const digits = raw.replace(/[^\d]/g, "");
  return digits.length >= 8 && digits.length <= 15;
}

function cleanNote(raw: string): string {
  return raw.trim().slice(0, STATUS_TEXT_MAX);
}

function asBool(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function usernameHint(profile: ProviderProfile): string {
  return profile.usernameHint || profile.email?.split("@")[0] || profile.displayName || profile.provider;
}

function clientForProvider(provider: AuthProvider): ClientKind {
  if (provider === "dev") return "web";
  return provider;
}
