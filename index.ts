import { app } from "./src/server";
import { env } from "./src/config/env";

Bun.serve({
  port: env.port,
  hostname: env.host,
  fetch: app.fetch,
});

console.log(`signoff orchestrator listening on http://${env.host}:${env.port}`);
