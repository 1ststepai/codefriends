import { DM_HISTORY_LIMIT_DEFAULT, INVITE_TTL_MS_DEFAULT } from "@codefriends/shared";

export type StoreKind = "sqlite" | "libsql" | "d1";

export interface RuntimeConfig {
  publicUrl: string;
  popoutUrl: string;
  sessionTtlMs: number;
  handoffTtlMs: number;
  oauthStateTtlMs: number;
  /** Username-only login. Off in production unless explicitly re-enabled. */
  devLogin: boolean;
  /** Lets tests / local demos complete the provider interface without real OAuth apps. */
  mockProviders: boolean;
  /** Last N 1:1 DMs kept per thread. */
  dmHistoryLimit: number;
  /** Reusable invite tokens expire after this many ms (default 7 days). */
  inviteTtlMs: number;
  storeKind: StoreKind;
  /** Extra browser origins allowed for CORS (popout origin is always included). */
  corsOrigins: string[];
  google: {
    clientId: string;
    clientSecret: string;
    callbackUrl: string;
  };
}

export function trimEnv(raw: string | undefined): string {
  return raw?.trim() ?? "";
}

export function defaultRuntimeConfig(partial?: Partial<RuntimeConfig>): RuntimeConfig {
  const publicUrl = (trimEnv(partial?.publicUrl) || "http://127.0.0.1:8787").replace(/\/$/, "");
  return {
    publicUrl,
    popoutUrl: (trimEnv(partial?.popoutUrl) || "http://127.0.0.1:5173").replace(/\/$/, ""),
    sessionTtlMs: partial?.sessionTtlMs ?? 30 * 24 * 60 * 60 * 1000,
    handoffTtlMs: partial?.handoffTtlMs ?? 2 * 60 * 1000,
    oauthStateTtlMs: partial?.oauthStateTtlMs ?? 10 * 60 * 1000,
    devLogin: partial?.devLogin ?? true,
    mockProviders: partial?.mockProviders ?? false,
    dmHistoryLimit: clampHistoryLimit(partial?.dmHistoryLimit ?? DM_HISTORY_LIMIT_DEFAULT),
    inviteTtlMs: clampInviteTtl(partial?.inviteTtlMs ?? INVITE_TTL_MS_DEFAULT),
    storeKind: partial?.storeKind ?? "sqlite",
    corsOrigins: partial?.corsOrigins ?? [],
    google: {
      clientId: trimEnv(partial?.google?.clientId),
      clientSecret: trimEnv(partial?.google?.clientSecret),
      callbackUrl: trimEnv(partial?.google?.callbackUrl) || `${publicUrl}/api/auth/gemini/callback`,
    },
  };
}

export function clampHistoryLimit(value: number): number {
  if (!Number.isFinite(value)) return DM_HISTORY_LIMIT_DEFAULT;
  return Math.min(500, Math.max(1, Math.floor(value)));
}

export function clampInviteTtl(value: number): number {
  if (!Number.isFinite(value)) return INVITE_TTL_MS_DEFAULT;
  return Math.min(30 * 24 * 60 * 60 * 1000, Math.max(60_000, Math.floor(value)));
}

export function parseHistoryLimit(raw: string | undefined, fallback = DM_HISTORY_LIMIT_DEFAULT): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? clampHistoryLimit(n) : fallback;
}

export function parseCorsOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

export function isProductionEnv(nodeEnv: string | undefined): boolean {
  return nodeEnv === "production";
}
