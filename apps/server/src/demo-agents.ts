/**
 * Holds WebSocket sessions for the seed agent roster so a single popout
 * login looks like the concept mockup (Agents online).
 *
 *   npm run demo:agents -w @codefriends/server
 */
import { WebSocket } from "ws";

const BASE = process.env.CODEFRIENDS_URL ?? "http://127.0.0.1:8787";
const AGENTS = ["devjay", "sam", "rio"] as const;

async function hold(username: string) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username }),
  });
  if (!res.ok) throw new Error(`login ${username} failed: ${res.status}`);
  const { token } = (await res.json()) as { token: string };
  const ws = new WebSocket(BASE.replace(/^http/, "ws") + `/ws?token=${token}`);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  ws.on("close", () => {
    console.log(`${username} dropped — reconnecting`);
    setTimeout(() => void hold(username), 1000);
  });
  console.log(`${username} online`);
}

await Promise.all(AGENTS.map(hold));
console.log(`demo agents held against ${BASE} (Ctrl+C to drop)`);
