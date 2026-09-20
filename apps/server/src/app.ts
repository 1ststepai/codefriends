import { createServer, type Server } from "node:http";
import { join } from "node:path";
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
import { isApiHttpPath, loadConfig, type ServerConfig } from "./config.js";
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
    if (config.servePopout && !isApiHttpPath(req.path)) {
      next();
      return;
    }
    try {
      const response = await handleHttp(expressToFetch(req), { store, config });
      await sendFetchResponse(res, response);
    } catch (err) {
      next(err);
    }
  });

  if (config.servePopout) {
    app.use(express.static(config.popoutDir, { fallthrough: true }));
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        next();
        return;
      }
      if (isApiHttpPath(req.path) || req.path === "/ws") {
        next();
        return;
      }
      res.sendFile(join(config.popoutDir, "index.html"));
    });
  }

  const http = createServer(app);
  const wss = new WebSocketServer({ server: http, path: "/ws" });
  const sockets = attachWs(wss, store);

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
    close: async () => {
      for (const client of wss.clients) {
        client.terminate();
      }
      await new Promise<void>((resolve, reject) => {
        wss.close((err) => (err ? reject(err) : resolve()));
      });
      await sockets.drain();
      await new Promise<void>((resolve, reject) => {
        http.close((err) => (err ? reject(err) : resolve()));
        http.closeAllConnections?.();
      });
      await Promise.resolve(db.close?.());
    },
  };
}
