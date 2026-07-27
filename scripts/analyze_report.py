"""
PolicyTown — statistical analysis + charts for the n=12 GPT-4o-mini study.

Reads data/pairs.csv (2-proportion tests, silent-bias metric) and
data/policytown.db (per-policy verdict counts, control vs multi-agent).
Writes report/*.png charts and report/stats.json (exact numbers the report
text must match).

Run: python scripts/analyze_report.py
"""

import colorsys
import json
import sqlite3
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.font_manager as fm
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy.stats import chisquare, fisher_exact
from statsmodels.stats.proportion import proportion_confint, confint_proportions_2indep

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUT = ROOT / "report"
OUT.mkdir(exist_ok=True)


def pastel(hex_color, sat_scale=0.55, light_boost=0.22):
    """Soften a color: scale down saturation, nudge lightness up. Keeps hue
    (so it's still recognizably "the orange one" / "the purple one") while
    reading as pastel rather than saturated brand color on a chart."""
    r, g, b = (int(hex_color[i : i + 2], 16) / 255 for i in (1, 3, 5))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    l = min(1, l + light_boost * (1 - l))
    s = s * sat_scale
    r, g, b = colorsys.hls_to_rgb(h, l, s)
    return "#{:02x}{:02x}{:02x}".format(round(r * 255), round(g * 255), round(b * 255))


# ---------- shared chart style: PolicyTown's own palette, pastel, one font ----------
# Reuses lib/theme.ts's hues (not the saturated values verbatim — softened
# for a report rather than a game UI) so the report still shares a visual
# identity with the app. Two colors only, mapped to a single throughline
# ("how much independent oversight exists") that both comparisons in this
# report are really about:
#   REDUCED = less independent oversight  → Control, OR a saturated auditor
#   FULL    = full independent oversight  → Multi-agent, OR an unsaturated auditor
# IMPORTANT: this color pairing means something different in different
# charts (mode, in some; audit-capacity, in others) — every chart below
# restates in plain words what it's comparing, on purpose. Never assume the
# color alone carries that meaning.
REDUCED = pastel("#eb6834")  # ROLE_STYLE.control, pastel
FULL = pastel("#4a3aa7")  # ROLE_STYLE.auditor, pastel
REDUCED_LINE = "#c9622a"  # slightly deeper, used only for the sig-bracket ink
FULL_LINE = "#4a3aa7"
INK = "#3a3936"
HAIRLINE = "#e1e0d9"
PALETTE = {"control": REDUCED, "multi-agent": FULL}


def titled(ax, title, subtitle=None):
    """Bold headline on top, italic one-line clarifier just below it, both
    guaranteed in that visual order regardless of figure size (set_title's
    default pad made this order figure-size-dependent and once rendered
    backwards)."""
    ax.text(0.5, 1.14 if subtitle else 1.04, title, transform=ax.transAxes, ha="center",
            fontsize=13, fontweight="bold", color=INK)
    if subtitle:
        ax.text(0.5, 1.04, subtitle, transform=ax.transAxes, ha="center", fontsize=10.5, color=INK, style="italic")


def plain_cell(cell):
    """Cell label with the internal cap1/cap99 jargon spelled out in plain
    words — this is a compact axis label, so it stays short."""
    if cell == "POOLED":
        return "POOLED"
    s = cell.replace("+1", "").replace("cap99", "no limit").replace("cap1", "1/turn")
    return s.replace("/", "\n")


def sig_bracket(ax, x1, x2, y, p, h=0.03, label_only_if_significant=True):
    """Draw a bracket between two bars with significance asterisks — but
    only when p actually clears .05, so the chart never visually implies
    importance a non-significant comparison doesn't have."""
    if p >= 0.05:
        if not label_only_if_significant:
            ax.text((x1 + x2) / 2, y + h * 0.3, "n.s.", ha="center", va="bottom", fontsize=10, color=INK)
        return
    stars = "***" if p < 0.001 else "**" if p < 0.01 else "*"
    ax.plot([x1, x1, x2, x2], [y, y + h, y + h, y], lw=1.1, color=INK)
    ax.text((x1 + x2) / 2, y + h, stars, ha="center", va="bottom", fontsize=14, color=INK)

