import { applyD1Migrations, env } from "cloudflare:test";

// @ts-expect-error — injected by vitest-pool-workers config
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS ?? []);
