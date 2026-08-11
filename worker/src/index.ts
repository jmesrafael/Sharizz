import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import { rooms } from "./routes/rooms";
import { files } from "./routes/files";
import { runCleanup } from "./cron/cleanup";

const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 600,
  })
);

app.get("/api/health", (c) => c.json({ ok: true }));

app.route("/api/rooms", rooms);
app.route("/api/rooms", files);

app.notFound((c) => c.json({ error: "Not found.", code: "ROOM_NOT_FOUND" }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Something went wrong.", code: "INTERNAL_ERROR" }, 500);
});

export { app };

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runCleanup(env));
  },
};