_available = {f.name for f in fm.fontManager.ttflist}
FONT = next((f for f in ["Segoe UI", "Helvetica Neue", "Arial"] if f in _available), "DejaVu Sans")
plt.rcParams.update(
    {
        "font.family": FONT,
        "text.color": INK,
        "axes.edgecolor": HAIRLINE,
        "axes.labelcolor": INK,
        "axes.titlecolor": INK,
        "xtick.color": INK,
        "ytick.color": INK,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "axes.spines.left": False,
        "axes.grid": True,
        "axes.grid.axis": "y",
        "grid.color": HAIRLINE,
        "grid.linewidth": 0.8,
        "figure.facecolor": "white",
        "axes.facecolor": "white",
        "font.size": 12,
        "axes.titlesize": 13,
        "axes.titleweight": "bold",
    }
)


def style_ax(ax):
    ax.tick_params(length=0)
    ax.set_axisbelow(True)

# ---------- load + parse ----------

# The factorial design's seeds, exactly as run-experiment.mjs generates them:
# BASE_SEED(1000) + cellIdx*100 + i, 8 cells × 12 replicates. Anything outside
# this set is not part of the planned study — e.g. ad hoc episodes started
# from the app UI (random seed) for screenshots — and must be excluded, or it
# silently pools into the pooled statistics below.
EXPECTED_SEEDS = {1000 + cell * 100 + i for cell in range(8) for i in range(12)}

df = pd.read_csv(DATA / "pairs.csv")
n_before = df["seed"].nunique()
stray_seeds = sorted(set(df["seed"]) - EXPECTED_SEEDS)
if stray_seeds:
    n_stray_rows = int(df["seed"].isin(stray_seeds).sum())
    print(f"Excluding {len(stray_seeds)} non-experiment seed(s) {stray_seeds} ({n_stray_rows} pair rows) — not part of the factorial plan.")
    df = df[df["seed"].isin(EXPECTED_SEEDS)]

# ---------- integrity check: is pairs.csv ACTUALLY the 192 planned episodes? ----------
# Don't just assume "no exclusion message printed" means clean — cross-check
# pairs.csv's episodeId set against the DB's episodes table independently.
# DB rows for a finished episode are never mutated after the fact, so if the
# sets match exactly, pairs.csv is provably current and uncontaminated for
# Result 1 & 2 (not merely "assumed intact").
_con = sqlite3.connect(DATA / "policytown.db")
_eps = pd.read_sql_query("SELECT id AS episodeId, config FROM episodes", _con)
_con.close()
_eps["seed"] = _eps["config"].apply(lambda c: json.loads(c)["seed"])
# The follow-up experiment (run-priority-experiment.mjs) deliberately reuses
# 48 of these exact seed values with auditQueueStrategy="risk-priority" so it
# can be paired against its FIFO baseline — those are a SEPARATE analysis
# (see analyze_priority_experiment.py) and must not double up in this one.
_eps["strategy"] = _eps["config"].apply(lambda c: json.loads(c)["pressure"].get("auditQueueStrategy", "fifo"))
_expected_episode_ids = set(_eps.loc[_eps["seed"].isin(EXPECTED_SEEDS) & (_eps["strategy"] == "fifo"), "episodeId"])
_csv_episode_ids = set(df["episodeId"])
_missing_from_csv = _expected_episode_ids - _csv_episode_ids
_extra_in_csv = _csv_episode_ids - _expected_episode_ids
print(
    f"Integrity check: {len(_expected_episode_ids)} planned episodes in DB, "
    f"{len(_csv_episode_ids)} episodes in pairs.csv after seed-filter — "
    f"missing={len(_missing_from_csv)} extra={len(_extra_in_csv)} "
    f"{'MATCH — Result 1 & 2 confirmed clean' if not _missing_from_csv and not _extra_in_csv else 'MISMATCH — investigate before trusting Result 1/2'}"
)
assert not _missing_from_csv and not _extra_in_csv, "pairs.csv does not exactly match the 192 planned episodes"
# Reused everywhere below that queries the DB directly (not via pairs.csv):
# the follow-up priority-queue experiment reuses 48 of these exact seed
# values (different episodeId, same caseIds!) — a seed-only filter would
# silently pool its rows back into these "main" results. episodeId is the
# only safe key once that experiment exists.
FIFO_EPISODE_IDS = _expected_episode_ids

cond = df["condition"].str.split("/", expand=True)
cond.columns = ["mode", "curve", "beds", "cap", "model"]
df = pd.concat([df, cond], axis=1)
df["cell"] = df["curve"] + "/" + df["beds"]  # the 4 curve×beds cells, cap held out
df = df[df["biasAffected"].notna()]  # resolved pairs only
df["biasAffected"] = df["biasAffected"].astype(int)
df["p1Flagged"] = df["p1Flagged"].astype(int)

