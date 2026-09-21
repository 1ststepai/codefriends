import {
  applyMigrations,
  handleHttp,
  seedDemo,
  seedOfficialLibrary,
  SnapshotPresence,
  Store,
} from "@codefriends/core";
import { openD1 } from "./d1.js";
import { configFromEnv, type WorkerEnv } from "./env.js";
import { PresenceHub } from "./hub.js";

export { PresenceHub };

let boot: Promise<void> | undefined;

async function ensureReady(env: WorkerEnv, requestUrl: string): Promise<void> {
  if (!boot) {
    boot = (async () => {
      const sql = openD1(env.DB);
      await applyMigrations(sql);
      const store = new Store(sql, configFromEnv(env, requestUrl), new SnapshotPresence(new Set()));
      await seedOfficialLibrary(store);
      if (env.CODEFRIENDS_SEED !== "0") {
        await seedDemo(store);
      }
    })().catch((err) => {
      boot = undefined;
      throw err;
    });
  }
  await boot;
}

async function connectedIds(env: WorkerEnv): Promise<string[]> {
  try {
    const stub = env.HUB.get(env.HUB.idFromName("global"));
    const res = await stub.fetch("https://hub/connected");
    const data = (await res.json()) as { ids?: string[] };
    return data.ids ?? [];
  } catch {
    return [];
  }
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      return env.HUB.get(env.HUB.idFromName("global")).fetch(request);
    }
    await ensureReady(env, request.url);
    const config = configFromEnv(env, request.url);
    const store = new Store(
      openD1(env.DB),
      config,
      new SnapshotPresence(new Set(await connectedIds(env))),
    );
    return handleHttp(request, { store, config });
  },
};
