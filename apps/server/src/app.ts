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
  seedOfficialLibrary,
  Store,
  type RuntimeConfig,
  type SqlClient,
} from "@codefriends/core";
import { isApiHttpPath, loadConfig, type ServerConfig } from "./config.js";
import { openLibsql } from "./db/libsql.js";
import { createSqliteStats, openBetterSqlite, type SqliteStats } from "./db/sqlite.js";
import { expressToFetch, sendFetchResponse } from "./express-fetch.js";
import { createMonitor, sanitizeMonitorMessage, type Monitor } from "./monitor.js";
import { attachWs } from "./ws.js";

export interface CodeFriendsServer {
  store: Store;
  config: ServerConfig;
  http: Server;
  url: string;
  monitor: Monitor;
  sqliteStats: SqliteStats;
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

  const sqliteStats = createSqliteStats(config.libsqlUrl ? "libsql" : "sqlite");
  const db: SqlClient = config.libsqlUrl
    ? openLibsql(config.libsqlUrl, config.libsqlAuthToken || undefined)
    : openBetterSqlite(config.dbPath, sqliteStats);
  await applyMigrations(db);
  const store = new Store(db, config, new MemoryPresence());

  await seedOfficialLibrary(store);
  if (opts?.seed ?? process.env.CODEFRIENDS_SEED !== "0") {
    await seedDemo(store);
  }

  let wss: WebSocketServer | undefined;
  const monitor = createMonitor({
    config,
    sqlite: sqliteStats,
    onlineCount: () => store.onlineCount(),
    wsClients: () => wss?.clients.size ?? 0,
  });

  const app = express();
  app.use(express.json({ limit: "32kb" }));
  app.use(express.urlencoded({ extended: false, limit: "4kb" }));
  app.use((req, res, next) => {
    const t0 = performance.now();
    res.on("finish", () => {
      monitor.recordHttp(req.path, res.statusCode, performance.now() - t0);
    });
    next();
  });
  app.use(async (req, res, next) => {
    try {
      if (await monitor.handle(req, res)) return;
    } catch (err) {
      next(err);
      return;
    }
    next();
  });
  app.use(cors());
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

  app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : "Request failed";
    monitor.recordError(req.path, message);
    if (res.headersSent) {
      next(err);
      return;
    }
    res.status(500).type("json").send(JSON.stringify({ error: sanitizeMonitorMessage(message) }));
  });

  const http = createServer(app);
  const wsHub = new WebSocketServer({ server: http, path: "/ws" });
  wss = wsHub;
  const sockets = attachWs(wsHub, store);

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
  monitor.start(`http://${shownHost}:${actualPort}`, () => http.listening);

  return {
    store,
    config,
    http,
    url,
    monitor,
    sqliteStats,
    close: async () => {
      monitor.stop();
      for (const client of wsHub.clients) {
        client.terminate();
      }
      await new Promise<void>((resolve, reject) => {
        wsHub.close((err) => (err ? reject(err) : resolve()));
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
