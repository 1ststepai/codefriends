/**
 * Tauri's WebView loads the existing Vite popout. Fail fast with a
 * useful hint if `npm run dev` (or a packaged popout origin) is down.
 */
const url = (process.env.CODEFRIENDS_POPOUT_URL || "http://127.0.0.1:5173").replace(/\/$/, "");
const maxMs = Number(process.env.CODEFRIENDS_POPOUT_WAIT_MS || 60_000);
const started = Date.now();

while (Date.now() - started < maxMs) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    if (res.ok || res.status === 404) {
      console.log(`CodeFriends popout is reachable at ${url}`);
      process.exit(0);
    }
  } catch {
    /* keep waiting */
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

console.error(`CodeFriends desktop: nothing is listening at ${url}.

Start the web stack first:

  npm run dev

Then in another terminal:

  npm run desktop

Or start the server, popout, and native window together:

  npm run dev:desktop
`);
process.exit(1);
