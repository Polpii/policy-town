# PolicyTown

![PolicyTown demo](report/screenshots/PolicyTown.gif)

A research instrument that asks one question: when a single LLM making a
life-or-death resource-allocation call shows demographic bias (as White
Circle's KillBench documented), does splitting that decision across a team
of role-differentiated agents make the bias better, worse, or just harder
to see?

It's not a product. It's a synthetic disaster-triage simulator: patients
arrive needing a scarce hospital bed, and an LLM pipeline decides who gets
one, built specifically to run that comparison at scale and check the
results statistically.

> **The headline finding:** splitting the decision across agents doesn't
> change how often it's biased (6.9% vs 6.1%, not significant). But 30.0%
> of the biased outcomes that *do* happen never get flagged by anyone,
> anywhere in the pipeline, and that share depends heavily on audit load:
> 18.4% when the auditor isn't overloaded, 43.8% when it is. That's not a
> judgment problem, it's a coverage problem: an overloaded auditor doesn't
> judge worse, it just reviews fewer cases.

**[Read the full report (PDF) →](report/PolicyTown-Report.pdf)**

## How it works

Cases are generated as twin pairs: identical clinical severity, differing
in exactly one demographic attribute (nationality, religion, body type,
phone brand). If the two members of a pair end up with different
outcomes, that gap can only be explained by the attribute, which is the
whole measurement.

Every pair runs through one of two conditions:

- **Control**: one agent assesses, allocates, and audits its own decision.
- **Multi-agent**: four Assessors, three Allocators, and two Auditors each
  own one stage, and the auditor reviews an allocator's decision
  independently.

Every allocation is checked against five policies (non-discrimination, no
hallucinated data, no resource misuse, no private data leaks, full
traceability), and the whole thing runs under three pressure dimensions,
caseload curve, bed scarcity, and audit capacity, so you can see what
happens to bias detection specifically when the auditor gets overloaded.
A follow-up experiment then tests one fix: auditing the riskiest decisions
first instead of first-come-first-served, to see whether that recovers
the coverage lost under an overloaded auditor.

```
lib/
  types.ts        data model (Case, AgentDecision, PolicyCheck, EpisodeConfig)
  db.ts           SQLite schema + connection
  policies.ts     the 5 fixed policies
  cases.ts        twin-pair case generator (seeded, deterministic)
  agents/         one module per role, each a single structured LLM call
  simulation.ts   episode lifecycle: startEpisode / advanceTick / getState
app/
  page.tsx        UI shell
  api/            episode / tick / state route handlers
components/       Zone (room/bubble primitive), CaseCard, AgentIcon, TopBar, SidePanel
scripts/          experiment runners + Python analysis (see below)
```

## Running it

```bash
npm install
cp .env.local.example .env.local   # fill in an API key, see comments in the file
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), start an episode, hit
tick. All LLM calls happen server-side; the API key never reaches the
client. Every case, decision, and policy check is persisted to a local
SQLite file at `data/policytown.db` (gitignored, recreated on first run).

By default this runs on Claude Haiku. The reported study used
`gpt-4o-mini`, mainly to keep API costs down across 192 full episodes. Set
`POLICYTOWN_MODEL` and `OPENAI_API_KEY` to reproduce that (see
`lib/agents/llm.ts` for the provider-routing logic).

## Reproducing the study

```bash
npm run experiment -- --n 12    # 192-episode factorial run (needs the dev server up)
node scripts/run-priority-experiment.mjs   # the risk-priority audit-queue follow-up

python scripts/analyze_report.py             # main study stats + charts -> report/
python scripts/analyze_priority_experiment.py # follow-up stats + chart -> report/
```

The Python scripts need `pandas`, `scipy`, `statsmodels`, and `matplotlib`.
Both write their numbers to `report/stats*.json` and regenerate the charts
used in the report, so you can check the report's claims against the raw
data directly.

## Demo

**[Watch a screen recording of a live episode](report/screenshots/PolicyTown2.mp4)**,
click through to GitHub's video player.

What the simulation looks like mid-episode: cases moving through
assessment, allocation, and audit toward a fixed-capacity ward. The dashed
red line flags a twin pair that was just treated unequally:

![Map view of a running episode](report/screenshots/map.png)

The stats panel, showing a resolved pair and its policy-check verdicts:

![Stats view](report/screenshots/stats.png)

## Visual language

The canvas reuses the rendering approach from an unrelated `tangible-creativity`
Next.js app: a plain off-white stage, soft white rounded "rooms" as zone
containers, small circular icon tokens for agents and cases. Nothing else
from that project carried over; this is a different instrument that only
borrows the look.
