import { randomBytes, randomUUID } from "node:crypto";
import {
  conversationKey,
  isValidUsername,
  normalizeUsername,
  type ChatMessage,
  type ClientKind,
  type PresenceStatus,
  type PublicUser,
} from "@codefriends/shared";

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

export class Store {
  readonly usersById = new Map<string, UserRecord>();
  readonly usersByName = new Map<string, string>();
  readonly tokens = new Map<string, string>();
  readonly friends = new Map<string, Set<string>>();
  readonly messages = new Map<string, ChatMessage[]>();
  readonly sockets = new Map<string, Set<import("ws").WebSocket>>();

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
    if (this.usersByName.has(username)) {
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
    this.usersById.set(user.id, user);
    this.usersByName.set(username, user.id);
    this.friends.set(user.id, new Set());
    return user;
  }

  issueToken(userId: string): string {
    const token = randomBytes(24).toString("hex");
    this.tokens.set(token, userId);
    return token;
  }

  userByToken(token: string | undefined): UserRecord | undefined {
    if (!token) return undefined;
    const id = this.tokens.get(token);
    return id ? this.usersById.get(id) : undefined;
  }

  userByName(username: string): UserRecord | undefined {
    const id = this.usersByName.get(normalizeUsername(username));
    return id ? this.usersById.get(id) : undefined;
  }

  login(username: string, displayName?: string): { user: UserRecord; token: string } {
    let user = this.userByName(username);
    if (!user) {
      user = this.createUser({ username, displayName });
    } else if (displayName?.trim()) {
      user.displayName = displayName.trim();
    }
    return { user, token: this.issueToken(user.id) };
  }

  isConnected(userId: string): boolean {
    return (this.sockets.get(userId)?.size ?? 0) > 0;
  }

  isOnline(userId: string): boolean {
    const user = this.usersById.get(userId);
    if (!user || user.status === "offline") return false;
    return this.isConnected(userId);
  }

  onlineCount(): number {
    let n = 0;
    for (const id of this.usersById.keys()) {
      if (this.isOnline(id)) n += 1;
    }
    return n;
  }

  toPublic(user: UserRecord): PublicUser {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      status: this.isOnline(user.id) ? user.status : "offline",
      statusText: this.isOnline(user.id)
        ? user.statusText
        : lastSeenLabel(user.lastSeen),
      client: user.client,
      online: this.isOnline(user.id),
      lastSeen: user.lastSeen,
    };
  }

  friendList(userId: string): PublicUser[] {
    const ids = this.friends.get(userId) ?? new Set();
    return [...ids]
      .map((id) => this.usersById.get(id))
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
    this.friends.get(fromId)!.add(target.id);
    this.friends.get(target.id)!.add(fromId);
    return this.toPublic(target);
  }

  areFriends(a: string, b: string): boolean {
    return this.friends.get(a)?.has(b) ?? false;
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
    const key = conversationKey(from, to);
    const list = this.messages.get(key) ?? [];
    list.push(message);
    this.messages.set(key, list);
    return message;
  }

  messagesFor(userId: string): ChatMessage[] {
    const out: ChatMessage[] = [];
    for (const [key, list] of this.messages) {
      if (key.split(":").includes(userId)) out.push(...list);
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
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
      const user = this.usersById.get(userId);
      if (user) user.lastSeen = Date.now();
      return true;
    }
    return false;
  }

  socketsOf(userId: string): import("ws").WebSocket[] {
    return [...(this.sockets.get(userId) ?? [])];
  }

  onlineUsers(): PublicUser[] {
    return [...this.usersById.values()]
      .filter((u) => this.isOnline(u.id))
      .map((u) => this.toPublic(u));
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
