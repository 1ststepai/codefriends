import type { AuthProvider, ClientKind } from "@codefriends/shared";
import { AUTH_PROVIDERS } from "@codefriends/shared";
import type { RuntimeConfig } from "./config.js";
import { randomHex } from "./crypto.js";
import { buildAdapters, describeProviders } from "./auth/providers.js";
import type { AuthProviderAdapter, ProviderProfile } from "./auth/types.js";
import type { Store } from "./store.js";

const CLIENTS = new Set<ClientKind>(["cursor", "claude", "codex", "gemini", "web"]);

export interface HttpContext {
  store: Store;
  config: RuntimeConfig;
}

export async function handleHttp(request: Request, ctx: HttpContext): Promise<Response> {
  if (request.method === "OPTIONS") {
    return withCors(request, ctx.config, new Response(null, { status: 204 }));
  }

  try {
    const response = await route(request, ctx);
    return withCors(request, ctx.config, response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed";
    return withCors(request, ctx.config, json({ error: message }, 500));
  }
}

export function allowedCorsOrigin(request: Request, config: RuntimeConfig): string {
  const origin = request.headers.get("Origin");
  if (!origin) return "*";
  const allowed = new Set<string>([
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:4173",
    "http://localhost:4173",
    ...config.corsOrigins,
  ]);
  try {
    allowed.add(new URL(config.popoutUrl).origin);
  } catch {
    /* ignore invalid popout URL */
  }
  if (allowed.has(origin)) return origin;
  if (origin.endsWith(".vercel.app") || origin.endsWith(".pages.dev")) return origin;
  return allowed.has(origin) ? origin : [...allowed][0] ?? "*";
}

function withCors(request: Request, config: RuntimeConfig, response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", allowedCorsOrigin(request, config));
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Max-Age", "86400");
  headers.set("Vary", "Origin");
  return new Response(response.body, { status: response.status, headers });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function redirect(url: string): Response {
  return new Response(null, { status: 302, headers: { location: url } });
}

async function route(request: Request, ctx: HttpContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  const method = request.method.toUpperCase();
  const { store, config } = ctx;
  const adapters = buildAdapters(config);

  if (method === "GET" && path === "/health") {
    return json({
      ok: true,
      name: "codefriends",
      onlineCount: await store.onlineCount(),
      store: config.storeKind,
      dmHistoryLimit: config.dmHistoryLimit,
    });
  }

  if (method === "GET" && path === "/api/auth/providers") {
    return json({
      providers: describeProviders(config, adapters),
      mockProviders: config.mockProviders,
      popoutUrl: config.popoutUrl,
    });
  }

  if (method === "POST" && path === "/api/auth/login") {
    const body = await readJson(request);
    try {
      const username = String(body.username ?? "");
      const displayName = body.displayName ? String(body.displayName) : undefined;
      const client = optionalClient(body.client);
      const { user, token } = await store.login(username, displayName, client);
      return json({ token, user: await store.toPublic(user, { identities: true }) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      const status = message.includes("disabled") ? 403 : 400;
      return json({ error: message }, status);
    }
  }

  if (method === "POST" && path === "/api/auth/logout") {
    const token = bearer(request);
    if (token) await store.revokeToken(token);
    return json({ ok: true });
  }

  if (method === "POST" && path === "/api/auth/handoff") {
    const user = await store.userByToken(bearer(request));
    if (!user) return json({ error: "Sign in first" }, 401);
    return json({ code: await store.createHandoff(user.id), expiresInMs: config.handoffTtlMs });
  }

  if (method === "POST" && path === "/api/auth/handoff/redeem") {
    const body = await readJson(request);
    const user = await store.redeemHandoff(String(body.code ?? ""));
    if (!user) return json({ error: "Handoff expired or already used" }, 400);
    const client = optionalClient(body.client);
    if (client) {
      user.client = client;
      await store.persistUser(user);
    }
    const token = await store.issueToken(user.id);
    return json({ token, user: await store.toPublic(user, { identities: true }) });
  }

  const mockMatch = /^\/api\/auth\/([^/]+)\/mock$/.exec(path);
  if (method === "POST" && mockMatch) {
    const provider = parseProvider(mockMatch[1]);
    if (!provider) return json({ error: "Unknown provider" }, 404);
    if (provider === "dev") {
      return json({ error: "Use POST /api/auth/login for the dev username path" }, 400);
    }
    if (!config.mockProviders) {
      return json(
        {
          error: "Mock provider login is off. Set CODEFRIENDS_MOCK_PROVIDERS=1 for local architecture tests.",
        },
        403,
      );
    }
    try {
      const body = await readJson(request);
      const profile = mockProfile(provider, body);
      const session = await store.userByToken(bearer(request));
      const { user, token } = await store.loginWithIdentity(profile, {
        linkUserId: session?.id,
        client: optionalClient(body.client) ?? (provider === "gemini" ? "gemini" : provider),
      });
      return json({ token, user: await store.toPublic(user, { identities: true }) });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : "Mock login failed" }, 400);
    }
  }

  const startMatch = /^\/api\/auth\/([^/]+)\/start$/.exec(path);
  if (method === "GET" && startMatch) {
    const provider = parseProvider(startMatch[1]);
    if (!provider) return json({ error: "Unknown provider" }, 404);
    const adapter = adapters.get(provider);
    const listed = describeProviders(config, adapters).find((p) => p.id === provider);
    if (!adapter?.start || !adapter.configured) {
      return json(
        {
          error: listed?.blockedReason ?? `${provider} login is not available yet`,
          provider: listed,
        },
        501,
      );
    }
    const state = randomHex(24);
    const started = await adapter.start({
      state,
      callbackUrl: callbackUrl(config, provider, adapter),
    });
    const linker = await store.userByToken(bearer(request) ?? url.searchParams.get("token") ?? "");
    const link = url.searchParams.get("link") === "1" || url.searchParams.get("link") === "true";
    await store.saveOAuthState({
      state: started.state,
      provider,
      codeVerifier: started.codeVerifier,
      linkUserId: link ? linker?.id : undefined,
      client: optionalClient(url.searchParams.get("client")),
    });
    return redirect(started.authorizationUrl);
  }

  const callbackMatch = /^\/api\/auth\/([^/]+)\/callback$/.exec(path);
  if (method === "GET" && callbackMatch) {
    const provider = parseProvider(callbackMatch[1]);
    if (!provider) return json({ error: "Unknown provider" }, 404);
    const adapter = adapters.get(provider);
    const errorParam = url.searchParams.get("error") ?? "";
    if (errorParam) return redirect(popoutRedirect(config, { error: errorParam }));
    const state = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code") ?? "";
    const saved = await store.takeOAuthState(state);
    if (!saved || saved.provider !== provider) {
      return redirect(popoutRedirect(config, { error: "Login state expired. Try again." }));
    }
    if (!adapter?.complete) {
      return redirect(popoutRedirect(config, { error: `${provider} callback is not implemented` }));
    }
    try {
      const profile = await adapter.complete({
        code,
        callbackUrl: callbackUrl(config, provider, adapter),
        codeVerifier: saved.codeVerifier,
      });
      const { user } = await store.loginWithIdentity(profile, {
        linkUserId: saved.linkUserId,
        client: saved.client,
      });
      const handoff = await store.createHandoff(user.id);
      return redirect(popoutRedirect(config, { handoff, provider }));
    } catch (err) {
      return redirect(
        popoutRedirect(config, { error: err instanceof Error ? err.message : "Login failed" }),
      );
    }
  }

  if (method === "GET" && path === "/api/me") {
    const user = await store.userByToken(bearer(request));
    if (!user) return json({ error: "Sign in first" }, 401);
    return json({
      user: await store.toPublic(user, { identities: true }),
      friends: await store.friendList(user.id),
      identities: await store.identitiesOf(user.id),
    });
  }

  if (method === "GET" && path === "/api/friends") {
    const user = await store.userByToken(bearer(request));
    if (!user) return json({ error: "Sign in first" }, 401);
    return json({ friends: await store.friendList(user.id) });
  }

  if (method === "POST" && path === "/api/friends") {
    const user = await store.userByToken(bearer(request));
    if (!user) return json({ error: "Sign in first" }, 401);
    try {
      const body = await readJson(request);
      const friend = await store.addFriend(user.id, String(body.username ?? ""));
      return json({ friend, friends: await store.friendList(user.id) });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : "Could not add friend" }, 400);
    }
  }

  if (method === "GET" && path === "/api/messages") {
    const user = await store.userByToken(bearer(request));
    if (!user) return json({ error: "Sign in first" }, 401);
    const withId = url.searchParams.get("with") ?? "";
    return json({
      messages: await store.messagesFor(user.id, withId || undefined),
    });
  }

  if (method === "GET" && path === "/api/presence") {
    return json({
      onlineCount: await store.onlineCount(),
      online: await store.onlineUsers(),
    });
  }

  return json({ error: "Not found" }, 404);
}

