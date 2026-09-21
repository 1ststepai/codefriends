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
  githubUrl: string;
  website: string;
  tools: string[];
  twitterUrl: string;
  facebookUrl: string;
  telegramUrl: string;
  whatsappUrl: string;
  currentlyBuilding: string;
  ownsBusiness: boolean;
  businessNote: string;
  wantsToHelpOthersBuild: boolean;
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

/** School-board topic. Body is stored as plain text (markdown is fine; not rendered). */
export interface ForumTopic {
  id: string;
  title: string;
  body: string;
  authorId: string;
  authorUsername: string;
  authorDisplayName: string;
  createdAt: number;
  replyCount: number;
}

export interface ForumReply {
  id: string;
  topicId: string;
  body: string;
  authorId: string;
  authorUsername: string;
  authorDisplayName: string;
  createdAt: number;
}

export const LIBRARY_KINDS = ["github", "chatgpt", "demo", "prompt", "other"] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];

export const LIBRARY_SOURCES = ["official", "community"] as const;
export type LibrarySource = (typeof LIBRARY_SOURCES)[number];

export const LIBRARY_KIND_LABEL: Record<LibraryKind, string> = {
  github: "GitHub",
  chatgpt: "ChatGPT project",
  demo: "Demo",
  prompt: "Prompt pack",
  other: "Other",
};

/** Build-library card. Official = seeded 1stStep shelf; community = signed-in submit. */
export interface LibraryItem {
  id: string;
  title: string;
  description: string;
  url: string;
  kind: LibraryKind;
  source: LibrarySource;
  authorId: string;
  authorUsername: string;
  authorDisplayName: string;
  createdAt: number;
  updatedAt?: number;
}

/** Per-user draft copy for distributing a library item. Never auto-posted. */
export interface LaunchPack {
  id: string;
  libraryItemId: string;
  userId: string;
  showHnTitle: string;
  showHnBody: string;
  redditTitle: string;
  redditBody: string;
  socialShort: string;
  socialLong: string;
  friendBlurb: string;
  createdAt: number;
  updatedAt: number;
}

export const SHOW_HN_TITLE_MAX = 80;
export const REDDIT_TITLE_MAX = 300;
export const SOCIAL_SHORT_MAX = 280;
export const LAUNCH_BODY_MAX = 2000;
export const FRIEND_BLURB_MAX = 280;

/** Official shelf: any signed-in user. Community: author of that add only. */
export function canDraftLaunchPack(item: Pick<LibraryItem, "source" | "authorId">, userId: string): boolean {
  return item.source === "official" || item.authorId === userId;
}

const CODE_FRIENDS_FOOTER = "If you want company while you learn: CodeFriends (invite optional).";

/** Template drafts from the library card. Education-first; no LLM. */
export function draftLaunchCopy(item: Pick<LibraryItem, "title" | "description" | "url" | "kind" | "source">): Omit<
  LaunchPack,
  "id" | "libraryItemId" | "userId" | "createdAt" | "updatedAt"
> {
  const name = item.title.trim();
  const what = item.description.trim();
  const job = oneLine(item.description);
  const pain = uncapitalize(job);
  const url = item.url.trim();
  const kind = LIBRARY_KIND_LABEL[item.kind] ?? "project";
  const audience = whoItsFor(item.kind, item.source);
  const free = freeLine(item.source, item.kind);
  const limit = honestLimit(item.source);
  const steps = howToTry(item.kind, url);
  const built = item.source === "official" ? "I'm sharing" : "I built";
  const soPain = item.source === "official" ? `${withArticle(pain)} is easy to try` : `I could share ${pain}`;

  const showHnPrefix = `Show HN: ${name} – `;
  const showHnTitle =
    showHnPrefix.length >= SHOW_HN_TITLE_MAX
      ? clip(`Show HN: ${name}`, SHOW_HN_TITLE_MAX)
      : `${showHnPrefix}${clip(job, SHOW_HN_TITLE_MAX - showHnPrefix.length)}`;

  const showHnBody = clip(
    [
      what,
      "",
      `Who it's for: ${audience}`,
      "",
      "How to try it:",
      ...steps.map((step) => `- ${step}`),
      "",
      `What's free: ${free}`,
      "",
      `Honest limit: ${limit}`,
      "",
      CODE_FRIENDS_FOOTER,
      "",
      "Happy to answer questions.",
    ].join("\n"),
    LAUNCH_BODY_MAX,
  );

  const redditTitle = clip(`${built} ${name} so ${soPain}`, REDDIT_TITLE_MAX);
  const redditBody = clip(
    [
      `Problem I kept hitting: ${pain}.`,
      "",
      "What I shipped:",
      `- ${name} (${kind})`,
      `- ${job}`,
      `- Public link: ${url}`,
      "",
      "Link + how to run in <5 min:",
      ...steps.map((step) => `- ${step}`),
      "",
      "What I still want feedback on: If you try it, what's the first thing that confused you?",
      "",
      CODE_FRIENDS_FOOTER,
    ].join("\n"),
    LAUNCH_BODY_MAX,
  );

  const socialShort = fitBeforeUrl(`${name} — ${job}`, url, SOCIAL_SHORT_MAX);
  const socialLong = clip(
    [
      `${built} ${name} so ${soPain}.`,
      "",
      what,
      "",
      `Try it: ${url}`,
      "",
      `What's free: ${free}`,
      "",
      `Honest limit: ${limit}`,
      "",
      CODE_FRIENDS_FOOTER,
    ].join("\n"),
    LAUNCH_BODY_MAX,
  );

  const friendBlurb = clip(
    item.source === "official"
      ? `I'm starting from the 1stStep starter "${name}" — ${job}. ${url} Want to look it over together?`
      : `I added "${name}" to the library — ${job}. ${url} Want to try it together?`,
    FRIEND_BLURB_MAX,
  );

  return { showHnTitle, showHnBody, redditTitle, redditBody, socialShort, socialLong, friendBlurb };
}

