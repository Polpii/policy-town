// Phase 4 experiment runner — FACTORIAL design: each pressure dimension is
// varied INDEPENDENTLY (2×2×2: caseload curve × bed scarcity × auditor
// capacity), crossed with both modes, N seeded episodes per cell. The
// in-app presets (Quiet/Rush/Chaos) conflate dimensions and are for demos
// only; scientific conclusions come from this matrix, where e.g. the
// auditor-capacity effect can be isolated at every level of the other two
// dimensions. The same seeds are reused across modes and cells sharing an
// index, so conditions are compared on identical generated cases.
//
// Usage (dev server must be running):
//   node scripts/run-experiment.mjs [--n 2] [--base http://localhost:3000] [--seed 1000]
//   npm run experiment -- --n 2

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}

const BASE = arg("base", "http://localhost:3000");
const N = Number(arg("n", "2")); // episodes per condition cell
const BASE_SEED = Number(arg("seed", "1000"));
const TOTAL_PAIRS = 12;
// FIXED episode length: every episode runs EXACTLY this many ticks, identical
// across modes for a paired seed, so Control and Multi-agent are compared at
// the same operational point. Allocations finish well before this (~tick 14
// even in the worst cell), but the audit bottleneck (capacity 1) leaves a
// real, measurable backlog of genuinely-unaudited cases at T — which the
// run-to-completion design erased. Extra ticks after an episode fully
// resolves are cheap no-ops (no pending cases → no LLM calls).
const TICKS = Number(arg("ticks", "20"));
// How many episodes run at once. Episodes are independent, so this overlaps
// LLM latency and cuts wall-time ~proportionally. Keep it modest to stay
// under provider rate limits (each episode can fire several calls per tick).
const CONCURRENCY = Number(arg("concurrency", "4"));

// The three pressure dimensions, each at a low and a high level.
const CURVES = ["flat", "rising"];
const BEDS = [
  { resourceStock: 8, resourceRegenPerTick: 1 }, // ample
  { resourceStock: 5, resourceRegenPerTick: 1 }, // scarce
];
const AUDIT_CAPS = [99, 1]; // unlimited vs. bottlenecked

const CELLS = [];
for (const caseloadCurve of CURVES)
  for (const beds of BEDS)
    for (const auditorCapacityPerTick of AUDIT_CAPS)
      CELLS.push({ caseloadCurve, ...beds, auditorCapacityPerTick });

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path}: ${data.error ?? res.status}`);
  return data;
}

function cellLabel(cell) {
  return `${cell.caseloadCurve}/beds${cell.resourceStock}/cap${cell.auditorCapacityPerTick}`;
}

async function runEpisode(mode, cell, seed) {
  const state0 = await post("/api/episode", { mode, seed, totalPairs: TOTAL_PAIRS, ...cell });
  const id = state0.episodeId;
  const t0 = Date.now();
  let s = state0;
  for (let t = 1; t <= TICKS; t++) {
    s = await post("/api/tick", { episodeId: id });
  }
  const secs = Math.round((Date.now() - t0) / 1000);
  const allocated = s.cases.filter((c) => c.allocationOutcome).length;
  const unaudited = s.cases.filter((c) => c.allocationOutcome && c.policyChecks.length === 0).length;
  return { secs, allocated, unaudited, total: s.cases.length };
}

// Build the full task list up front (episodes are independent), then run them
// through a concurrency pool. Episodes touch only their own DB rows and their
// own per-episode bed counter, so running several at once just overlaps the
// LLM latency — the actual bottleneck — and cuts wall-time roughly by the
// pool size. Same seed is shared by both modes of a (cell, replicate).
const TASKS = [];
for (let cellIdx = 0; cellIdx < CELLS.length; cellIdx++) {
  for (let i = 0; i < N; i++) {
    const seed = BASE_SEED + cellIdx * 100 + i;
    for (const mode of ["multi-agent", "control"]) {
      TASKS.push({ mode, cell: CELLS[cellIdx], seed });
    }
  }
}

const started = Date.now();
console.log(
  `Factorial matrix: 2 modes × ${CELLS.length} pressure cells × ${N} seeds = ${TASKS.length} episodes, ${TICKS} ticks each`
);
console.log(`Server: ${BASE}  |  concurrency: ${CONCURRENCY}\n`);

let done = 0;
let failures = 0;
let nextIdx = 0;

async function worker() {
  while (nextIdx < TASKS.length) {
    const task = TASKS[nextIdx++];
    const label = `${task.mode} ${cellLabel(task.cell)} seed${task.seed}`;
    try {
      const r = await runEpisode(task.mode, task.cell, task.seed);
      done++;
      console.log(
        `[${String(done).padStart(2)}/${TASKS.length}] ${label}  (${r.secs}s)  allocated ${r.allocated}/${r.total}, unaudited ${r.unaudited}`
      );
    } catch (err) {
      done++;
      failures++;
      console.log(`[${String(done).padStart(2)}/${TASKS.length}] FAILED ${label}: ${err.message}`);
      process.exitCode = 1;
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

console.log(`\nFinished ${TASKS.length} episodes in ${Math.round((Date.now() - started) / 60000)} min${failures ? ` (${failures} failures)` : ""}.`);
console.log("Next: npm run analyze");
