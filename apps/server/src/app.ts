import { createServer, type Server } from "node:http";
import cors from "cors";
import express from "express";
import { WebSocketServer } from "ws";
import { attachHttp } from "./http.js";
import { loadConfig, type ServerConfig } from "./config.js";
import { applyMigrations, openSqlite, type SqliteDb } from "./db/sqlite.js";
import { seedDemo } from "./seed.js";
import { Store } from "./store.js";
import { attachWs } from "./ws.js";

export interface CodeFriendsServer {
  store: Store;
  config: ServerConfig;
  http: Server;
  url: string;
  close: () => Promise<void>;
}

export async function startServer(opts?: {
  port?: number;
  seed?: boolean;
  host?: string;
  dbPath?: string;
  config?: Partial<ServerConfig>;
}): Promise<CodeFriendsServer> {
  const config = loadConfig({
    ...opts?.config,
    dbPath: opts?.dbPath ?? opts?.config?.dbPath,
    port: opts?.port,
    host: opts?.host,
  });

  const db: SqliteDb = openSqlite(config.dbPath);
  applyMigrations(db);
  const store = new Store(db, config);

  if (opts?.seed ?? process.env.CODEFRIENDS_SEED !== "0") {
    seedDemo(store);
  }

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "32kb" }));
  attachHttp(app, store, config);

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
  config.publicUrl = process.env.CODEFRIENDS_PUBLIC_URL?.replace(/\/$/, "") ?? url;

  return {
    store,
    config,
    http,
    url,
    close: () =>
      new Promise((resolve, reject) => {
        wss.close((err) => {
          if (err) reject(err);
          http.close((httpErr) => {
            db.close();
            if (httpErr) reject(httpErr);
            else resolve();
          });
        });
      }),
  };
}