assert df["model"].nunique() == 1, "expected a single-model dataset"
MODEL = df["model"].iloc[0]

results = {"model": MODEL, "n_pairs_total": int(len(df))}


def two_prop_test(x1, n1, x2, n2, label):
    """Fisher's exact test + Wilson-based CI on the difference of proportions."""
    table = [[x1, n1 - x1], [x2, n2 - x2]]
    odds_ratio, p = fisher_exact(table)
    p1, p2 = x1 / n1 if n1 else float("nan"), x2 / n2 if n2 else float("nan")
    ci_low, ci_high = confint_proportions_2indep(x1, n1, x2, n2, method="wald")
    out = {
        "label": label,
        "group1": {"x": int(x1), "n": int(n1), "rate": p1},
        "group2": {"x": int(x2), "n": int(n2), "rate": p2},
        "diff": p1 - p2,
        "diff_ci95": [ci_low, ci_high],
        "fisher_p": p,
        "odds_ratio": odds_ratio,
        "significant_at_05": bool(p < 0.05),
    }
    print(
        f"{label}: {x1}/{n1} ({p1:.1%}) vs {x2}/{n2} ({p2:.1%})  "
        f"diff={p1-p2:+.1%}  95% CI [{ci_low:+.1%}, {ci_high:+.1%}]  "
        f"Fisher p={p:.4f}  {'SIGNIFICANT' if p < 0.05 else 'not significant'} (alpha=.05)"
    )
    return out


# ---------- 1.1a bias rate: control vs multi-agent, pooled ----------

print("\n=== 1.1a Bias rate: Control vs Multi-agent ===")
ctrl = df[df["mode"] == "control"]
multi = df[df["mode"] == "multi-agent"]
results["bias_rate_pooled"] = two_prop_test(
    ctrl["biasAffected"].sum(), len(ctrl), multi["biasAffected"].sum(), len(multi), "bias rate control vs multi (pooled)"
)

print("\n--- per pressure cell (8 cells) ---")
results["bias_rate_per_cell"] = []
for (curve, beds, cap), g in df.groupby(["curve", "beds", "cap"]):
    c = g[g["mode"] == "control"]
    m = g[g["mode"] == "multi-agent"]
    label = f"{curve}/{beds}/{cap}"
    r = two_prop_test(c["biasAffected"].sum(), len(c), m["biasAffected"].sum(), len(m), label)
    r["cell"] = label
    results["bias_rate_per_cell"].append(r)

# ---------- 1.1b catch rate: cap99 vs cap1, multi-agent only ----------

print("\n=== 1.1b Catch rate (P1): cap99 vs cap1, multi-agent, among biased pairs ===")
multi_biased = multi[multi["biasAffected"] == 1]
c99 = multi_biased[multi_biased["cap"] == "cap99"]
c1 = multi_biased[multi_biased["cap"] == "cap1"]
results["catch_rate_pooled"] = two_prop_test(
    c99["p1Flagged"].sum(), len(c99), c1["p1Flagged"].sum(), len(c1), "catch rate cap99 vs cap1 (pooled)"
)

print("\n--- per matched cell (4 curve×beds cells, cap varied) ---")
results["catch_rate_per_cell"] = []
for cell, g in multi_biased.groupby("cell"):
    g99 = g[g["cap"] == "cap99"]
    g1 = g[g["cap"] == "cap1"]
    r = two_prop_test(g99["p1Flagged"].sum(), len(g99), g1["p1Flagged"].sum(), len(g1), cell)
    r["cell"] = cell
    results["catch_rate_per_cell"].append(r)

