import { startServer } from "./app.js";

const server = await startServer();
console.log(`CodeFriends server ${server.url}`);
console.log(`SQLite: ${server.config.dbPath}`);
console.log(`Dev username login: ${server.config.devLogin ? "on" : "off"}`);
console.log(`Mock providers: ${server.config.mockProviders ? "on" : "off"}`);
console.log(`Gemini/Google OAuth: ${server.config.google.clientId ? "configured" : "unconfigured"}`);
console.log("Demo users (already friends): maya, devjay, sam, rio, alex, casey, taylor, jordan, parker");

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
