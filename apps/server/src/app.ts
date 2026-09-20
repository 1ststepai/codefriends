import { createServer, type Server } from "node:http";
import cors from "cors";
import express from "express";
import { WebSocketServer } from "ws";
import {
  applyMigrations,
  handleHttp,
  MemoryPresence,
  seedDemo,
  Store,
  type RuntimeConfig,
  type SqlClient,
} from "@codefriends/core";
import { loadConfig, type ServerConfig } from "./config.js";
import { openLibsql } from "./db/libsql.js";
import { openBetterSqlite } from "./db/sqlite.js";
import { expressToFetch, sendFetchResponse } from "./express-fetch.js";
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
  config?: Partial<ServerConfig & RuntimeConfig>;
}): Promise<CodeFriendsServer> {
  const config = loadConfig({
    ...opts?.config,
    dbPath: opts?.dbPath ?? opts?.config?.dbPath,
    port: opts?.port,
    host: opts?.host,
  });

  const db: SqlClient = config.libsqlUrl
    ? openLibsql(config.libsqlUrl, config.libsqlAuthToken || undefined)
    : openBetterSqlite(config.dbPath);
  await applyMigrations(db);
  const store = new Store(db, config, new MemoryPresence());

  if (opts?.seed ?? process.env.CODEFRIENDS_SEED !== "0") {
    await seedDemo(store);
  }

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "32kb" }));
  app.use(async (req, res, next) => {
    try {
      const response = await handleHttp(expressToFetch(req), { store, config });
      await sendFetchResponse(res, response);
    } catch (err) {
      next(err);
    }
  });

  const http = createServer(app);
  const wss = new WebSocketServer({ server: http, path: "/ws" });
  attachWs(wss, store);

  const host = opts?.host ?? config.host;
  const port = opts?.port ?? config.port;

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(port, host, () => resolve());
  });

  const address = http.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const shownHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  const url = `http://${shownHost}:${actualPort}`;
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
            void Promise.resolve(db.close?.()).finally(() => {
              if (httpErr) reject(httpErr);
              else resolve();
            });
          });
        });
      }),
  };
}