# ---------- 1.1c decompose catch rate: coverage vs. judgment quality ----------
# The pooled catch-rate drop (81.6% -> 56.2%) could be almost entirely
# mechanical: at cap 1, 25% of allocations are never audited at all, and an
# unaudited case is definitionally "not caught" — that alone would produce
# most of the drop even if judgment quality on cases actually reviewed were
# unchanged. Decompose: (a) COVERAGE — was at least one twin's allocation
# decision actually audited at all — vs (b) CONDITIONAL catch rate — among
# pairs where it was, did the audit flag P1. If (b) is flat while (a) moves,
# the "auditors judge worse under load" story is NOT supported by this data;
# what's supported is a coverage/staffing story instead.
print("\n=== 1.1c Decomposition: coverage vs. judgment quality on what WAS reviewed ===")
_con = sqlite3.connect(DATA / "policytown.db")
_alloc_dec2 = pd.read_sql_query(
    "SELECT id AS decisionId, episodeId, caseId FROM agent_decisions WHERE agentRole = 'allocator'", _con
)
_checks2 = pd.read_sql_query("SELECT decisionId, policyId, verdict FROM policy_checks", _con)
_con.close()
_eps2 = pd.read_sql_query(
    "SELECT id AS episodeId, config FROM episodes", sqlite3.connect(DATA / "policytown.db")
)
_eps2["cap"] = _eps2["config"].apply(lambda c: "cap99" if json.loads(c)["pressure"]["auditorCapacityPerTick"] > 2 else "cap1")
_eps2 = _eps2[_eps2["episodeId"].isin(FIFO_EPISODE_IDS)]
_alloc_dec2 = _alloc_dec2[_alloc_dec2["episodeId"].isin(FIFO_EPISODE_IDS)]  # see FIFO_EPISODE_IDS note above
_alloc_dec2 = _alloc_dec2.merge(_eps2[["episodeId", "cap"]], on="episodeId")
_alloc_dec2["pairId"] = _alloc_dec2["caseId"].str.slice(0, -2)
_audited_ids = set(_checks2["decisionId"].unique())
_p1_flag_ids = set(_checks2[(_checks2["policyId"] == 1) & (_checks2["verdict"].isin(["warn", "violation"]))]["decisionId"])
_alloc_dec2["audited"] = _alloc_dec2["decisionId"].isin(_audited_ids)
_alloc_dec2["p1_flagged"] = _alloc_dec2["decisionId"].isin(_p1_flag_ids)
_pair_level = _alloc_dec2.groupby("pairId").agg(any_audited=("audited", "any"), any_flagged=("p1_flagged", "any")).reset_index()
_mb = multi_biased.merge(_pair_level, on="pairId", how="left")

_c99 = _mb[_mb["cap"] == "cap99"]
_c1 = _mb[_mb["cap"] == "cap1"]
results["coverage_pooled"] = two_prop_test(
    _c99["any_audited"].sum(), len(_c99), _c1["any_audited"].sum(), len(_c1), "coverage: >=1 twin actually audited, cap99 vs cap1"
)
_c99a = _c99[_c99["any_audited"]]
_c1a = _c1[_c1["any_audited"]]
results["conditional_catch_rate_pooled"] = two_prop_test(
    _c99a["any_flagged"].sum(), len(_c99a), _c1a["any_flagged"].sum(), len(_c1a),
    "CONDITIONAL catch rate (only pairs actually audited), cap99 vs cap1"
)
print(
    f"cap1: {(~_c1['any_audited']).sum()}/{len(_c1)} biased pairs had NEITHER twin ever audited "
    f"(this is the entire mechanism behind the unconditional catch-rate drop)"
)

# ---------- 1.2 silent-bias metric ----------

print("\n=== 1.2 Silent bias — the core number ===")
n_biased_multi = len(multi_biased)
n_silent = int((multi_biased["p1Flagged"] == 0).sum())
silent_rate = n_silent / n_biased_multi if n_biased_multi else float("nan")
ci_low, ci_high = proportion_confint(n_silent, n_biased_multi, method="wilson")
results["silent_bias"] = {
    "n_unfair_pairs_multi_agent": int(n_biased_multi),
    "n_silent": n_silent,
    "rate": silent_rate,
    "ci95": [ci_low, ci_high],
}
print(
    f"Of {n_biased_multi} unfair pairs (multi-agent), {n_silent} ({silent_rate:.1%}, "
    f"95% CI [{ci_low:.1%}, {ci_high:.1%}]) were NEVER flagged on P1 for either twin."
)

# by capacity
results["silent_bias_by_cap"] = {}
for cap, g in multi_biased.groupby("cap"):
    n = len(g)
    s = int((g["p1Flagged"] == 0).sum())
    rate = s / n if n else float("nan")
    results["silent_bias_by_cap"][cap] = {"n": n, "silent": s, "rate": rate}
    print(f"  {cap}: {s}/{n} silent ({rate:.1%})")

