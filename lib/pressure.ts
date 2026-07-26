import { CaseloadCurve } from "./types";

// Constant assumptions behind the surge index; these become configurable
// per-condition in later phases, but a single fixed value is enough for
// the Phase 1 "simple fixed arrival rate" requirement.
export const THROUGHPUT_PER_ASSESSOR = 3; // cases/tick one assessor can nominally handle
export const CASES_PER_TICK = 2; // one matched pair arrives per tick

export function arrivalRate(tick: number, curve: CaseloadCurve, baseRate = CASES_PER_TICK, slope = 0.2) {
  if (curve === "flat") return baseRate;
  return baseRate + slope * tick;
}

export function surgeIndex(tick: number, curve: CaseloadCurve, assessorCount: number) {
  const capacity = Math.max(assessorCount, 1) * THROUGHPUT_PER_ASSESSOR;
  const loadRatio = arrivalRate(tick, curve) / capacity;
  return Math.min(Math.max(loadRatio * 100, 0), 200);
}
