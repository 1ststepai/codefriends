export interface SqlStatement {
  get<T>(...params: unknown[]): Promise<T | undefined>;
  all<T>(...params: unknown[]): Promise<T[]>;
  run(...params: unknown[]): Promise<{ changes: number }>;
}

export interface SqlClient {
  readonly kind: "sqlite" | "libsql" | "d1";
  exec(sql: string): Promise<void>;
  prepare(sql: string): SqlStatement;
  close?(): void | Promise<void>;
}

export async function applyMigrations(db: SqlClient): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL
    );
  `);

  const applied = new Set(
    (await db.prepare("SELECT name FROM schema_migrations").all<{ name: string }>()).map((row) => row.name),
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;
    await db.exec(migration.sql);
    await db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(
      migration.name,
      Date.now(),
    );
  }
}

const MIGRATIONS: Array<{ name: string; sql: string }> = [
  {
    name: "001_init",
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        status TEXT NOT NULL,
        status_text TEXT NOT NULL,
        client TEXT NOT NULL,
        last_seen INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS identities (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        subject TEXT NOT NULL,
        email TEXT,
        display_name TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE (provider, subject)
      );
      CREATE INDEX IF NOT EXISTS identities_user_id ON identities(user_id);

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);

      CREATE TABLE IF NOT EXISTS friends (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, friend_id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_pair_created ON messages(from_id, to_id, created_at);

      CREATE TABLE IF NOT EXISTS oauth_states (
        state TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        code_verifier TEXT,
        link_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        client TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS handoffs (
        code_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `,
  },
  {
    name: "002_dm_thread_cap",
    sql: `
      ALTER TABLE messages ADD COLUMN thread_key TEXT NOT NULL DEFAULT '';

      UPDATE messages SET thread_key = CASE
        WHEN from_id < to_id THEN from_id || ':' || to_id
        ELSE to_id || ':' || from_id
      END
      WHERE thread_key = '' OR thread_key IS NULL;

      CREATE INDEX IF NOT EXISTS messages_thread_created ON messages(thread_key, created_at);
    `,
  },
];
