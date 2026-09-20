import type { WebSocketServer } from "ws";
import type { WsClientMessage } from "@codefriends/shared";
import { broadcastPresence, pushFriends, send, sendToUser } from "./broadcast.js";
import type { Store, UserRecord } from "./store.js";

const MAX_MESSAGE_BYTES = 8_192;

export function attachWs(wss: WebSocketServer, store: Store): void {
  wss.on("connection", (socket, req) => {
    let user: UserRecord | undefined;
    const query = new URL(req.url ?? "/", "http://localhost").searchParams.get("token") ?? "";

    const authed = (token: string): boolean => {
      const found = store.userByToken(token);
      if (!found) {
        send(socket, { type: "error", error: "Invalid session" });
        socket.close();
        return false;
      }
      user = found;
      store.attachSocket(user.id, socket);
      send(socket, {
        type: "hello_ok",
        self: store.toPublic(user, { identities: true }),
        friends: store.friendList(user.id),
        messages: store.messagesFor(user.id),
      });
      broadcastPresence(store, user.id);
      return true;
    };

    if (query) authed(query);

    socket.on("message", (raw) => {
      if (Buffer.byteLength(raw.toString()) > MAX_MESSAGE_BYTES) {
        send(socket, { type: "error", error: "Payload too large" });
        return;
      }
      let msg: WsClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as WsClientMessage;
      } catch {
        send(socket, { type: "error", error: "Invalid JSON" });
        return;
      }

      if (msg.type === "hello") {
        authed(msg.token);
        return;
      }
      if (!user) {
        send(socket, { type: "error", error: "Send hello first" });
        return;
      }

      try {
        handle(store, user, msg);
      } catch (err) {
        send(socket, {
          type: "error",
          error: err instanceof Error ? err.message : "Request failed",
        });
      }
    });

    socket.on("close", () => {
      if (!user) return;
      const wentOffline = store.detachSocket(user.id, socket);
      if (wentOffline) broadcastPresence(store, user.id);
    });
  });
}

function handle(store: Store, user: UserRecord, msg: WsClientMessage): void {
  switch (msg.type) {
    case "presence": {
      store.updatePresence(user.id, {
        status: msg.status,
        statusText: msg.statusText,
        client: msg.client,
      });
      Object.assign(user, store.getUser(user.id));
      broadcastPresence(store, user.id);
      return;
    }
    case "add_friend": {
      store.addFriend(user.id, msg.username);
      pushFriends(store, user.id);
      const target = store.userByName(msg.username);
      if (target) {
        pushFriends(store, target.id);
        broadcastPresence(store, user.id);
        broadcastPresence(store, target.id);
      }
      return;
    }
    case "dm": {
      const message = store.addMessage(user.id, msg.to, msg.text);
      sendToUser(store, user.id, { type: "dm", message });
      sendToUser(store, msg.to, { type: "dm", message });
      return;
    }
    case "typing": {
      if (!store.areFriends(user.id, msg.to)) return;
      sendToUser(store, msg.to, { type: "typing", from: user.id, typing: msg.typing });
      return;
    }
    default:
      return;
  }
}
