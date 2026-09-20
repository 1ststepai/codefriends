import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

export type SqliteDb = InstanceType<typeof Database>;

export function openSqlite(path: string): SqliteDb {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export function applyMigrations(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL
    );
  `);

  const applied = new Set(
    db.prepare("SELECT name FROM schema_migrations").all().map((row) => (row as { name: string }).name),
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(
        migration.name,
        Date.now(),
      );
    })();
  }
}

const MIGRATIONS: Array<{ name: string; sql: string }> = [
  {
    name: "001_init",
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        status TEXT NOT NULL,
        status_text TEXT NOT NULL,
        client TEXT NOT NULL,
        last_seen INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE identities (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        subject TEXT NOT NULL,
        email TEXT,
        display_name TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE (provider, subject)
      );
      CREATE INDEX identities_user_id ON identities(user_id);

      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX sessions_user_id ON sessions(user_id);
      CREATE INDEX sessions_expires_at ON sessions(expires_at);

      CREATE TABLE friends (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, friend_id)
      );

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX messages_pair_created ON messages(from_id, to_id, created_at);

      CREATE TABLE oauth_states (
        state TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        code_verifier TEXT,
        link_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        client TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE handoffs (
        code_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `,
  },
];
