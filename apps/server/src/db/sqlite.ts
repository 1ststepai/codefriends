import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { SqlClient, SqlStatement } from "@codefriends/core";

export const WRITE_WARN_MS = 50;
export const WRITE_PAGE_MS = 200;
const WRITE_RING_MS = 5 * 60 * 1000;

export interface SqliteStats {
  /** 1 for better-sqlite3. null for libSQL / D1 — there is no pool. */
  connections: number | null;
  busy: boolean;
  lastWriteMs: number | null;
  writes: { t: number; ms: number }[];
  consecutiveWarn: number;
  onWrite?: (ms: number) => void;
}

export function createSqliteStats(kind: "sqlite" | "libsql" | "d1" = "sqlite"): SqliteStats {
  return {
    connections: kind === "sqlite" ? 1 : null,
    busy: false,
    lastWriteMs: null,
    writes: [],
    consecutiveWarn: 0,
  };
}

export function writeMax5m(stats: SqliteStats, now = Date.now()): number | null {
  let max: number | null = null;
  const cutoff = now - WRITE_RING_MS;
  for (const w of stats.writes) {
    if (w.t < cutoff) continue;
    if (max === null || w.ms > max) max = w.ms;
  }
  return max;
}

export function recordSqliteWrite(stats: SqliteStats, ms: number, now = Date.now()): void {
  stats.lastWriteMs = ms;
  stats.writes.push({ t: now, ms });
  if (stats.writes.length > 512 || (stats.writes[0] && stats.writes[0].t < now - WRITE_RING_MS)) {
    stats.writes = stats.writes.filter((w) => w.t >= now - WRITE_RING_MS);
  }
  if (ms > WRITE_WARN_MS && ms <= WRITE_PAGE_MS) stats.consecutiveWarn += 1;
  else stats.consecutiveWarn = 0;
  stats.onWrite?.(ms);
}

/** Time a sync sqlite call; writes update latency, every call sets busy. */
export function withSqliteBusy<T>(stats: SqliteStats, write: boolean, fn: () => T): T {
  stats.busy = true;
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    const ms = performance.now() - t0;
    stats.busy = false;
    if (write) recordSqliteWrite(stats, ms);
  }
}

export function openBetterSqlite(path: string, stats: SqliteStats = createSqliteStats("sqlite")): SqlClient {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  return {
    kind: "sqlite",
    async exec(sql: string) {
      withSqliteBusy(stats, true, () => {
        db.exec(sql);
      });
    },
    prepare(sql: string): SqlStatement {
      const stmt = db.prepare(sql);
      return {
        async get<T>(...params: unknown[]) {
          return withSqliteBusy(stats, false, () => stmt.get(...params) as T | undefined);
        },
        async all<T>(...params: unknown[]) {
          return withSqliteBusy(stats, false, () => stmt.all(...params) as T[]);
        },
        async run(...params: unknown[]) {
          return withSqliteBusy(stats, true, () => {
            const info = stmt.run(...params);
            return { changes: info.changes };
          });
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
