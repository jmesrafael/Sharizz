import { Hono } from "hono";
import type { Env } from "../types";
import { getUsageSnapshot } from "../lib/usageRepo";
import { evaluateUsage } from "../lib/usage";

export const usage = new Hono<{ Bindings: Env }>();

usage.get("/", async (c) => {
  const snapshot = await getUsageSnapshot(c.env);
  return c.json(evaluateUsage(snapshot));
});
