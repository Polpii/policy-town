"""
PolicyTown — follow-up: does risk-based audit prioritization recover
coverage/catch-rate at the audit-capacity bottleneck?

Compares the 48 existing FIFO cap-1 multi-agent episodes (main dataset)
against 48 new risk-priority cap-1 multi-agent episodes run on the exact
same 48 seeds (scripts/run-priority-experiment.mjs). Same test style as
scripts/analyze_report.py: pooled Fisher's exact two-proportion test,
Wilson-based CI on the difference. Writes report/chart_priority.png and
prints/returns the numbers report/REPORT.md's follow-up section must match.

Run: python scripts/analyze_priority_experiment.py
"""

import json
import sqlite3
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
from scipy.stats import fisher_exact
from statsmodels.stats.proportion import confint_proportions_2indep, proportion_confint

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUT = ROOT / "report"

EXPECTED_SEEDS = {1000 + cell * 100 + i for cell in range(8) for i in range(12)}

# ---------- chart style: reuse exactly what analyze_report.py established ----------
import colorsys


def pastel(hex_color, sat_scale=0.55, light_boost=0.22):
    r, g, b = (int(hex_color[i : i + 2], 16) / 255 for i in (1, 3, 5))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    l = min(1, l + light_boost * (1 - l))
    s = s * sat_scale
    r, g, b = colorsys.hls_to_rgb(h, l, s)
    return "#{:02x}{:02x}{:02x}".format(round(r * 255), round(g * 255), round(b * 255))


FULL = pastel("#4a3aa7")  # "better handling of the constraint" — priority queue
REDUCED = pastel("#eb6834")  # baseline — FIFO
INK = "#3a3936"
HAIRLINE = "#e1e0d9"

import matplotlib.font_manager as fm

_available = {f.name for f in fm.fontManager.ttflist}
FONT = next((f for f in ["Segoe UI", "Helvetica Neue", "Arial"] if f in _available), "DejaVu Sans")
plt.rcParams.update(
    {
        "font.family": FONT, "text.color": INK, "axes.edgecolor": HAIRLINE, "axes.labelcolor": INK,
        "axes.titlecolor": INK, "xtick.color": INK, "ytick.color": INK,
        "axes.spines.top": False, "axes.spines.right": False, "axes.spines.left": False,
        "axes.grid": True, "axes.grid.axis": "y", "grid.color": HAIRLINE, "grid.linewidth": 0.8,
        "figure.facecolor": "white", "axes.facecolor": "white", "font.size": 12,
    }
)


def style_ax(ax):
    ax.tick_params(length=0)
    ax.set_axisbelow(True)


def sig_bracket(ax, x1, x2, y, p, h=0.05):
    if p >= 0.05:
        ax.text((x1 + x2) / 2, y + h * 0.3, "n.s.", ha="center", va="bottom", fontsize=10, color=INK)
        return
    stars = "***" if p < 0.001 else "**" if p < 0.01 else "*"
    ax.plot([x1, x1, x2, x2], [y, y + h, y + h, y], lw=1.1, color=INK)
    ax.text((x1 + x2) / 2, y + h, stars, ha="center", va="bottom", fontsize=14, color=INK)


def two_prop_test(x1, n1, x2, n2, label):
    table = [[x1, n1 - x1], [x2, n2 - x2]]
    _, p = fisher_exact(table)
    p1, p2 = x1 / n1 if n1 else float("nan"), x2 / n2 if n2 else float("nan")
    ci_low, ci_high = confint_proportions_2indep(x1, n1, x2, n2, method="wald")
    print(
        f"{label}: {x1}/{n1} ({p1:.1%}) vs {x2}/{n2} ({p2:.1%})  diff={p1-p2:+.1%}  "
        f"95% CI [{ci_low:+.1%}, {ci_high:+.1%}]  Fisher p={p:.4f}  "
        f"{'SIGNIFICANT' if p < 0.05 else 'not significant'} (alpha=.05)"
    )
    return {"x1": int(x1), "n1": int(n1), "rate1": p1, "x2": int(x2), "n2": int(n2), "rate2": p2,
            "diff": p1 - p2, "ci95": [ci_low, ci_high], "p": p}


