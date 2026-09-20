import {
  applyMigrations,
  closeSocket,
  greetSocket,
  handleClientMessage,
  parseClientMessage,
  Store,
  type Presence,
  type PresenceSocket,
  type UserRecord,
} from "@codefriends/core";
import { openD1 } from "./d1.js";
import { configFromEnv, type WorkerEnv } from "./env.js";

function wrapDoSocket(ws: WebSocket): PresenceSocket {
  return {
    send(payload) {
      try {
        ws.send(JSON.stringify(payload));
      } catch {
        /* closed / hibernating race */
      }
    },
    get ready() {
      return true;
    },
  };
}

class HubPresence implements Presence {
  constructor(private readonly ctx: DurableObjectState) {}

  attach(): void {
    /* sockets are tagged at acceptWebSocket */
  }

  detach(userId: string): boolean {
    return this.ctx.getWebSockets(userId).length <= 1;
  }

  socketsOf(userId: string): PresenceSocket[] {
    return this.ctx.getWebSockets(userId).map(wrapDoSocket);
  }

  isConnected(userId: string): boolean {
    return this.ctx.getWebSockets(userId).length > 0;
  }

  connectedIds(): string[] {
    const ids = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const tag = this.ctx.getTags(ws)[0];
      if (tag && tag !== "pending") ids.add(tag);
    }
    return [...ids];
  }
}

export class PresenceHub implements DurableObject {
  private readonly presence: HubPresence;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: WorkerEnv,
  ) {
    this.presence = new HubPresence(ctx);
  }

  private async store(requestUrl?: string): Promise<Store> {
    const sql = openD1(this.env.DB);
    await applyMigrations(sql);
    return new Store(sql, configFromEnv(this.env, requestUrl), this.presence);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/connected") {
      return Response.json({ ids: this.presence.connectedIds() });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const token = url.searchParams.get("token") ?? "";
    const store = await this.store(request.url);
    const user = token ? await store.userByToken(token) : undefined;

    if (!user) {
      server.accept();
      server.send(JSON.stringify({ type: "error", error: "Invalid session" }));
      server.close(1008, "Invalid session");
      return new Response(null, { status: 101, webSocket: client });
    }

    this.ctx.acceptWebSocket(server, [user.id]);
    await greetSocket(store, user, wrapDoSocket(server));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const userId = this.ctx.getTags(ws)[0];
    if (!userId || userId === "pending") return;
    const store = await this.store();
    const user = await store.getUser(userId);
    if (!user) {
      wrapDoSocket(ws).send({ type: "error", error: "Unknown user" });
      ws.close(1008, "Unknown user");
      return;
    }
    const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
    try {
      const msg = parseClientMessage(raw);
      if (msg.type === "hello") {
        const again = await store.userByToken(msg.token);
        if (again && again.id === user.id) {
          await greetSocket(store, again, wrapDoSocket(ws));
        }
        return;
      }
      await handleClientMessage(store, user, msg);
    } catch (err) {
      wrapDoSocket(ws).send({
        type: "error",
        error: err instanceof Error ? err.message : "Request failed",
      });
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const userId = this.ctx.getTags(ws)[0];
    if (!userId || userId === "pending") return;
    const store = await this.store();
    await closeSocket(store, userId, wrapDoSocket(ws));
  }
}

export type { UserRecord };
