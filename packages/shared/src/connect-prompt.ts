/** Hosts that can offer an opt-in “Connect CodeFriends?” prompt. */
export const CONNECT_HOSTS = ["cursor", "claude", "codex", "gemini", "generic"] as const;
export type ConnectHost = (typeof CONNECT_HOSTS)[number];

export type ConnectDecision = "prompt" | "skip-connected" | "skip-dont-ask" | "skip-snoozed";
export type ConnectChoice = "connect" | "not-now" | "dont-ask";

export interface ConnectHostState {
  dontAskAgain: boolean;
  /** Epoch ms. 0 means not snoozed. */
  snoozeUntil: number;
  /** CodeFriends bearer token if this host stored one. Empty means unknown / signed out. */
  sessionToken: string;
}

/** “Not now” / post-Connect cooldown — ask again after a few days. */
export const CONNECT_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

export function emptyConnectHostState(): ConnectHostState {
  return { dontAskAgain: false, snoozeUntil: 0, sessionToken: "" };
}

export function decideConnectPrompt(
  state: Pick<ConnectHostState, "dontAskAgain" | "snoozeUntil" | "sessionToken">,
  now = Date.now(),
): ConnectDecision {
  if (state.sessionToken) return "skip-connected";
  if (state.dontAskAgain) return "skip-dont-ask";
  if ((state.snoozeUntil ?? 0) > now) return "skip-snoozed";
  return "prompt";
}

/**
 * Persist the user’s choice. Connect also snoozes so a successful open
 * does not re-nag on the next window while they finish login in the popout.
 */
export function applyConnectChoice(
  state: ConnectHostState,
  choice: ConnectChoice,
  now = Date.now(),
  snoozeMs = CONNECT_SNOOZE_MS,
): ConnectHostState {
  if (choice === "dont-ask") {
    return { ...state, dontAskAgain: true };
  }
  if (choice === "not-now" || choice === "connect") {
    return { ...state, snoozeUntil: now + snoozeMs };
  }
  return state;
}

export function resolveIdeProvider(appName: string, setting = "auto"): ConnectHost {
  const normalized = setting.trim().toLowerCase();
  if ((CONNECT_HOSTS as readonly string[]).includes(normalized)) {
    return normalized as ConnectHost;
  }
  if (/cursor/i.test(appName)) return "cursor";
  return "generic";
}

export function popoutClientFor(provider: string): string {
  if (provider === "generic" || provider === "dev") return "web";
  return provider;
}

export function buildPopoutUrl(opts: {
  popoutUrl: string;
  provider: string;
  client?: string;
  handoff?: string;
}): string {
  const url = new URL(opts.popoutUrl.replace(/\/$/, ""));
  url.searchParams.set("provider", opts.provider);
  url.searchParams.set("client", opts.client ?? popoutClientFor(opts.provider));
  if (opts.handoff) url.searchParams.set("handoff", opts.handoff);
  return url.toString();
}

export function hostLabel(host: string): string {
  switch (host) {
    case "cursor":
      return "Cursor";
    case "claude":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "gemini":
      return "Gemini";
    default:
      return "this editor";
  }
}
