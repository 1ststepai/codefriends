import { startServer } from "./app.js";

const server = await startServer();
console.log(`CodeFriends server ${server.url}`);
console.log("Auth: POST /api/auth/login { username }  (creates the user if new)");
console.log("Demo users (already friends): maya, devjay, sam, rio, alex, casey, taylor, jordan, parker");

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
