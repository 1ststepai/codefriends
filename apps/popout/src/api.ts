import type { AuthProviderInfo, ForumReply, ForumTopic, LibraryItem, PublicUser } from "@codefriends/shared";
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

export async function updateProfile(
  token: string,
  patch: {
    githubUrl?: string;
    website?: string;
    tools?: string;
    twitterUrl?: string;
    facebookUrl?: string;
    telegramUrl?: string;
    whatsappUrl?: string;
    currentlyBuilding?: string;
    ownsBusiness?: boolean;
    businessNote?: string;
    wantsToHelpOthersBuild?: boolean;
  },
) {
  const res = await fetch(apiUrl("/api/me/profile"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(patch),
  });
  const data = (await res.json()) as { user?: PublicUser; error?: string };
  if (!res.ok || !data.user) throw new Error(data.error ?? "Could not update profile");
  return data.user;
}

export async function listTopics(token: string) {
  const res = await fetch(apiUrl("/api/topics"), {
    headers: { authorization: `Bearer ${token}` },
  });
  const data = (await res.json()) as { topics?: ForumTopic[]; error?: string };
  if (!res.ok || !data.topics) throw new Error(data.error ?? "Could not load the school board");
  return data.topics;
}

export async function createTopic(token: string, title: string, body: string) {
  const res = await fetch(apiUrl("/api/topics"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ title, body }),
  });
  const data = (await res.json()) as { topic?: ForumTopic; error?: string };
  if (!res.ok || !data.topic) throw new Error(data.error ?? "Could not post to the board");
  return data.topic;
}

function topicPathId(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("Could not open that thread");
  }
  return id;
}

export async function getTopic(token: string, id: string) {
  const res = await fetch(apiUrl(`/api/topics/${topicPathId(id)}`), {
    headers: { authorization: `Bearer ${token}` },
  });
  const data = (await res.json()) as { topic?: ForumTopic; replies?: ForumReply[]; error?: string };
  if (!res.ok || !data.topic) throw new Error(data.error ?? "Could not open that thread");
  return { topic: data.topic, replies: data.replies ?? [] };
}

export async function listLibrary(token: string) {
  const res = await fetch(apiUrl("/api/library"), {
    headers: { authorization: `Bearer ${token}` },
  });
  const data = (await res.json()) as { items?: LibraryItem[]; error?: string };
  if (!res.ok || !data.items) throw new Error(data.error ?? "Could not load the build library");
  return data.items;
}

export async function addLibraryItem(
  token: string,
  input: { title: string; description: string; url: string; kind: string },
) {
  const res = await fetch(apiUrl("/api/library"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as { item?: LibraryItem; error?: string };
  if (!res.ok || !data.item) throw new Error(data.error ?? "Could not add to the library");
  return data.item;
}

export async function deleteLibraryItem(token: string, id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("Could not remove that item");
  }
  const res = await fetch(apiUrl(`/api/library/${id}`), {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  const data = (await res.json()) as { ok?: boolean; error?: string };
  if (!res.ok) throw new Error(data.error ?? "Could not remove that item");
}

export async function addTopicReply(token: string, topicId: string, body: string) {
  const res = await fetch(apiUrl(`/api/topics/${topicPathId(topicId)}/replies`), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ body }),
  });
  const data = (await res.json()) as {
    reply?: ForumReply;
    topic?: ForumTopic;
    replies?: ForumReply[];
    error?: string;
  };
  if (!res.ok || !data.reply) throw new Error(data.error ?? "Could not reply");
  return { reply: data.reply, topic: data.topic, replies: data.replies ?? [] };
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
