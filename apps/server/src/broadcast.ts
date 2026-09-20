import type { WsServerMessage } from "@codefriends/shared";
import type { Store } from "./store.js";

export function send(socket: import("ws").WebSocket, payload: WsServerMessage): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

export function sendToUser(store: Store, userId: string, payload: WsServerMessage): void {
  for (const socket of store.socketsOf(userId)) send(socket, payload);
}

export function broadcastPresence(store: Store, userId: string): void {
  const user = store.getUser(userId);
  if (!user) return;
  const snapshot = store.toPublic(user);
  const payload: WsServerMessage = { type: "presence", user: snapshot };
  sendToUser(store, userId, payload);
  for (const friendId of store.friendIds(userId)) {
    sendToUser(store, friendId, payload);
  }
  const count: WsServerMessage = { type: "online_count", count: store.onlineCount() };
  for (const id of store.allUserIds()) {
    sendToUser(store, id, count);
  }
}

export function pushFriends(store: Store, userId: string): void {
  sendToUser(store, userId, { type: "friends", friends: store.friendList(userId) });
}
