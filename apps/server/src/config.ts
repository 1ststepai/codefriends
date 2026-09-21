import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import {
  defaultRuntimeConfig,
  isProductionEnv,
  parseCorsOrigins,
  parseHistoryLimit,
  trimEnv,
  type RuntimeConfig,
  type StoreKind,
} from "@codefriends/core";

const here = dirname(fileURLToPath(import.meta.url));

for (const candidate of [resolve(process.cwd(), ".env"), resolve(here, "../../../.env"), resolve(here, "../../.env")]) {
  if (existsSync(candidate)) loadEnv({ path: candidate, override: false });
}

export interface ServerConfig extends RuntimeConfig {
  dbPath: string;
  libsqlUrl: string;
  libsqlAuthToken: string;
  host: string;
  port: number;
  /** Directory of a built `apps/popout` (`dist`). Served when `index.html` exists. */
  popoutDir: string;
  servePopout: boolean;
  /** Shared secret for `/metrics` and `/admin`. Empty = those routes 404. */
  adminToken: string;
  /** Daily JSONL samples/alerts. null = in-memory only (`:memory:` DBs). */
  monitorDir: string | null;
  /** If this file exists, alert lines are appended. Missing path is a no-op. */
  agentMemoryPath: string;
}

export function isProduction(): boolean {
  return isProductionEnv(process.env.NODE_ENV);
}

export function defaultDbPath(): string {
  return join(here, "../data/codefriends.sqlite");
}

export function defaultPopoutDir(): string {
  return resolve(here, "../../popout/dist");
}

export function defaultMonitorDir(dbPath: string, override?: string): string | null {
  if (override) return override;
  if (!dbPath || dbPath === ":memory:") return null;
  return join(dirname(dbPath), "monitor");
}

/** `/health`, `/metrics`, `/admin*`, and `/api/*` stay on the JSON API; everything else can be the SPA. */
export function isApiHttpPath(pathname: string): boolean {
  const path = pathname.replace(/\/$/, "") || "/";
  return path === "/health" || path === "/metrics" || path.startsWith("/admin") || path.startsWith("/api");
}

export function loadConfig(
  overrides?: Partial<ServerConfig> & { port?: number; host?: string },
): ServerConfig {
  const production = isProduction();
  const host = overrides?.host ?? process.env.HOST ?? (production ? "0.0.0.0" : "127.0.0.1");
  const port = overrides?.port ?? Number(process.env.PORT ?? 8787);
  const publicUrl = (
    trimEnv(overrides?.publicUrl) ||
    trimEnv(process.env.CODEFRIENDS_PUBLIC_URL) ||
    `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`
  ).replace(/\/$/, "");
  const popoutUrl = (
    trimEnv(overrides?.popoutUrl) ||
    trimEnv(process.env.CODEFRIENDS_POPOUT_URL) ||
    "http://127.0.0.1:5173"
  ).replace(/\/$/, "");

  const devFlag = process.env.CODEFRIENDS_DEV_LOGIN;
  const devLogin = overrides?.devLogin ?? (devFlag === "1" ? true : devFlag === "0" ? false : !production);

  const libsqlUrl = overrides?.libsqlUrl ?? process.env.CODEFRIENDS_LIBSQL_URL ?? "";
  const storeKind: StoreKind = overrides?.storeKind ?? (libsqlUrl ? "libsql" : "sqlite");

  const base = defaultRuntimeConfig({
    ...overrides,
    publicUrl: overrides?.publicUrl ?? publicUrl,
    popoutUrl: overrides?.popoutUrl ?? popoutUrl,
    devLogin,
    mockProviders: overrides?.mockProviders ?? process.env.CODEFRIENDS_MOCK_PROVIDERS === "1",
    dmHistoryLimit: overrides?.dmHistoryLimit ?? parseHistoryLimit(process.env.CODEFRIENDS_DM_HISTORY_LIMIT),
    storeKind,
    corsOrigins: overrides?.corsOrigins ?? parseCorsOrigins(process.env.CODEFRIENDS_CORS_ORIGINS),
    google: {
      clientId: trimEnv(overrides?.google?.clientId ?? process.env.GEMINI_GOOGLE_CLIENT_ID),
      clientSecret: trimEnv(overrides?.google?.clientSecret ?? process.env.GEMINI_GOOGLE_CLIENT_SECRET),
      callbackUrl:
        trimEnv(overrides?.google?.callbackUrl ?? process.env.GEMINI_GOOGLE_CALLBACK_URL) ||
        `${publicUrl}/api/auth/gemini/callback`,
    },
  });

  const popoutDir = overrides?.popoutDir ?? process.env.CODEFRIENDS_POPOUT_DIR ?? defaultPopoutDir();
  const servePopout = overrides?.servePopout ?? existsSync(join(popoutDir, "index.html"));
  const dbPath = overrides?.dbPath ?? process.env.CODEFRIENDS_DB ?? defaultDbPath();
  const monitorDir =
    overrides && "monitorDir" in overrides
      ? (overrides.monitorDir ?? null)
      : defaultMonitorDir(dbPath, process.env.CODEFRIENDS_MONITOR_DIR);

  return {
    ...base,
    dbPath,
    libsqlUrl,
    libsqlAuthToken: overrides?.libsqlAuthToken ?? process.env.CODEFRIENDS_LIBSQL_AUTH_TOKEN ?? "",
    host,
    port,
    popoutDir,
    servePopout,
    adminToken: overrides?.adminToken !== undefined ? overrides.adminToken : (process.env.CODEFRIENDS_ADMIN_TOKEN ?? ""),
    monitorDir,
    agentMemoryPath:
      overrides?.agentMemoryPath !== undefined
        ? overrides.agentMemoryPath
        : (process.env.CODEFRIENDS_AGENT_MEMORY_PATH ?? ""),
  };
}
