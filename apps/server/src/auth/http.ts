import { randomBytes } from "node:crypto";
import type { Express, Request, Response } from "express";
import type { AuthProvider, ClientKind } from "@codefriends/shared";
import { AUTH_PROVIDERS } from "@codefriends/shared";
import type { ServerConfig } from "../config.js";
import type { Store } from "../store.js";
import { buildAdapters, describeProviders } from "./providers.js";
import type { AuthProviderAdapter, ProviderProfile } from "./types.js";

const CLIENTS = new Set<ClientKind>(["cursor", "claude", "codex", "gemini", "web"]);

export function attachAuth(app: Express, store: Store, config: ServerConfig): void {
  const adapters = buildAdapters(config);

  app.get("/api/auth/providers", (_req, res) => {
    res.json({
      providers: describeProviders(config, adapters),
      mockProviders: config.mockProviders,
      popoutUrl: config.popoutUrl,
    });
  });

  app.post("/api/auth/login", (req, res) => {
    try {
      const username = String(req.body?.username ?? "");
      const displayName = req.body?.displayName ? String(req.body.displayName) : undefined;
      const client = optionalClient(req.body?.client);
      const { user, token } = store.login(username, displayName, client);
      res.json({ token, user: store.toPublic(user, { identities: true }) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      const status = message.includes("disabled") ? 403 : 400;
      res.status(status).json({ error: message });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    const token = bearer(req);
    if (token) store.revokeToken(token);
    res.json({ ok: true });
  });

  app.post("/api/auth/handoff", (req, res) => {
    const user = store.userByToken(bearer(req));
    if (!user) {
      res.status(401).json({ error: "Sign in first" });
      return;
    }
    res.json({ code: store.createHandoff(user.id), expiresInMs: config.handoffTtlMs });
  });

  app.post("/api/auth/handoff/redeem", (req, res) => {
    const code = String(req.body?.code ?? "");
    const user = store.redeemHandoff(code);
    if (!user) {
      res.status(400).json({ error: "Handoff expired or already used" });
      return;
    }
    const client = optionalClient(req.body?.client);
    if (client) {
      user.client = client;
      store.persistUser(user);
    }
    const token = store.issueToken(user.id);
    res.json({ token, user: store.toPublic(user, { identities: true }) });
  });

  app.post("/api/auth/:provider/mock", (req, res) => {
    const provider = parseProvider(req.params.provider);
    if (!provider) {
      res.status(404).json({ error: "Unknown provider" });
      return;
    }
    if (provider === "dev") {
      res.status(400).json({ error: "Use POST /api/auth/login for the dev username path" });
      return;
    }
    if (!config.mockProviders) {
      res.status(403).json({
        error: "Mock provider login is off. Set CODEFRIENDS_MOCK_PROVIDERS=1 for local architecture tests.",
      });
      return;
    }
    try {
      const profile = mockProfile(provider, req.body);
      const session = store.userByToken(bearer(req));
      const { user, token } = store.loginWithIdentity(profile, {
        linkUserId: session?.id,
        client: optionalClient(req.body?.client) ?? (provider === "gemini" ? "gemini" : provider),
      });
      res.json({ token, user: store.toPublic(user, { identities: true }) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Mock login failed" });
    }
  });

  app.get("/api/auth/:provider/start", async (req, res) => {
    const provider = parseProvider(req.params.provider);
    if (!provider) {
      res.status(404).json({ error: "Unknown provider" });
      return;
    }
    const adapter = adapters.get(provider);
    const listed = describeProviders(config, adapters).find((p) => p.id === provider);
    if (!adapter?.start || !adapter.configured) {
      res.status(501).json({
        error: listed?.blockedReason ?? `${provider} login is not available yet`,
        provider: listed,
      });
      return;
    }
    try {
      const state = randomBytes(24).toString("hex");
      const started = await adapter.start({
        state,
        callbackUrl: callbackUrl(config, provider, adapter),
      });
      const linker = store.userByToken(bearer(req) ?? String(req.query.token ?? ""));
      const link = req.query.link === "1" || req.query.link === "true";
      store.saveOAuthState({
        state: started.state,
        provider,
        codeVerifier: started.codeVerifier,
        linkUserId: link ? linker?.id : undefined,
        client: optionalClient(req.query.client),
      });
      res.redirect(started.authorizationUrl);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Could not start login" });
    }
  });

  app.get("/api/auth/:provider/callback", async (req, res) => {
    const provider = parseProvider(req.params.provider);
    if (!provider) {
      res.status(404).json({ error: "Unknown provider" });
      return;
    }
    const adapter = adapters.get(provider);
    const errorParam = req.query.error ? String(req.query.error) : "";
    if (errorParam) {
      redirectPopout(res, config, { error: errorParam });
      return;
    }
    const state = String(req.query.state ?? "");
    const code = String(req.query.code ?? "");
    const saved = store.takeOAuthState(state);
    if (!saved || saved.provider !== provider) {
      redirectPopout(res, config, { error: "Login state expired. Try again." });
      return;
    }
    if (!adapter?.complete) {
      redirectPopout(res, config, { error: `${provider} callback is not implemented` });
      return;
    }
    try {
      const profile = await adapter.complete({
        code,
        callbackUrl: callbackUrl(config, provider, adapter),
        codeVerifier: saved.codeVerifier,
      });
      const { user } = store.loginWithIdentity(profile, {
        linkUserId: saved.linkUserId,
        client: saved.client,
      });
      const handoff = store.createHandoff(user.id);
      redirectPopout(res, config, { handoff, provider });
    } catch (err) {
      redirectPopout(res, config, {
        error: err instanceof Error ? err.message : "Login failed",
      });
    }
  });
}

export function bearer(req: Request): string | undefined {
  const header = req.header("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1];
}

function parseProvider(raw: string | undefined): AuthProvider | undefined {
  return AUTH_PROVIDERS.find((p) => p === raw);
}

function optionalClient(raw: unknown): ClientKind | undefined {
  const value = typeof raw === "string" ? raw : undefined;
  return value && CLIENTS.has(value as ClientKind) ? (value as ClientKind) : undefined;
}

function mockProfile(provider: AuthProvider, body: Record<string, unknown> | undefined): ProviderProfile {
  const subject = String(body?.subject ?? "").trim();
  if (!subject) throw new Error("Mock login needs { subject } — the provider’s stable account id");
  return {
    provider,
    subject,
    email: body?.email ? String(body.email) : undefined,
    displayName: body?.displayName ? String(body.displayName) : undefined,
    usernameHint: body?.usernameHint ? String(body.usernameHint) : undefined,
  };
}

function callbackUrl(config: ServerConfig, provider: AuthProvider, adapter: AuthProviderAdapter): string {
  if (provider === "gemini") return config.google.callbackUrl;
  return `${config.publicUrl}/api/auth/${adapter.id}/callback`;
}

function redirectPopout(
  res: Response,
  config: ServerConfig,
  query: Record<string, string | undefined>,
): void {
  const url = new URL(config.popoutUrl);
  for (const [key, value] of Object.entries(query)) {
    if (value) url.searchParams.set(key, value);
  }
  res.redirect(url.toString());
}
