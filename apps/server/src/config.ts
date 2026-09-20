import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));

for (const candidate of [resolve(process.cwd(), ".env"), resolve(here, "../../../.env"), resolve(here, "../../.env")]) {
  if (existsSync(candidate)) loadEnv({ path: candidate, override: false });
}

export interface ServerConfig {
  dbPath: string;
  publicUrl: string;
  popoutUrl: string;
  sessionTtlMs: number;
  handoffTtlMs: number;
  oauthStateTtlMs: number;
  /** Username-only login. Off in production unless explicitly re-enabled. */
  devLogin: boolean;
  /** Lets tests / local demos complete the provider interface without real OAuth apps. */
  mockProviders: boolean;
  google: {
    clientId: string;
    clientSecret: string;
    callbackUrl: string;
  };
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function defaultDbPath(): string {
  return join(here, "../data/codefriends.sqlite");
}

export function loadConfig(overrides?: Partial<ServerConfig> & { port?: number; host?: string }): ServerConfig {
  const host = overrides?.host ?? process.env.HOST ?? "127.0.0.1";
  const port = overrides?.port ?? Number(process.env.PORT ?? 8787);
  const publicUrl = (process.env.CODEFRIENDS_PUBLIC_URL ?? `http://${host}:${port}`).replace(/\/$/, "");
  const popoutUrl = (process.env.CODEFRIENDS_POPOUT_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");

  const production = isProduction();
  const devFlag = process.env.CODEFRIENDS_DEV_LOGIN;
  const devLogin =
    devFlag === "1" ? true : devFlag === "0" ? false : !production;

  return {
    dbPath: overrides?.dbPath ?? process.env.CODEFRIENDS_DB ?? defaultDbPath(),
    publicUrl,
    popoutUrl,
    sessionTtlMs: overrides?.sessionTtlMs ?? 30 * 24 * 60 * 60 * 1000,
    handoffTtlMs: overrides?.handoffTtlMs ?? 2 * 60 * 1000,
    oauthStateTtlMs: overrides?.oauthStateTtlMs ?? 10 * 60 * 1000,
    devLogin: overrides?.devLogin ?? devLogin,
    mockProviders: overrides?.mockProviders ?? process.env.CODEFRIENDS_MOCK_PROVIDERS === "1",
    google: {
      clientId: process.env.GEMINI_GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GEMINI_GOOGLE_CLIENT_SECRET ?? "",
      callbackUrl: process.env.GEMINI_GOOGLE_CALLBACK_URL ?? `${publicUrl}/api/auth/gemini/callback`,
    },
  };
}
