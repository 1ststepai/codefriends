import { createServer, type Server } from "node:http";
import cors from "cors";
import express from "express";
import { WebSocketServer } from "ws";
import { attachHttp } from "./http.js";
import { seedDemo } from "./seed.js";
import { Store } from "./store.js";
import { attachWs } from "./ws.js";

export interface CodeFriendsServer {
  store: Store;
  http: Server;
  url: string;
  close: () => Promise<void>;
}

export async function startServer(opts?: {
  port?: number;
  seed?: boolean;
  host?: string;
}): Promise<CodeFriendsServer> {
  const store = new Store();
  if (opts?.seed ?? process.env.CODEFRIENDS_SEED !== "0") {
    seedDemo(store);
  }

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "32kb" }));
  attachHttp(app, store);

  const http = createServer(app);
  const wss = new WebSocketServer({ server: http, path: "/ws" });
  attachWs(wss, store);

  const host = opts?.host ?? process.env.HOST ?? "127.0.0.1";
  const port = opts?.port ?? Number(process.env.PORT ?? 8787);

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(port, host, () => resolve());
  });

  const address = http.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const url = `http://${host}:${actualPort}`;

  return {
    store,
    http,
    url,
    close: () =>
      new Promise((resolve, reject) => {
        wss.close((err) => {
          if (err) reject(err);
          http.close((httpErr) => (httpErr ? reject(httpErr) : resolve()));
        });
      }),
  };
}
