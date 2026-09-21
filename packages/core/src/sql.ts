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
  {
    name: "003_invites",
    sql: `
      CREATE TABLE IF NOT EXISTS invites (
        token_hash TEXT PRIMARY KEY,
        created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS invites_created_by ON invites(created_by);
      CREATE INDEX IF NOT EXISTS invites_expires_at ON invites(expires_at);
    `,
  },
  {
    name: "004_profile",
    sql: `
      ALTER TABLE users ADD COLUMN github_url TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN website TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN tools TEXT NOT NULL DEFAULT '';
    `,
  },
  {
    name: "005_school_board",
    sql: `
      CREATE TABLE IF NOT EXISTS topics (
        id TEXT PRIMARY KEY,
        author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS topics_created_at ON topics(created_at);

      CREATE TABLE IF NOT EXISTS topic_replies (
        id TEXT PRIMARY KEY,
        topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
        author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS topic_replies_topic_created ON topic_replies(topic_id, created_at);
    `,
  },
  {
    name: "006_socials",
    sql: `
      ALTER TABLE users ADD COLUMN twitter_url TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN facebook_url TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN telegram_url TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN whatsapp_url TEXT NOT NULL DEFAULT '';
    `,
  },
  {
    name: "007_builder_profile",
    sql: `
      ALTER TABLE users ADD COLUMN currently_building TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN owns_business INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN business_note TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN wants_to_help_others_build INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    name: "008_library",
    sql: `
      CREATE TABLE IF NOT EXISTS library_items (
        id TEXT PRIMARY KEY,
        author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        url TEXT NOT NULL,
        kind TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS library_items_source_created ON library_items(source, created_at);
    `,
  },
  {
    name: "009_launch_packs",
    sql: `
      CREATE TABLE IF NOT EXISTS launch_packs (
        id TEXT PRIMARY KEY,
        library_item_id TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        show_hn_title TEXT NOT NULL,
        show_hn_body TEXT NOT NULL,
        reddit_title TEXT NOT NULL,
        reddit_body TEXT NOT NULL,
        social_short TEXT NOT NULL,
        social_long TEXT NOT NULL,
        friend_blurb TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (library_item_id, user_id)
      );
    `,
  },
];
