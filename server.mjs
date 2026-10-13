// Static server for Claude Code Wrapped.
// Usage: npm start   (PORT and HOST env vars override the defaults)

import { createSiteServer } from "./lib/site-server.mjs";

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || "127.0.0.1";

createSiteServer({ log: (line) => console.log(line) }).listen(PORT, HOST, () => {
  console.log(`wrapped: http://${HOST}:${PORT}/`);
});
