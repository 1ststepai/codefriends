import type { WsServerMessage } from "@codefriends/shared";
import type { Store } from "./store.js";

export function sendToUser(store: Store, userId: string, payload: WsServerMessage): void {
  for (const socket of store.presence.socketsOf(userId)) {
    if (socket.ready) socket.send(payload);
  }
}

export async function broadcastPresence(store: Store, userId: string): Promise<void> {
  const user = await store.getUser(userId);
  if (!user) return;
  const snapshot = await store.toPublic(user);
  const payload: WsServerMessage = { type: "presence", user: snapshot };
  sendToUser(store, userId, payload);
  for (const friendId of await store.friendIds(userId)) {
    sendToUser(store, friendId, payload);
  }
  const count: WsServerMessage = { type: "online_count", count: await store.onlineCount() };
  for (const id of store.presence.connectedIds()) {
    sendToUser(store, id, count);
  }
}

export async function pushFriends(store: Store, userId: string): Promise<void> {
  sendToUser(store, userId, { type: "friends", friends: await store.friendList(userId) });
}
