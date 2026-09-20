/**
 * Opt-in “Connect CodeFriends?” policy for the VS Code / Cursor extension.
 * Keep aligned with packages/shared/src/connect-prompt.ts and packages/connect-client/connect.mjs.
 */

export const DONT_ASK_KEY = "codefriends.connect.dontAskAgain";
export const SNOOZE_KEY = "codefriends.connect.snoozeUntil";
export const CONNECT_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

export type ConnectDecision = "prompt" | "skip-connected" | "skip-dont-ask" | "skip-snoozed";
export type ConnectChoice = "connect" | "not-now" | "dont-ask";
export type ConnectHost = "cursor" | "claude" | "codex" | "gemini" | "generic";

const HOSTS: ConnectHost[] = ["cursor", "claude", "codex", "gemini", "generic"];

export function decideConnectPrompt(
  state: { hasSession: boolean; dontAskAgain: boolean; snoozeUntil?: number },
  now = Date.now(),
): ConnectDecision {
  if (state.hasSession) return "skip-connected";
  if (state.dontAskAgain) return "skip-dont-ask";
  if ((state.snoozeUntil ?? 0) > now) return "skip-snoozed";
  return "prompt";
}

export function nextSnoozeUntil(now = Date.now(), snoozeMs = CONNECT_SNOOZE_MS): number {
  return now + snoozeMs;
}

export function applyConnectChoice(
  state: { dontAskAgain: boolean; snoozeUntil: number },
  choice: ConnectChoice,
  now = Date.now(),
): { dontAskAgain: boolean; snoozeUntil: number } {
  if (choice === "dont-ask") return { ...state, dontAskAgain: true };
  if (choice === "not-now" || choice === "connect") {
    return { ...state, snoozeUntil: nextSnoozeUntil(now) };
  }
  return state;
}

export function resolveIdeProvider(appName: string, setting = "auto"): ConnectHost {
  const normalized = setting.trim().toLowerCase();
  if ((HOSTS as string[]).includes(normalized)) return normalized as ConnectHost;
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

export function connectPromptMessage(host: ConnectHost): string {
  const label = host === "cursor" ? "Cursor" : host === "generic" ? "this editor" : host;
  return `Connect CodeFriends? Opens the popout so you can finish CodeFriends login there. This is an extension opt-in — not ${label}’s own account login screen.`;
}