# ---------- load episodes, split by strategy ----------

con = sqlite3.connect(DATA / "policytown.db")
eps = pd.read_sql_query("SELECT id AS episodeId, config FROM episodes", con)
eps["seed"] = eps["config"].apply(lambda c: json.loads(c)["seed"])
eps["mode"] = eps["config"].apply(lambda c: json.loads(c)["mode"])
eps["cap"] = eps["config"].apply(lambda c: json.loads(c)["pressure"]["auditorCapacityPerTick"])
eps["strategy"] = eps["config"].apply(lambda c: json.loads(c)["pressure"].get("auditQueueStrategy", "fifo"))
eps = eps[(eps["mode"] == "multi-agent") & (eps["cap"] == 1) & (eps["seed"].isin(EXPECTED_SEEDS))]

fifo_eps = eps[eps["strategy"] == "fifo"]
priority_eps = eps[eps["strategy"] == "risk-priority"]
print(f"FIFO cap-1 episodes: {len(fifo_eps)}   risk-priority cap-1 episodes: {len(priority_eps)}")
assert len(fifo_eps) == 48, f"expected 48 FIFO baseline episodes, found {len(fifo_eps)}"
assert len(priority_eps) == 48, f"expected 48 risk-priority episodes, found {len(priority_eps)} — did the run finish?"
assert set(fifo_eps["seed"]) == set(priority_eps["seed"]), "seed sets don't match — not a clean paired comparison"
print("Integrity check: 48 == 48, identical seed sets — paired comparison confirmed clean.\n")

alloc = pd.read_sql_query("SELECT id AS decisionId, episodeId, caseId, action FROM agent_decisions WHERE agentRole = 'allocator'", con)
checks = pd.read_sql_query("SELECT decisionId, policyId, verdict FROM policy_checks", con)
con.close()

alloc["pairId"] = alloc["caseId"].str.slice(0, -2)
audited_ids = set(checks["decisionId"].unique())
p1_flag_ids = set(checks[(checks["policyId"] == 1) & (checks["verdict"].isin(["warn", "violation"]))]["decisionId"])
alloc["audited"] = alloc["decisionId"].isin(audited_ids)
alloc["p1_flagged"] = alloc["decisionId"].isin(p1_flag_ids)

pairs_df = pd.read_csv(DATA / "pairs.csv")
pairs_df = pairs_df[pairs_df["seed"].isin(EXPECTED_SEEDS) & pairs_df["condition"].str.startswith("multi-agent/") & (pairs_df["biasAffected"] == 1)]
# pairs.csv only has the FIFO arm (it predates this experiment) — rebuild
# "biased" (bias-affected) status for BOTH arms independently from the DB so
# the risk-priority arm isn't missing from this analysis.
sev = pd.read_sql_query("SELECT episodeId, caseId, action FROM agent_decisions WHERE agentRole = 'assessor'", sqlite3.connect(DATA / "policytown.db"))


def parse_sev(action):
    import re
    m = re.search(r"severity=(\d)", action)
    return int(m.group(1)) if m else None


def parse_outcome(action):
    import re
    m = re.search(r"outcome=(\w+)", action)
    return m.group(1) if m else None


sev["severity"] = sev["action"].apply(parse_sev)
sev["pairId"] = sev["caseId"].str.slice(0, -2)
alloc["outcome"] = alloc["action"].apply(parse_outcome)

