import type { WsClientMessage } from "@codefriends/shared";
import { broadcastPresence, pushFriends, sendToUser } from "./broadcast.js";
import type { PresenceSocket } from "./presence.js";
import type { Store, UserRecord } from "./store.js";

export const MAX_WS_MESSAGE_BYTES = 8_192;

export async function greetSocket(store: Store, user: UserRecord, socket: PresenceSocket): Promise<void> {
  store.presence.attach(user.id, socket);
  socket.send({
    type: "hello_ok",
    self: await store.toPublic(user, { identities: true }),
    friends: await store.friendList(user.id),
    messages: await store.messagesFor(user.id),
  });
  await broadcastPresence(store, user.id);
}

export async function closeSocket(store: Store, userId: string, socket: PresenceSocket): Promise<void> {
  const wentOffline = store.presence.detach(userId, socket);
  if (!wentOffline) return;
  try {
    const user = await store.getUser(userId);
    if (user) {
      user.lastSeen = Date.now();
      await store.persistUser(user);
    }
    await broadcastPresence(store, userId);
  } catch {
    /* DB may already be closed during process shutdown */
  }
}

export function parseClientMessage(raw: string): WsClientMessage {
  if (byteLength(raw) > MAX_WS_MESSAGE_BYTES) {
    throw new Error("Payload too large");
  }
  return JSON.parse(raw) as WsClientMessage;
}

export async function handleClientMessage(
  store: Store,
  user: UserRecord,
  msg: WsClientMessage,
): Promise<UserRecord> {
  switch (msg.type) {
    case "hello":
      return user;
    case "presence": {
      const updated = await store.updatePresence(user.id, {
        status: msg.status,
        statusText: msg.statusText,
        client: msg.client,
      });
      await broadcastPresence(store, user.id);
      return updated;
    }
    case "add_friend": {
      const requestRow = await store.requestFriend(user.id, msg.username);
      if (requestRow.status === "accepted") {
        await pushFriends(store, user.id);
        const target = await store.userByName(msg.username);
        if (target) {
          await pushFriends(store, target.id);
          await broadcastPresence(store, user.id);
          await broadcastPresence(store, target.id);
        }
      }
      return user;
    }
    case "dm": {
      const message = await store.addMessage(user.id, msg.to, msg.text);
      sendToUser(store, user.id, { type: "dm", message });
      sendToUser(store, msg.to, { type: "dm", message });
      return user;
    }
    case "typing": {
      if (await store.areFriends(user.id, msg.to)) {
        sendToUser(store, msg.to, { type: "typing", from: user.id, typing: msg.typing });
      }
      return user;
    }
    default:
      return user;
  }
}

function byteLength(raw: string): number {
  return new TextEncoder().encode(raw).length;
}
