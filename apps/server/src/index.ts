import { startServer } from "./app.js";

const server = await startServer();
console.log(`CodeFriends server ${server.url}`);
console.log(`Store: ${server.config.storeKind}${server.config.libsqlUrl ? ` (${server.config.libsqlUrl})` : ` (${server.config.dbPath})`}`);
console.log(`DM history cap: ${server.config.dmHistoryLimit} msgs/thread`);
console.log(`Dev username login: ${server.config.devLogin ? "on" : "off"}`);
console.log(`Mock providers: ${server.config.mockProviders ? "on" : "off"}`);
console.log(`Gemini/Google OAuth: ${server.config.google.clientId ? "configured" : "unconfigured"}`);
console.log(
  server.config.servePopout
    ? `Popout static: ${server.config.popoutDir}`
    : "Popout static: off (build apps/popout, or set CODEFRIENDS_POPOUT_DIR to a folder with index.html)",
);
console.log("Demo users (already friends): maya, devjay, sam, rio, alex, casey, taylor, jordan, parker");

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
