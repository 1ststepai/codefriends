import type { Express, Request, Response } from "express";
import { attachAuth, bearer } from "./auth/http.js";
import type { ServerConfig } from "./config.js";
import type { Store } from "./store.js";

function requireUser(store: Store, req: Request, res: Response) {
  const user = store.userByToken(bearer(req));
  if (!user) {
    res.status(401).json({ error: "Sign in first" });
    return undefined;
  }
  return user;
}

export function attachHttp(app: Express, store: Store, config: ServerConfig): void {
  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      name: "codefriends",
      onlineCount: store.onlineCount(),
      store: "sqlite",
    });
  });

  attachAuth(app, store, config);

  app.get("/api/me", (req, res) => {
    const user = requireUser(store, req, res);
    if (!user) return;
    res.json({
      user: store.toPublic(user, { identities: true }),
      friends: store.friendList(user.id),
      identities: store.identitiesOf(user.id),
    });
  });

  app.get("/api/friends", (req, res) => {
    const user = requireUser(store, req, res);
    if (!user) return;
    res.json({ friends: store.friendList(user.id) });
  });

  app.post("/api/friends", (req, res) => {
    const user = requireUser(store, req, res);
    if (!user) return;
    try {
      const friend = store.addFriend(user.id, String(req.body?.username ?? ""));
      res.json({ friend, friends: store.friendList(user.id) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Could not add friend" });
    }
  });

  app.get("/api/messages", (req, res) => {
    const user = requireUser(store, req, res);
    if (!user) return;
    const withId = String(req.query.with ?? "");
    const all = store.messagesFor(user.id);
    res.json({
      messages: withId
        ? all.filter((m) => m.from === withId || m.to === withId)
        : all,
    });
  });

  app.get("/api/presence", (_req, res) => {
    res.json({
      onlineCount: store.onlineCount(),
      online: store.onlineUsers(),
    });
  });
}
