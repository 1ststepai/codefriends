import { createClient, type Client } from "@libsql/client";
import type { SqlClient, SqlStatement } from "@codefriends/core";

export function openLibsql(url: string, authToken?: string): SqlClient {
  const client: Client = createClient({ url, authToken });
  return {
    kind: "libsql",
    async exec(sql: string) {
      await client.executeMultiple(sql);
    },
    prepare(sql: string): SqlStatement {
      return {
        async get<T>(...params: unknown[]) {
          const rs = await client.execute({ sql, args: params as Array<string | number | null> });
          return (rs.rows[0] as T | undefined) ?? undefined;
        },
        async all<T>(...params: unknown[]) {
          const rs = await client.execute({ sql, args: params as Array<string | number | null> });
          return rs.rows as unknown as T[];
        },
        async run(...params: unknown[]) {
          const rs = await client.execute({ sql, args: params as Array<string | number | null> });
          return { changes: rs.rowsAffected };
        },
      };
    },
    close() {
      client.close();
    },
  };
}
