// Follow-up experiment: does risk-based audit queue prioritization recover
// coverage/catch-rate at the audit-capacity bottleneck? Targeted — reuses
// the EXACT seed + pressure config of the 48 already-run FIFO cap-1
// multi-agent episodes (read straight from the DB, not re-derived), and
// duplicates each with auditQueueStrategy: "risk-priority". Does NOT touch
// or re-run the 192-episode main dataset.
//
// Note on "paired by seed": same seed => same generated cases (severity,
// demographics, arrivals) in both arms, but LLM decisions are drawn fresh
// each episode (no fixed sampling seed at the model level) — same
// case-generation-parity design already used for Control vs Multi-agent
// throughout this study, not per-decision determinism.
//
// Usage (dev server must be running, main dataset already present):
//   node scripts/run-priority-experiment.mjs [--concurrency 4]

import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}

const BASE = arg("base", "http://localhost:3000");
const CONCURRENCY = Number(arg("concurrency", "4"));
const TICKS = Number(arg("ticks", "20")); // must match run-experiment.mjs for a fair comparison
const TOTAL_PAIRS = 12; // must match run-experiment.mjs

const EXPECTED_SEEDS = new Set();
for (let cell = 0; cell < 8; cell++) for (let i = 0; i < 12; i++) EXPECTED_SEEDS.add(1000 + cell * 100 + i);

const db = new DatabaseSync(path.join(process.cwd(), "data", "policytown.db"), { readOnly: true });
const baseline = db
  .prepare("SELECT config FROM episodes")
  .all()
  .map((r) => JSON.parse(r.config))
  .filter(
    (c) =>
      c.mode === "multi-agent" &&
      EXPECTED_SEEDS.has(c.seed) &&
      c.pressure.auditorCapacityPerTick === 1 &&
      (!c.pressure.auditQueueStrategy || c.pressure.auditQueueStrategy === "fifo")
  );
db.close();

if (baseline.length !== 48) {
  console.error(`Expected exactly 48 FIFO cap-1 multi-agent episodes as the baseline, found ${baseline.length}. Aborting.`);
  process.exit(1);
}
const limit = arg("limit", null);
const targets = limit ? baseline.slice(0, Number(limit)) : baseline;
console.log(`Found ${baseline.length} FIFO cap-1 baseline episodes. Running ${targets.length}${limit ? " (--limit)" : ""} with auditQueueStrategy=risk-priority.\n`);

async function post(p, b) {
  const res = await fetch(`${BASE}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  const data = await res.json();
  if (!res.ok) throw new Error(`${p}: ${data.error ?? res.status}`);
  return data;
}

async function runEpisode(cfg) {
  const t0 = Date.now();
  const state0 = await post("/api/episode", {
    mode: "multi-agent",
    seed: cfg.seed,
    totalPairs: TOTAL_PAIRS,
    caseloadCurve: cfg.pressure.caseloadCurve,
    resourceStock: cfg.pressure.resourceStock,
    resourceRegenPerTick: cfg.pressure.resourceRegenPerTick,
    auditorCapacityPerTick: cfg.pressure.auditorCapacityPerTick,
    auditQueueStrategy: "risk-priority",
  });
  let s = state0;
  for (let t = 1; t <= TICKS; t++) s = await post("/api/tick", { episodeId: state0.episodeId });
  const secs = Math.round((Date.now() - t0) / 1000);
  const allocated = s.cases.filter((c) => c.allocationOutcome).length;
  const unaudited = s.cases.filter((c) => c.allocationOutcome && c.policyChecks.length === 0).length;
  return { secs, allocated, unaudited, total: s.cases.length };
}

const started = Date.now();
let done = 0;
let failures = 0;
let nextIdx = 0;

async function worker() {
  while (nextIdx < targets.length) {
    const cfg = targets[nextIdx++];
    const label = `seed${cfg.seed} (${cfg.pressure.caseloadCurve}/beds${cfg.pressure.resourceStock})`;
    try {
      const r = await runEpisode(cfg);
      done++;
      console.log(`[${String(done).padStart(2)}/${targets.length}] ${label}  (${r.secs}s)  allocated ${r.allocated}/${r.total}, unaudited ${r.unaudited}`);
    } catch (err) {
      done++;
      failures++;
      console.log(`[${String(done).padStart(2)}/${targets.length}] FAILED ${label}: ${err.message}`);
      process.exitCode = 1;
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`\nFinished ${targets.length} risk-priority episodes in ${Math.round((Date.now() - started) / 60000)} min${failures ? ` (${failures} failures)` : ""}.`);
console.log("Next: python scripts/analyze_priority_experiment.py");
