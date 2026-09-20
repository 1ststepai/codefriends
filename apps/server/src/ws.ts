import type { WebSocketServer } from "ws";
import {
  closeSocket,
  greetSocket,
  handleClientMessage,
  parseClientMessage,
  wrapJsonSocket,
  type Store,
  type UserRecord,
} from "@codefriends/core";

export function attachWs(wss: WebSocketServer, store: Store): void {
  wss.on("connection", (socket, req) => {
    let user: UserRecord | undefined;
    const query = new URL(req.url ?? "/", "http://localhost").searchParams.get("token") ?? "";
    const presenceSocket = wrapJsonSocket(
      (data) => {
        if (socket.readyState === socket.OPEN) socket.send(data);
      },
      () => socket.readyState === socket.OPEN,
    );

    const authed = async (token: string): Promise<boolean> => {
      const found = await store.userByToken(token);
      if (!found) {
        presenceSocket.send({ type: "error", error: "Invalid session" });
        socket.close();
        return false;
      }
      user = found;
      await greetSocket(store, user, presenceSocket);
      return true;
    };

    if (query) void authed(query);

    socket.on("message", (raw) => {
      void (async () => {
        let msg;
        try {
          msg = parseClientMessage(raw.toString());
        } catch (err) {
          presenceSocket.send({
            type: "error",
            error: err instanceof Error ? err.message : "Invalid JSON",
          });
          return;
        }

        if (msg.type === "hello") {
          await authed(msg.token);
          return;
        }
        if (!user) {
          presenceSocket.send({ type: "error", error: "Send hello first" });
          return;
        }
        try {
          user = await handleClientMessage(store, user, msg);
        } catch (err) {
          presenceSocket.send({
            type: "error",
            error: err instanceof Error ? err.message : "Request failed",
          });
        }
      })();
    });

    socket.on("close", () => {
      if (!user) return;
      void closeSocket(store, user.id, presenceSocket);
    });
  });
}