function oneLine(raw: string): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  const clause = collapsed.split(/\s+[—–]\s+|:\s+|\.\s+/)[0] ?? collapsed;
  return clause.replace(/[.?!:;]+$/, "");
}

function uncapitalize(raw: string): string {
  if (!raw) return raw;
  return raw.charAt(0).toLowerCase() + raw.slice(1);
}

function withArticle(raw: string): string {
  if (/^(a|an|the)\b/i.test(raw)) return raw;
  return /^[aeiou]/i.test(raw) ? `an ${raw}` : `a ${raw}`;
}

function whoItsFor(kind: LibraryKind, source: LibrarySource): string {
  if (source === "official") {
    return "New AI users and solo builders who want a first-week starter they can clone, not a product tour.";
  }
  if (kind === "chatgpt") return "People already in ChatGPT who want a project they can open and learn from.";
  if (kind === "prompt") return "New AI users who want a prompt they can paste into a tool they already use.";
  if (kind === "demo") return "Solo builders who learn faster by clicking a running example.";
  if (kind === "github") return "Solo builders who want a public repo they can clone and run.";
  return "New AI users and solo builders who want a public link to try.";
}

function freeLine(source: LibrarySource, kind: LibraryKind): string {
  if (source === "official" || kind === "github") {
    return "Public link — free to open or clone. I don't have a paid plan attached.";
  }
  return "The link is public. I didn't attach a price.";
}

function honestLimit(source: LibrarySource): string {
  if (source === "official") return "It's a starter, not a complete product.";
  return "I don't have user counts or a polished onboarding story yet — it's early.";
}

function howToTry(kind: LibraryKind, url: string): string[] {
  if (kind === "github") return [`Open ${url}`, "Clone the repo", "Follow the README — aim for under 5 minutes"];
  if (kind === "chatgpt") return [`Open ${url}`, "Skim the shared project", "Run one prompt yourself"];
  if (kind === "demo") return [`Open ${url}`, "Click through once", "Note the first thing you'd change"];
  if (kind === "prompt") return [`Open ${url}`, "Copy one prompt", "Paste it into the tool you already use"];
  return [`Open ${url}`, "Skim the page", "Try the first step you see"];
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  if (max <= 1) return "…";
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function fitBeforeUrl(head: string, url: string, max: number): string {
  const tail = `\n${url}`;
  if (tail.length >= max) return clip(url, max);
  return `${clip(head, max - tail.length)}${tail}`;
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
export const TOPIC_TITLE_MAX = 120;
export const TOPIC_BODY_MAX = 4000;
export const REPLY_BODY_MAX = 2000;
export const TOPIC_LIST_LIMIT = 50;
export const STATUS_TEXT_MAX = 80;
export const TOOLS_MAX = 12;
export const TOOL_NAME_MAX = 24;
export const PROFILE_URL_MAX = 200;
export const LIBRARY_TITLE_MAX = 120;
export const LIBRARY_DESCRIPTION_MAX = 280;
export const LIBRARY_LIST_LIMIT = 80;
/** Reusable invite links expire after 7 days. */
export const INVITE_TTL_MS_DEFAULT = 7 * 24 * 60 * 60 * 1000;

/** Accept a raw token, `?invite=`, `/invite/code`, or a full popout URL. */
export function parseInviteToken(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed, "https://invite.local");
    const fromQuery = url.searchParams.get("invite")?.trim();
    if (fromQuery) return fromQuery;
    const fromPath = /\/invite\/([^/]+)$/.exec(url.pathname);
    if (fromPath) return decodeURIComponent(fromPath[1]);
  } catch {
    /* not a URL */
  }
  return trimmed;
}