results = {}
for arm_name, arm_eps in [("fifo", fifo_eps), ("risk-priority", priority_eps)]:
    ep_ids = set(arm_eps["episodeId"])
    a = alloc[alloc["episodeId"].isin(ep_ids)].copy()
    s = sev[sev["episodeId"].isin(ep_ids)][["caseId", "severity"]]
    a = a.merge(s, on="caseId", how="left")
    g = a.groupby("pairId").agg(
        n_twins=("caseId", "nunique"),
        sevs=("severity", lambda x: tuple(sorted(x))),
        outcomes=("outcome", lambda x: tuple(sorted(x))),
        any_audited=("audited", "any"),
        any_flagged=("p1_flagged", "any"),
    ).reset_index()
    g = g[g["n_twins"] == 2]  # resolved pairs only
    g["biased"] = g.apply(lambda r: (len(set(r["sevs"])) > 1) or (len(set(r["outcomes"])) > 1), axis=1)
    biased = g[g["biased"]]
    n_biased = len(biased)
    catch_x = int(biased["any_flagged"].sum())
    results[arm_name] = {
        "n_resolved_pairs": len(g),
        "n_biased": n_biased,
        "catch_x": catch_x,
        "coverage_x": int(biased["any_audited"].sum()),
        # Silent bias = biased AND never flagged anywhere, regardless of
        # audited status — the ORIGINAL success metric this whole follow-up
        # was meant to move, reported as its own number, not left for the
        # reader to derive as "1 minus catch rate".
        "silent_x": n_biased - catch_x,
    }
    print(f"{arm_name}: {len(g)} resolved pairs, {n_biased} biased, "
          f"catch {catch_x}/{n_biased}, coverage {biased['any_audited'].sum()}/{n_biased}, "
          f"silent {n_biased - catch_x}/{n_biased}")

print()
out = {}
out["catch_rate"] = two_prop_test(
    results["risk-priority"]["catch_x"], results["risk-priority"]["n_biased"],
    results["fifo"]["catch_x"], results["fifo"]["n_biased"],
    "Catch rate: risk-priority vs fifo",
)
out["coverage"] = two_prop_test(
    results["risk-priority"]["coverage_x"], results["risk-priority"]["n_biased"],
    results["fifo"]["coverage_x"], results["fifo"]["n_biased"],
    "Coverage: risk-priority vs fifo",
)
out["silent_bias_rate"] = two_prop_test(
    results["risk-priority"]["silent_x"], results["risk-priority"]["n_biased"],
    results["fifo"]["silent_x"], results["fifo"]["n_biased"],
    "Silent-bias rate: risk-priority vs fifo",
)
out["raw"] = results

(OUT / "stats_priority.json").write_text(json.dumps(out, indent=2, default=float))
print(f"\nwrote {OUT / 'stats_priority.json'}")

# ---------- chart ----------

fig, axes = plt.subplots(1, 2, figsize=(9.8, 5.3))
for ax, key, title in [(axes[0], "coverage", "Coverage: reviewed at all?"), (axes[1], "catch_rate", "Judgment: bias caught, given reviewed pairs?")]:
    r = out[key]
    vals = [r["rate2"], r["rate1"]]  # fifo, then priority
    ns = [r["n2"], r["n1"]]
    xs = [r["x2"], r["x1"]]
    los, his = zip(*[proportion_confint(x, n, method="wilson") for x, n in zip(xs, ns)])
    err = [[v - lo for v, lo in zip(vals, los)], [hi - v for v, hi in zip(vals, his)]]
    ax.bar(["FIFO\n(oldest first)", "Risk-priority\n(highest-risk first)"], vals, yerr=err, capsize=3,
           error_kw={"ecolor": INK, "elinewidth": 1}, color=[REDUCED, FULL], width=0.55)
    ax.set_ylim(0, 1.18)
    ax.set_title(title, fontsize=12)
    sig_bracket(ax, 0, 1, 1.02, r["p"], h=0.05)
    ax.text(0.5, -0.15, f"n={ns[0]} vs n={ns[1]} biased pairs", transform=ax.transAxes, ha="center", fontsize=9, color=INK)
    style_ax(ax)
axes[0].set_ylabel("Share of biased pairs")
fig.text(0.5, 1.1, "Does reviewing highest-risk decisions first recover what capacity pressure costs?",
         ha="center", fontsize=13, fontweight="bold", color=INK)
fig.text(0.5, 1.0, "Both arms: Multi-agent, audit capacity capped at 1/turn — same 48 seeds in both",
         ha="center", fontsize=10.5, color=INK, style="italic")
fig.tight_layout()
fig.savefig(OUT / "chart_priority.png", dpi=160, bbox_inches="tight")
plt.close(fig)
print(f"wrote {OUT / 'chart_priority.png'}")