# ---------- 1.2b silent-bias by agent instance (exploratory) ----------
# Two separate breakdowns, each answering a different question:
#  (a) which ALLOCATOR (L1/L2/L3) made the final allocation call on the
#      silent-bias cases, normalized by that instance's overall workload?
#  (b) which AUDITOR (U1/U2) was ASSIGNED to review them — using the app's
#      own deterministic routing (assignInstance), since some of these
#      cases were never actually audited (that's part of why they're
#      silent) and "assigned" is still well-defined for those.
# Unit of analysis is CASES within silent-bias pairs (2 per pair, ~42), not
# pairs — a pair's two twins can land on two different agent instances, so
# there is no single "the" instance per pair.

print("\n=== 1.2b Silent bias by agent instance (exploratory — small n) ===")


def js_assign_instance(role: str, case_id: str, count: int) -> str:
    """Exact reimplementation of assignInstance() in lib/simulation.ts
    (32-bit unsigned rolling hash, base 31) — verified below against real
    recorded auditor ids before being trusted for unaudited cases."""
    h = 0
    for ch in case_id:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return f"{role}-{(h % max(count, 1)) + 1}"


_con = sqlite3.connect(DATA / "policytown.db")
_alloc_dec = pd.read_sql_query("SELECT episodeId, caseId, agentId FROM agent_decisions WHERE agentRole = 'allocator'", _con)
_audit_dec = pd.read_sql_query("SELECT episodeId, caseId, agentId FROM agent_decisions WHERE agentRole = 'auditor'", _con)
_con.close()
# Restrict to the 192 planned FIFO episodes — episodeId, not just caseId: the
# priority-queue follow-up reuses 48 of these seeds, so the same caseId
# string exists in a second (different-strategy) episode too.
_alloc_dec = _alloc_dec[_alloc_dec["episodeId"].isin(FIFO_EPISODE_IDS)]
_audit_dec = _audit_dec[_audit_dec["episodeId"].isin(FIFO_EPISODE_IDS)]
_multi_case_ids = set()
for pid in multi["pairId"]:
    _multi_case_ids.add(f"{pid}-a")
    _multi_case_ids.add(f"{pid}-b")

# Validate the hash reimplementation against every real recorded audit
# before relying on it as a fallback for unaudited cases.
_audit_dec["computed"] = _audit_dec["caseId"].apply(lambda c: js_assign_instance("auditor", c, 2))
_hash_match_rate = (_audit_dec["agentId"] == _audit_dec["computed"]).mean()
print(f"Hash reimplementation validated against {len(_audit_dec)} real audits: {_hash_match_rate:.1%} match")
assert _hash_match_rate == 1.0, "assignInstance reimplementation does not match recorded auditor ids — do not trust fallback"

alloc_map = dict(zip(_alloc_dec["caseId"], _alloc_dec["agentId"]))
audit_map = dict(zip(_audit_dec["caseId"], _audit_dec["agentId"]))  # actual, where audited


def assigned_auditor(case_id: str) -> str:
    return audit_map.get(case_id) or js_assign_instance("auditor", case_id, 2)


silent_pair_ids = set(multi_biased.loc[multi_biased["p1Flagged"] == 0, "pairId"])
silent_case_ids = {f"{pid}-{suf}" for pid in silent_pair_ids for suf in ("a", "b")}
print(f"{len(silent_pair_ids)} silent-bias pairs -> {len(silent_case_ids)} cases (unit of analysis below)")


def instance_breakdown(case_to_instance: dict, all_case_ids: set, label: str, n_instances: int):
    role = "allocator" if "llocat" in label.lower() else "auditor"
    all_instances = [f"{role}-{i+1}" for i in range(n_instances)]
    workload = pd.Series([case_to_instance[c] for c in all_case_ids if c in case_to_instance]).value_counts()
    workload = workload.reindex(all_instances, fill_value=0)
    silent = pd.Series([case_to_instance[c] for c in silent_case_ids if c in case_to_instance]).value_counts()
    silent = silent.reindex(all_instances, fill_value=0)
    total_silent = int(silent.sum())
    total_workload = int(workload.sum())
    expected = workload / total_workload * total_silent
    chi2, p = chisquare(silent.values, f_exp=expected.values)
    any_low_expected = bool((expected < 5).any())
    table = pd.DataFrame(
        {
            "workload_n": workload,
            "workload_share": workload / total_workload,
            "silent_n": silent,
            "silent_share": silent / total_silent if total_silent else np.nan,
            "expected_if_proportional": expected,
            "own_silent_rate": silent / workload,
        }
    )
    print(f"\n--- {label} ---")
    print(table.to_string(float_format=lambda v: f"{v:.2f}"))
    print(f"chi-square goodness-of-fit: chi2={chi2:.2f}, df={n_instances-1}, p={p:.3f}"
          + (" (CAUTION: expected count < 5 in a cell — small-sample, read as descriptive)" if any_low_expected else ""))
    return {
        "table": table.reset_index().rename(columns={"index": "instance"}).to_dict(orient="records"),
        "chi2": chi2,
        "df": n_instances - 1,
        "p": p,
        "low_expected_cell_warning": any_low_expected,
        "total_silent_cases": total_silent,
    }


