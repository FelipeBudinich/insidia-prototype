import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { Security } from "./security/crypto.js";
import {
  PostgresRepository,
  MemoryRepository,
} from "./persistence/repository.js";
import { GameService } from "./application/service.js";
import { createHttp } from "./transport/http.js";
import { TrustedClock } from "./security/clock.js";
const production = process.env.NODE_ENV === "production";
if (
  production &&
  (!process.env.DATABASE_URL ||
    !process.env.APP_SECRET ||
    !process.env.PUBLIC_ORIGIN)
)
  throw new Error(
    "Supabase DATABASE_URL, APP_SECRET and PUBLIC_ORIGIN are required",
  );
let key = process.env.APP_SECRET
  ? Buffer.from(process.env.APP_SECRET, "base64")
  : undefined;
if (!key) {
  mkdirSync(".data", { recursive: true });
  if (existsSync(".data/development-key"))
    key = readFileSync(".data/development-key");
  else {
    key = randomBytes(32);
    writeFileSync(".data/development-key", key, { mode: 0o600 });
  }
}
const security = new Security(key),
  repo = process.env.DATABASE_URL
    ? new PostgresRepository(process.env.DATABASE_URL, security)
    : new MemoryRepository();
const clock = new TrustedClock();
if (repo instanceof PostgresRepository)
  clock.anchorTo(await repo.databaseTime());
const service = new GameService(
  repo,
  security,
  repo instanceof PostgresRepository
    ? security.environment(clock.now)
    : undefined,
);
const port = Number(process.env.PORT ?? 3000),
  http = createHttp(service, {
    production,
    origin: process.env.PUBLIC_ORIGIN ?? `http://localhost:${port}`,
  });
http.server.listen(port, "0.0.0.0", () =>
  console.log(`Insidia listening on port ${port}`),
);
service.on("fatal", () => {
  console.error("Service unavailable; terminating fenced owner.");
  setTimeout(() => process.exit(1), 100).unref();
});
try {
  await service.initialize();
  console.log("Insidia ready.");
} catch (e) {
  console.error("Recovery failed:", e instanceof Error ? e.message : "unknown");
  await http.close();
  process.exit(1);
}
if (repo instanceof PostgresRepository)
  setInterval(() => {
    void service.enqueue(async () => clock.check(await repo.databaseTime()));
  }, 30000).unref();
let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  service.ready = false;
  await http.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
