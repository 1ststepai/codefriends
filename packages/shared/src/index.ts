export const CLIENTS = ["cursor", "claude", "codex", "gemini", "web"] as const;
export type ClientKind = (typeof CLIENTS)[number];

export const AUTH_PROVIDERS = ["cursor", "claude", "codex", "gemini", "dev"] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

export const PRESENCE_STATUSES = ["available", "away", "offline"] as const;
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

export type ProviderAvailability = "live" | "unconfigured" | "blocked" | "dev" | "mock";

export interface LinkedIdentity {
  provider: AuthProvider;
  email?: string;
  displayName?: string;
}

export interface AuthProviderInfo {
  id: AuthProvider;
  label: string;
  /** Which product account this is meant to represent. */
  accountOf: string;
  availability: ProviderAvailability;
  /** Relative URL to begin browser login, when the provider can start a flow. */
  startPath?: string;
  /** Honest reason the button cannot complete a real login yet. */
  blockedReason?: string;
  /** Exact next step if the implementation exists but needs credentials. */
  nextStep?: string;
}

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  status: PresenceStatus;
  statusText: string;
  client: ClientKind;
  online: boolean;
  lastSeen: number;
  identities?: LinkedIdentity[];
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

/** Last N text DMs kept per 1:1 thread. Older rows are pruned on write. */
export const DM_HISTORY_LIMIT_DEFAULT = 200;
export const DM_TEXT_MAX = 2000;

export {
  CONNECT_SNOOZE_MS,
  CONNECT_HOSTS,
  applyConnectChoice,
  buildPopoutUrl,
  decideConnectPrompt,
  emptyConnectHostState,
  hostLabel,
  popoutClientFor,
  resolveIdeProvider,
} from "./connect-prompt.js";
export type { ConnectChoice, ConnectDecision, ConnectHost, ConnectHostState } from "./connect-prompt.js";