export function bearer(request: Request): string | undefined {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1];
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text) return {};
  const parsed = JSON.parse(text) as unknown;
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

function parseProvider(raw: string | undefined): AuthProvider | undefined {
  return AUTH_PROVIDERS.find((p) => p === raw);
}

function optionalClient(raw: unknown): ClientKind | undefined {
  const value = typeof raw === "string" ? raw : undefined;
  return value && CLIENTS.has(value as ClientKind) ? (value as ClientKind) : undefined;
}

function mockProfile(provider: AuthProvider, body: Record<string, unknown>): ProviderProfile {
  const subject = String(body.subject ?? "").trim();
  if (!subject) throw new Error("Mock login needs { subject } — the provider’s stable account id");
  return {
    provider,
    subject,
    email: body.email ? String(body.email) : undefined,
    displayName: body.displayName ? String(body.displayName) : undefined,
    usernameHint: body.usernameHint ? String(body.usernameHint) : undefined,
  };
}

function callbackUrl(config: RuntimeConfig, provider: AuthProvider, adapter: AuthProviderAdapter): string {
  if (provider === "gemini") return config.google.callbackUrl;
  return `${config.publicUrl}/api/auth/${adapter.id}/callback`;
}

function popoutRedirect(config: RuntimeConfig, query: Record<string, string | undefined>): string {
  const url = new URL(config.popoutUrl);
  for (const [key, value] of Object.entries(query)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}
