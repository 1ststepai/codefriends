import type { AuthProviderInfo, PublicUser } from "@codefriends/shared";

export interface AuthCatalog {
  providers: AuthProviderInfo[];
  mockProviders: boolean;
  popoutUrl: string;
}

export async function fetchProviders(): Promise<AuthCatalog> {
  const res = await fetch("/api/auth/providers");
  if (!res.ok) throw new Error("Could not load sign-in options");
  return (await res.json()) as AuthCatalog;
}

export async function login(username: string, displayName?: string, client?: string) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, displayName, client }),
  });
  return readSession(res, "Login failed");
}

export async function redeemHandoff(code: string, client?: string) {
  const res = await fetch("/api/auth/handoff/redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, client }),
  });
  return readSession(res, "Could not restore session");
}

export async function mockProviderLogin(
  provider: string,
  body: { subject: string; email?: string; displayName?: string; usernameHint?: string },
  token?: string,
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`/api/auth/${provider}/mock`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return readSession(res, "Mock login failed");
}

export async function createHandoff(token: string) {
  const res = await fetch("/api/auth/handoff", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  const data = (await res.json()) as { code?: string; error?: string };
  if (!res.ok || !data.code) throw new Error(data.error ?? "Handoff failed");
  return data.code;
}

export function wsUrl(token: string): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`;
}

async function readSession(res: Response, fallback: string) {
  const data = (await res.json()) as { token?: string; user?: PublicUser; error?: string };
  if (!res.ok || !data.token || !data.user) {
    throw new Error(data.error ?? fallback);
  }
  return { token: data.token, user: data.user };
}