export function parseTools(raw: unknown): string[] {
  const parts = Array.isArray(raw) ? raw.map((item) => String(item)) : String(raw ?? "").split(",");
  const seen = new Set<string>();
  const tools: string[] = [];
  for (const part of parts) {
    const tool = part.trim().slice(0, TOOL_NAME_MAX);
    if (!tool) continue;
    const key = tool.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tools.push(tool);
    if (tools.length >= TOOLS_MAX) break;
  }
  return tools;
}

export function cleanHttpUrl(raw: string, host?: string | string[]): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.length > PROFILE_URL_MAX) throw new Error("URL is too long");
  const url = parseHttpUrl(trimmed);
  if (host && !hostMatches(url, host)) {
    const allowed = Array.isArray(host) ? host.join(" or ") : host;
    throw new Error(`URL must be on ${allowed}`);
  }
  return url.toString();
}

export type SocialKind = "twitter" | "facebook" | "telegram" | "whatsapp";

/** Accept a https URL, or a handle/phone for Twitter/X, Telegram, and WhatsApp. */
export function cleanSocialUrl(raw: string, kind: SocialKind): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.length > PROFILE_URL_MAX) throw new Error("URL is too long");
  const url = parseHttpUrl(trimmed, { optional: true });
  if (kind === "twitter") {
    const handle = url
      ? (hostMatches(url, ["x.com", "twitter.com"]) ? pathHandle(url) : "")
      : trimmed.replace(/^@/, "");
    if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
      throw new Error("Enter a Twitter/X @handle or https://x.com/… URL");
    }
    return `https://x.com/${handle}`;
  }
  if (kind === "facebook") {
    if (!url || !hostMatches(url, ["facebook.com", "fb.com", "m.facebook.com", "fb.me"])) {
      throw new Error("Enter a Facebook https URL");
    }
    return url.toString();
  }
  if (kind === "telegram") {
    if (url) {
      if (!hostMatches(url, ["t.me", "telegram.me", "telegram.dog"])) {
        throw new Error("Telegram URL must be on t.me");
      }
      return url.toString();
    }
    const username = trimmed.replace(/^@/, "");
    if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username)) {
      throw new Error("Enter a Telegram @username or https://t.me/… URL");
    }
    return `https://t.me/${username}`;
  }
  if (url) {
    if (!hostMatches(url, ["wa.me", "api.whatsapp.com", "whatsapp.com", "web.whatsapp.com"])) {
      throw new Error("WhatsApp URL must be on wa.me");
    }
    return url.toString();
  }
  const digits = trimmed.replace(/[^\d]/g, "");
  if (digits.length < 8 || digits.length > 15) {
    throw new Error("Enter a phone number or https://wa.me/… URL");
  }
  return `https://wa.me/${digits}`;
}

function parseHttpUrl(raw: string): URL;
function parseHttpUrl(raw: string, opts: { optional: true }): URL | undefined;
function parseHttpUrl(raw: string, opts?: { optional?: boolean }): URL | undefined {
  const candidate = hasScheme(raw)
    ? raw
    : /^[\w.-]+\.[a-z]{2,}([/:?#]|$)/i.test(raw)
      ? `https://${raw}`
      : "";
  if (!candidate) {
    if (opts?.optional) return undefined;
    throw new Error("Enter a full http(s) URL");
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("Enter a full http(s) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL must be http(s)");
  }
  return url;
}

function hasScheme(raw: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(raw);
}

function hostMatches(url: URL, host: string | string[]): boolean {
  const hostname = url.hostname.replace(/^www\./, "").toLowerCase();
  const allowed = (Array.isArray(host) ? host : [host]).map((item) => item.replace(/^www\./, "").toLowerCase());
  return allowed.includes(hostname);
}

function pathHandle(url: URL): string {
  return url.pathname.split("/").filter(Boolean)[0] ?? "";
}

/** Library links: required, https only — rejects javascript:, data:, http. */
export function cleanHttpsUrl(raw: string): string {
  const url = cleanHttpUrl(raw);
  if (!url) throw new Error("URL is required");
  if (!url.startsWith("https:")) throw new Error("URL must be https");
  return url;
}

export function isLibraryKind(raw: string): raw is LibraryKind {
  return (LIBRARY_KINDS as readonly string[]).includes(raw);
}

export {
  formatHelpPacket,
  helpPacketFilename,
  HELP_PACKET_FIELD_MAX,
  HELP_PACKET_LIBRARY_URL,
  HELP_PACKET_LIST_LIMIT,
  HELP_PACKET_MARKDOWN_MAX,
  HELP_PACKET_SECTION_HEADINGS,
  HELP_PACKET_TITLE_MAX,
} from "./help-packet.js";
export type { HelpPacket, HelpPacketFields } from "./help-packet.js";

export function invitePopoutUrl(popoutUrl: string, token: string): string {
  const url = new URL(popoutUrl);
  url.searchParams.set("invite", token);
  return url.toString();
}

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
