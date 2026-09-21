import {
  defaultRuntimeConfig,
  parseCorsOrigins,
  parseHistoryLimit,
  trimEnv,
  type RuntimeConfig,
} from "@codefriends/core";

export interface WorkerEnv {
  DB: D1Database;
  HUB: DurableObjectNamespace;
  CODEFRIENDS_PUBLIC_URL?: string;
  CODEFRIENDS_POPOUT_URL?: string;
  CODEFRIENDS_DEV_LOGIN?: string;
  CODEFRIENDS_MOCK_PROVIDERS?: string;
  CODEFRIENDS_SEED?: string;
  CODEFRIENDS_DM_HISTORY_LIMIT?: string;
  CODEFRIENDS_CORS_ORIGINS?: string;
  GEMINI_GOOGLE_CLIENT_ID?: string;
  GEMINI_GOOGLE_CLIENT_SECRET?: string;
  GEMINI_GOOGLE_CALLBACK_URL?: string;
}

export function configFromEnv(env: WorkerEnv, requestUrl?: string): RuntimeConfig {
  const origin = requestUrl ? new URL(requestUrl).origin : "http://127.0.0.1:8787";
  const publicUrl = (trimEnv(env.CODEFRIENDS_PUBLIC_URL) || origin).replace(/\/$/, "");
  const popoutUrl = (trimEnv(env.CODEFRIENDS_POPOUT_URL) || "http://127.0.0.1:5173").replace(/\/$/, "");
  const devFlag = env.CODEFRIENDS_DEV_LOGIN;
  return defaultRuntimeConfig({
    publicUrl,
    popoutUrl,
    devLogin: devFlag === "1",
    mockProviders: env.CODEFRIENDS_MOCK_PROVIDERS === "1",
    dmHistoryLimit: parseHistoryLimit(env.CODEFRIENDS_DM_HISTORY_LIMIT),
    storeKind: "d1",
    corsOrigins: parseCorsOrigins(env.CODEFRIENDS_CORS_ORIGINS),
    google: {
      clientId: trimEnv(env.GEMINI_GOOGLE_CLIENT_ID),
      clientSecret: trimEnv(env.GEMINI_GOOGLE_CLIENT_SECRET),
      callbackUrl: trimEnv(env.GEMINI_GOOGLE_CALLBACK_URL) || `${publicUrl}/api/auth/gemini/callback`,
    },
  });
}