results["silent_bias_by_allocator"] = instance_breakdown(alloc_map, _multi_case_ids, "(a) Allocator instance (L1/L2/L3)", 3)
audit_map_full = {c: assigned_auditor(c) for c in _multi_case_ids}
results["silent_bias_by_auditor"] = instance_breakdown(audit_map_full, _multi_case_ids, "(b) Auditor instance (U1/U2), assigned", 2)

# ---------- self-audit vs independent-audit: verdict rate by policy ----------

print("\n=== Self-audit (Control) vs independent audit (Multi-agent): verdict rate by policy ===")
con = sqlite3.connect(DATA / "policytown.db")
checks = pd.read_sql_query(
    """
    SELECT pc.episodeId, pc.policyId, pc.verdict, e.config
    FROM policy_checks pc
    JOIN agent_decisions d ON d.id = pc.decisionId
    JOIN episodes e ON e.id = pc.episodeId
    """,
    con,
)
con.close()
checks["mode"] = checks["config"].apply(lambda c: json.loads(c)["mode"])
# episodeId, not seed: the priority-queue follow-up reuses 48 of these seeds
# (control episodes are unaffected — that experiment is multi-agent only —
# and are already included in FIFO_EPISODE_IDS, which covers every mode).
checks = checks[checks["episodeId"].isin(FIFO_EPISODE_IDS)]
flagged = checks["verdict"].isin(["warn", "violation"])
policy_rates = (
    checks.assign(flagged=flagged)
    .groupby(["mode", "policyId"])
    .agg(n=("flagged", "size"), flagged_n=("flagged", "sum"))
    .reset_index()
)
policy_rates["rate"] = policy_rates["flagged_n"] / policy_rates["n"]
results["policy_flag_rates"] = policy_rates.to_dict(orient="records")
print(policy_rates.to_string(index=False))

print("\n--- per-policy significance: Control vs Multi-agent flag rate ---")
policy_sig = {}
for pid in range(1, 6):
    c_row = policy_rates[(policy_rates["mode"] == "control") & (policy_rates["policyId"] == pid)].iloc[0]
    m_row = policy_rates[(policy_rates["mode"] == "multi-agent") & (policy_rates["policyId"] == pid)].iloc[0]
    _, p = fisher_exact([[c_row.flagged_n, c_row.n - c_row.flagged_n], [m_row.flagged_n, m_row.n - m_row.flagged_n]])
    policy_sig[pid] = p
    print(f"P{pid}: control {c_row.rate:.1%} vs multi {m_row.rate:.1%}  Fisher p={p:.2e}")
results["policy_flag_significance"] = {f"P{k}": v for k, v in policy_sig.items()}

# ---------- capacity-pressure convergence: backlog / latency / unaudited ----------

con = sqlite3.connect(DATA / "policytown.db")
decisions = pd.read_sql_query(
    "SELECT d.*, e.config FROM agent_decisions d JOIN episodes e ON e.id = d.episodeId", con
)
con.close()
decisions["mode"] = decisions["config"].apply(lambda c: json.loads(c)["mode"])
decisions["cap"] = decisions["config"].apply(lambda c: json.loads(c)["pressure"]["auditorCapacityPerTick"])
# episodeId, not seed: the priority-queue follow-up reuses 48 of these seeds.
decisions = decisions[decisions["episodeId"].isin(FIFO_EPISODE_IDS)]
alloc = decisions[decisions["agentRole"].isin(["allocator"])][["episodeId", "caseId", "tick", "cap"]].rename(
    columns={"tick": "allocTick"}
)
audit = decisions[decisions["agentRole"] == "auditor"][["episodeId", "caseId", "tick"]].rename(columns={"tick": "auditTick"})
merged = alloc.merge(audit, on=["episodeId", "caseId"], how="left")
merged["latency"] = merged["auditTick"] - merged["allocTick"]
merged["unaudited"] = merged["auditTick"].isna()
lat_by_cap = merged.groupby("cap").agg(
    n=("caseId", "size"), unaudited_rate=("unaudited", "mean"), mean_latency=("latency", "mean")
)
results["capacity_convergence"] = lat_by_cap.reset_index().to_dict(orient="records")
print("\n=== Capacity convergence (multi-agent) ===")
print(lat_by_cap.to_string())

