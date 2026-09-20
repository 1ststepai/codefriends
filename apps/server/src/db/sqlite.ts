import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { SqlClient, SqlStatement } from "@codefriends/core";

export function openBetterSqlite(path: string): SqlClient {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  return {
    kind: "sqlite",
    async exec(sql: string) {
      db.exec(sql);
    },
    prepare(sql: string): SqlStatement {
      const stmt = db.prepare(sql);
      return {
        async get<T>(...params: unknown[]) {
          return stmt.get(...params) as T | undefined;
        },
        async all<T>(...params: unknown[]) {
          return stmt.all(...params) as T[];
        },
        async run(...params: unknown[]) {
          const info = stmt.run(...params);
          return { changes: info.changes };
        },
      };
    },
    close() {
      db.close();
    },
  };
}

/** @deprecated use openBetterSqlite */
export const openSqlite = openBetterSqlite;
