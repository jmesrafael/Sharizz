import { handle } from "hono/cloudflare-pages";
import { app } from "../../../worker/src/index";

// Cloudflare Pages Functions catch-all for everything under /api/*. The
// Hono app is the same one used by the standalone cron worker (see
// worker/src/index.ts) — its routes already carry the "/api/..." prefix,
// and Pages Functions hand this app the untouched request/env/executionCtx,
// so no path rewriting is needed.
export const onRequest = handle(app);