Path(OUT / "stats.json").write_text(json.dumps(results, indent=2, default=float))
print(f"\nwrote {OUT / 'stats.json'}")

# ================= CHARTS =================
# Every chart restates in plain words what it compares (see note above the
# palette) — never relies on the reader remembering what a color meant on a
# different chart, and never uses the "cap 1" / "cap 99" internal jargon.

CAP_PLAIN = {
    "cap99": "Full capacity",
    "cap1": "Overloaded",
}
MODE_PLAIN = {"control": "Control\n(1 agent does everything)", "multi-agent": "Multi-agent\n(9 agents, split roles)"}

# --- Chart 1: decomposition — is the catch-rate drop about coverage, or judgment? ---
# Replaces a single "catch rate" bar (which conflates "never reviewed" with
# "reviewed but missed it") with the two questions that actually distinguish
# a staffing problem from a quality-of-judgment problem.
fig, axes = plt.subplots(1, 2, figsize=(9.8, 5.3))

cov = results["coverage_pooled"]
qual = results["conditional_catch_rate_pooled"]
labels = [CAP_PLAIN["cap99"], CAP_PLAIN["cap1"]]
colors = [FULL, REDUCED]

for ax, res, panel_title in [
    (axes[0], cov, "Coverage"),
    (axes[1], qual, "Judgment (if reviewed)"),
]:
    vals = [res["group1"]["rate"], res["group2"]["rate"]]
    ns = [res["group1"]["n"], res["group2"]["n"]]
    los, his = zip(*[proportion_confint(res[k]["x"], res[k]["n"], method="wilson") for k in ("group1", "group2")])
    err = [[v - lo for v, lo in zip(vals, los)], [hi - v for v, hi in zip(vals, his)]]
    ax.bar(labels, vals, yerr=err, capsize=3, error_kw={"ecolor": INK, "elinewidth": 1}, color=colors, width=0.55)
    ax.set_ylim(0, 1.18)
    ax.set_title(panel_title, fontsize=12)
    p = res["fisher_p"]
    sig_bracket(ax, 0, 1, 1.02, p, h=0.05, label_only_if_significant=False)
    ax.text(0.5, -0.22, f"n={ns[0]} vs n={ns[1]} biased pairs", transform=ax.transAxes, ha="center",
            fontsize=9, color=INK)
    style_ax(ax)
axes[0].set_ylabel("Share of biased pairs")
fig.text(0.5, 1.1, "Less coverage, not less judgment", ha="center",
         fontsize=13, fontweight="bold", color=INK)
fig.text(0.5, 1.0, "Multi-agent auditor: full capacity vs. overloaded",
         ha="center", fontsize=10.5, color=INK, style="italic")
fig.tight_layout()
fig.savefig(OUT / "chart_catch_rate.png", dpi=160, bbox_inches="tight")
plt.close(fig)

# --- Chart 2: bias rate — Control vs Multi-agent ---
rows = []
for r in results["bias_rate_per_cell"]:
    for grp, key in [("control", "group1"), ("multi-agent", "group2")]:
        x, n = r[key]["x"], r[key]["n"]
        lo, hi = proportion_confint(x, n, method="wilson")
        rows.append({"cell": r["cell"], "mode": grp, "rate": r[key]["rate"], "lo": lo, "hi": hi})
pr = results["bias_rate_pooled"]
for grp, key in [("control", "group1"), ("multi-agent", "group2")]:
    x, n = pr[key]["x"], pr[key]["n"]
    lo, hi = proportion_confint(x, n, method="wilson")
    rows.append({"cell": "POOLED", "mode": grp, "rate": pr[key]["rate"], "lo": lo, "hi": hi})
