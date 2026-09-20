export const CLIENTS = ["cursor", "claude", "codex", "gemini", "web"] as const;
export type ClientKind = (typeof CLIENTS)[number];

export const PRESENCE_STATUSES = ["available", "away", "offline"] as const;
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  status: PresenceStatus;
  statusText: string;
  client: ClientKind;
  online: boolean;
  lastSeen: number;
}

export interface SessionUser extends PublicUser {
  token: string;
}

export interface ChatMessage {
  id: string;
  from: string;
  to: string;
  text: string;
  createdAt: number;
}

export interface PresenceSummary {
  onlineCount: number;
  online: PublicUser[];
}

export type WsClientMessage =
  | { type: "hello"; token: string }
  | {
      type: "presence";
      status?: PresenceStatus;
      statusText?: string;
      client?: ClientKind;
    }
  | { type: "dm"; to: string; text: string }
  | { type: "add_friend"; username: string }
  | { type: "typing"; to: string; typing: boolean };

export type WsServerMessage =
  | {
      type: "hello_ok";
      self: PublicUser;
      friends: PublicUser[];
      messages: ChatMessage[];
    }
  | { type: "presence"; user: PublicUser }
  | { type: "friends"; friends: PublicUser[] }
  | { type: "dm"; message: ChatMessage }
  | { type: "typing"; from: string; typing: boolean }
  | { type: "online_count"; count: number }
  | { type: "error"; error: string };

export const CLIENT_LABEL: Record<ClientKind, string> = {
  cursor: "Cursor",
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
  web: "Web",
};

export function conversationKey(a: string, b: string): string {
  return [a, b].sort().join(":");
}

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidUsername(raw: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{1,23}$/.test(normalizeUsername(raw));
}
