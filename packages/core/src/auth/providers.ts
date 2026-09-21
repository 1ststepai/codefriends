import type { AuthProvider, AuthProviderInfo } from "@codefriends/shared";
import type { RuntimeConfig } from "../config.js";
import { googleGeminiAdapter } from "./google-gemini.js";
import type { AuthProviderAdapter } from "./types.js";

export const PROVIDER_COPY: Record<
  AuthProvider,
  { label: string; accountOf: string; blockedReason?: string; nextStep?: string }
> = {
  cursor: {
    label: "Cursor",
    accountOf: "Cursor",
    blockedReason:
      "Cursor does not publish a third-party OAuth / identity API for “Sign in with Cursor.” MCP OAuth in the IDE is the reverse direction (Cursor talking to your server), not Cursor account identity for an external app.",
    nextStep:
      "When Anysphere documents a public identity endpoint (or an official extension session API that yields a stable Cursor user id), implement start/complete on the cursor adapter. Until then the Cursor extension opens the popout with ?provider=cursor and can pass a CodeFriends session via handoff.",
  },
  claude: {
    label: "Claude",
    accountOf: "Claude / Anthropic",
    blockedReason:
      "Anthropic does not offer a public OAuth program for third-party apps to identify Claude.ai users. Consumer OAuth tokens are reserved for Claude.ai / Claude Code and using them elsewhere violates Anthropic’s terms.",
    nextStep:
      "Watch for an official Anthropic identity / “Sign in with Claude” developer program with registerable client ids. Do not reuse Claude Code’s internal client id.",
  },
  codex: {
    label: "Codex",
    accountOf: "ChatGPT / Codex",
    blockedReason:
      "“Sign in with ChatGPT” exists as an identity product but is limited to selected partners; there is no self-serve OAuth app registration for arbitrary third parties. Codex CLI OAuth is a first-party flow, not a supported third-party login.",
    nextStep:
      "Apply for / wait on official Sign in with ChatGPT partner access, then wire the OpenAI authorization-code + PKCE endpoints on the codex adapter. Do not scrape ~/.codex/auth.json or impersonate the Codex CLI client.",
  },
  gemini: {
    label: "Google",
    accountOf: "Google account",
    nextStep:
      "Create a Google Cloud OAuth Web client, add the callback URI(s), and set GEMINI_GOOGLE_CLIENT_ID / GEMINI_GOOGLE_CLIENT_SECRET / GEMINI_GOOGLE_CALLBACK_URL (plus CODEFRIENDS_PUBLIC_URL and CODEFRIENDS_POPOUT_URL).",
  },
  dev: {
    label: "Dev username",
    accountOf: "local demo",
    nextStep:
      "Enabled automatically outside production. Force with CODEFRIENDS_DEV_LOGIN=1; disable with =0.",
  },
};

export function buildAdapters(config: RuntimeConfig): Map<AuthProvider, AuthProviderAdapter> {
  const adapters = new Map<AuthProvider, AuthProviderAdapter>();
  adapters.set("gemini", googleGeminiAdapter(config.google));
  adapters.set("cursor", { id: "cursor", configured: false });
  adapters.set("claude", { id: "claude", configured: false });
  adapters.set("codex", { id: "codex", configured: false });
  adapters.set("dev", { id: "dev", configured: config.devLogin });
  return adapters;
}

export function describeProviders(
  config: RuntimeConfig,
  adapters: Map<AuthProvider, AuthProviderAdapter>,
): AuthProviderInfo[] {
  const ids: AuthProvider[] = ["gemini", "cursor", "claude", "codex", "dev"];
  return ids.map((id) => {
    const copy = PROVIDER_COPY[id];
    const adapter = adapters.get(id);
    if (id === "dev") {
      return {
        id,
        label: copy.label,
        accountOf: copy.accountOf,
        availability: config.devLogin ? "dev" : "blocked",
        startPath: config.devLogin ? "/api/auth/login" : undefined,
        blockedReason: config.devLogin ? undefined : "Dev username login is disabled (production default).",
        nextStep: copy.nextStep,
      };
    }
    if (id === "gemini") {
      const live = Boolean(adapter?.configured && adapter.start);
      return {
        id,
        label: copy.label,
        accountOf: copy.accountOf,
        availability: live ? "live" : config.mockProviders ? "mock" : "unconfigured",
        startPath: live ? "/api/auth/gemini/start" : undefined,
        nextStep: copy.nextStep,
      };
    }
    return {
      id,
      label: copy.label,
      accountOf: copy.accountOf,
      availability: config.mockProviders ? "mock" : "blocked",
      blockedReason: copy.blockedReason,
      nextStep: copy.nextStep,
    };
  });
}
