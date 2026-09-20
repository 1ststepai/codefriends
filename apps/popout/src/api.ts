import type { PublicUser } from "@codefriends/shared";

export async function login(username: string, displayName?: string) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, displayName }),
  });
  const data = (await res.json()) as { token?: string; user?: PublicUser; error?: string };
  if (!res.ok || !data.token || !data.user) {
    throw new Error(data.error ?? "Login failed");
  }
  return { token: data.token, user: data.user };
}

export function wsUrl(token: string): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`;
}
