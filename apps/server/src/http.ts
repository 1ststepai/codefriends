import type { Express, Request, Response } from "express";
import type { Store } from "./store.js";

function bearer(req: Request): string | undefined {
  const header = req.header("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1];
}

function requireUser(store: Store, req: Request, res: Response) {
  const user = store.userByToken(bearer(req));
  if (!user) {
    res.status(401).json({ error: "Sign in first" });
    return undefined;
  }
  return user;
}

export function attachHttp(app: Express, store: Store): void {
  app.get("/health", (_req, res) => {
    res.json({ ok: true, name: "codefriends", onlineCount: store.onlineCount() });
  });

  app.post("/api/auth/login", (req, res) => {
    try {
      const username = String(req.body?.username ?? "");
      const displayName = req.body?.displayName ? String(req.body.displayName) : undefined;
      const { user, token } = store.login(username, displayName);
      res.json({ token, user: store.toPublic(user) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Login failed" });
    }
  });

  app.get("/api/me", (req, res) => {
    const user = requireUser(store, req, res);
    if (!user) return;
    res.json({ user: store.toPublic(user), friends: store.friendList(user.id) });
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