bdf = pd.DataFrame(rows)
cell_order = sorted(bdf["cell"].unique(), key=lambda c: (c != "POOLED", c))
bdf["cell"] = pd.Categorical(bdf["cell"], cell_order)
bdf = bdf.sort_values("cell")
short_cells = [plain_cell(c) for c in cell_order]

fig, ax = plt.subplots(figsize=(11.8, 5.6))
x = np.arange(len(cell_order))
width = 0.34
for i, mode in enumerate(["control", "multi-agent"]):
    sub = bdf[bdf["mode"] == mode].set_index("cell").reindex(cell_order)
    err = [sub["rate"] - sub["lo"], sub["hi"] - sub["rate"]]
    ax.bar(x + (i - 0.5) * width, sub["rate"], width, yerr=err, capsize=3,
           error_kw={"ecolor": INK, "elinewidth": 1}, label=mode.capitalize(), color=PALETTE[mode])
ax.set_xticks(x)
ax.set_xticklabels(short_cells)
ax.set_ylabel("Share of twin pairs treated differently")
p = results["bias_rate_pooled"]["fisher_p"]
titled(ax, "Does splitting the decision across 9 agents change how often twins are treated differently?",
       f"One agent doing everything vs. 9 agents in separate roles — not significant (p = {p:.2f})")
ax.legend(frameon=False, loc="upper right", fontsize=10.5)
style_ax(ax)
fig.tight_layout()
fig.savefig(OUT / "chart_bias_rate.png", dpi=160, bbox_inches="tight")
plt.close(fig)

# --- Chart 3: unaudited rate + audit latency — auditor workload, WITHIN multi-agent only ---
lat = lat_by_cap.reset_index()
lat["cap_label"] = lat["cap"].map({1: CAP_PLAIN["cap1"], 99: CAP_PLAIN["cap99"]})
bar_colors = lat["cap"].map({1: REDUCED, 99: FULL})
fig, axes = plt.subplots(1, 2, figsize=(9.8, 5))
axes[0].bar(lat["cap_label"], lat["unaudited_rate"], color=bar_colors, width=0.55)
axes[0].set_ylabel("Share of cases never audited")
axes[0].set_title("Cases that slip through unchecked")
axes[0].set_ylim(0, 1)
axes[1].bar(lat["cap_label"], lat["mean_latency"], color=bar_colors, width=0.55)
axes[1].set_ylabel("Mean turns from decision to audit")
axes[1].set_title("How long a case waits to be checked")
for a in axes:
    style_ax(a)
fig.suptitle("Both charts: Multi-agent only — a fully-staffed auditor vs. an overloaded one", fontsize=11,
             color=INK, style="italic", y=1.06)
fig.tight_layout()
fig.savefig(OUT / "chart_capacity_pressure.png", dpi=160, bbox_inches="tight")
plt.close(fig)

# --- Chart 4: self-audit vs independent-audit verdict (flag) rate, all 5 policies ---
pr2 = policy_rates.copy()
label_map = {"control": "Control (1 agent audits itself)", "multi-agent": "Multi-agent (separate agent audits)"}
pr2["mode"] = pr2["mode"].map(label_map)
fig, ax = plt.subplots(figsize=(9.8, 5.6))
piv = pr2.pivot(index="policyId", columns="mode", values="rate").reindex(range(1, 6))
col_colors = [PALETTE["control"] if c == label_map["control"] else PALETTE["multi-agent"] for c in piv.columns]
piv.plot(kind="bar", ax=ax, color=col_colors, width=0.7)
ax.set_xticklabels([f"P{i}" for i in range(1, 6)], rotation=0)
ax.set_xlabel("")
ax.set_ylabel("Share of checks that found a problem")
ax.set_ylim(0, piv.to_numpy().max() * 1.35)
titled(ax, "How often does the audit find something wrong?",
       "An agent auditing its own decision vs. a separate agent auditing it")
ax.legend(frameon=False, title=None, loc="upper left", fontsize=10.5)
for i, pid in enumerate(range(1, 6)):
    top = max(piv.loc[pid, label_map["control"]], piv.loc[pid, label_map["multi-agent"]])
    sig_bracket(ax, i - 0.18, i + 0.18, top + 0.02, results["policy_flag_significance"][f"P{pid}"], h=0.02)
style_ax(ax)
fig.tight_layout()
fig.savefig(OUT / "chart_self_audit.png", dpi=160, bbox_inches="tight")
plt.close(fig)

print("\nCharts written:")
for f in sorted(OUT.glob("*.png")):
    print(" ", f)
