import type { Env } from "../types";

export interface UsageSnapshot {
  month: string;
  storageBytes: number;
  classAOps: number;
  classBOps: number;
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

async function ensureMonthRow(env: Env, month: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO usage_counters (month, class_a_ops, class_b_ops) VALUES (?, 0, 0)
     ON CONFLICT(month) DO NOTHING`
  )
    .bind(month)
    .run();
}

export async function incrementClassAOps(env: Env, amount = 1): Promise<void> {
  const month = currentMonth();
  await ensureMonthRow(env, month);
  await env.DB.prepare("UPDATE usage_counters SET class_a_ops = class_a_ops + ? WHERE month = ?")
    .bind(amount, month)
    .run();
}

export async function incrementClassBOps(env: Env, amount = 1): Promise<void> {
  const month = currentMonth();
  await ensureMonthRow(env, month);
  await env.DB.prepare("UPDATE usage_counters SET class_b_ops = class_b_ops + ? WHERE month = ?")
    .bind(amount, month)
    .run();
}

export async function getUsageSnapshot(env: Env): Promise<UsageSnapshot> {
  const month = currentMonth();
  const [storageRow, counterRow] = await Promise.all([
    env.DB.prepare("SELECT COALESCE(SUM(storage_bytes_used), 0) AS total FROM rooms").first<{ total: number }>(),
    env.DB.prepare("SELECT class_a_ops, class_b_ops FROM usage_counters WHERE month = ?")
      .bind(month)
      .first<{ class_a_ops: number; class_b_ops: number }>(),
  ]);

  return {
    month,
    storageBytes: storageRow?.total ?? 0,
    classAOps: counterRow?.class_a_ops ?? 0,
    classBOps: counterRow?.class_b_ops ?? 0,
  };
}
