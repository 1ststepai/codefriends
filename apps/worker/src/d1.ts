import type { SqlClient, SqlStatement } from "@codefriends/core";

export function openD1(db: D1Database): SqlClient {
  return {
    kind: "d1",
    async exec(sql: string) {
      await db.exec(sql);
    },
    prepare(sql: string): SqlStatement {
      return {
        async get<T>(...params: unknown[]) {
          return (await db.prepare(sql).bind(...params).first<T>()) ?? undefined;
        },
        async all<T>(...params: unknown[]) {
          const result = await db.prepare(sql).bind(...params).all<T>();
          return result.results ?? [];
        },
        async run(...params: unknown[]) {
          const result = await db.prepare(sql).bind(...params).run();
          return { changes: result.meta.changes ?? 0 };
        },
      };
    },
  };
}
