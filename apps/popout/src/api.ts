import type { AuthProviderInfo, PublicUser } from "@codefriends/shared";
import { parseInviteToken } from "@codefriends/shared";
import { apiUrl } from "./config";

export interface AuthCatalog {
  providers: AuthProviderInfo[];
  mockProviders: boolean;
  popoutUrl: string;
}

export { apiUrl, wsUrl } from "./config";

export async function fetchProviders(): Promise<AuthCatalog> {
  const res = await fetch(apiUrl("/api/auth/providers"));
  if (!res.ok) throw new Error("Could not load sign-in options");
  return (await res.json()) as AuthCatalog;
}

export async function login(username: string, displayName?: string, client?: string) {
  const res = await fetch(apiUrl("/api/auth/login"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, displayName, client }),
  });
  return readSession(res, "Login failed");
}

export async function redeemHandoff(code: string, client?: string) {
  const res = await fetch(apiUrl("/api/auth/handoff/redeem"), {
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
  const res = await fetch(apiUrl(`/api/auth/${provider}/mock`), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return readSession(res, "Mock login failed");
}

export async function peekInvite(raw: string) {
  const token = parseInviteToken(raw);
  if (!token) throw new Error("Invite expired or not found");
  const res = await fetch(apiUrl(`/api/invites/${encodeURIComponent(token)}`));
  const data = (await res.json()) as { inviter?: PublicUser; expiresAt?: number; error?: string };
  if (!res.ok || !data.inviter) throw new Error(data.error ?? "Invite expired or not found");
  return { inviter: data.inviter, expiresAt: data.expiresAt ?? 0 };
}

export async function createInvite(token: string) {
  const res = await fetch(apiUrl("/api/invites"), {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  const data = (await res.json()) as {
    token?: string;
    url?: string;
    path?: string;
    expiresAt?: number;
    error?: string;
  };
  if (!res.ok || !data.token || !data.url) throw new Error(data.error ?? "Could not create invite");
  return { token: data.token, url: data.url, path: data.path ?? `/invite/${data.token}`, expiresAt: data.expiresAt ?? 0 };
}

export async function acceptInvite(sessionToken: string, raw: string) {
  const res = await fetch(apiUrl("/api/invites/accept"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${sessionToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ token: parseInviteToken(raw) }),
  });
  const data = (await res.json()) as { friend?: PublicUser; friends?: PublicUser[]; error?: string };
  if (!res.ok || !data.friend || !data.friends) throw new Error(data.error ?? "Could not accept invite");
  return { friend: data.friend, friends: data.friends };
}

export async function createHandoff(token: string) {
  const res = await fetch(apiUrl("/api/auth/handoff"), {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  const data = (await res.json()) as { code?: string; error?: string };
  if (!res.ok || !data.code) throw new Error(data.error ?? "Handoff failed");
  return data.code;
}

async function readSession(res: Response, fallback: string) {
  const data = (await res.json()) as { token?: string; user?: PublicUser; error?: string };
  if (!res.ok || !data.token || !data.user) {
    throw new Error(data.error ?? fallback);
  }
  return { token: data.token, user: data.user };
}
