import { R2_FREE_TIER, type UsageStatus } from "../../../shared/types";
import type { UsageSnapshot } from "./usageRepo";

export function evaluateUsage(snapshot: UsageSnapshot): UsageStatus {
  const storagePct = snapshot.storageBytes / R2_FREE_TIER.STORAGE_BYTES;
  const classAPct = snapshot.classAOps / R2_FREE_TIER.CLASS_A_OPS;
  const classBPct = snapshot.classBOps / R2_FREE_TIER.CLASS_B_OPS;
  const maxPct = Math.max(storagePct, classAPct, classBPct);

  const level: UsageStatus["level"] =
    maxPct >= 1 ? "exceeded" : maxPct >= R2_FREE_TIER.WARN_THRESHOLD_PCT ? "warning" : "ok";

  return { ...snapshot, storagePct, classAPct, classBPct, level };
}
