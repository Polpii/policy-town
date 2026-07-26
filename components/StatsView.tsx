import { EpisodeState, PolicyId } from "@/lib/types";
import { INK, SEVERITY, POLICY_RING, OUTCOME_COLOR, ROLE_STYLE, agentShortLabel } from "@/lib/theme";
import { POLICIES } from "@/lib/policies";

// The plain "just the numbers" alternative to the game board — same episode
// state, no characters, no motion. For reading exact counts rather than
// watching the flow.

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "#fff",
        border: `1.5px solid ${INK.hairline}`,
        borderRadius: 16,
        padding: "16px 18px",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: INK.muted,
          letterSpacing: 0.4,
          textTransform: "uppercase",
          marginBottom: 12,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function StatTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div
      style={{
        background: "#fff",
        border: `1.5px solid ${INK.hairline}`,
        borderRadius: 16,
        padding: "14px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        minWidth: 130,
        flex: "1 0 130px",
      }}
    >
      <span style={{ fontSize: 11, color: INK.muted, letterSpacing: 0.3, textTransform: "uppercase" }}>{label}</span>
      <span style={{ fontSize: 26, fontWeight: 600, color: tone ?? INK.primary }}>{value}</span>
    </div>
  );
}

function BarRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 && value > 0 ? Math.max((value / max) * 100, 3) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 12, color: INK.secondary, width: 110, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 16, background: "#f0efe9", borderRadius: 4 }}>
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: color,
            borderRadius: "0 4px 4px 0",
            transition: "width 0.3s ease",
          }}
        />
      </div>
      <span
        style={{
          fontSize: 12,
          color: INK.primary,
          fontWeight: 600,
          width: 26,
          textAlign: "right",
          flexShrink: 0,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}

const VERDICT_KEYS = ["ok", "warn", "violation"] as const;

function PolicyStackedBar({
  policyId,
  counts,
}: {
  policyId: PolicyId;
  counts: Record<(typeof VERDICT_KEYS)[number], number>;
}) {
  const policy = POLICIES.find((p) => p.id === policyId)!;
  const total = VERDICT_KEYS.reduce((sum, k) => sum + counts[k], 0);
  const active = VERDICT_KEYS.filter((k) => counts[k] > 0);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 12, color: INK.secondary, width: 190, flexShrink: 0 }}>
        P{policyId} · {policy.name}
      </span>
      <div style={{ flex: 1, height: 16, background: "#f0efe9", borderRadius: 4, display: "flex" }}>
        {active.map((k, i) => (
          <div
            key={k}
            style={{
              width: `${(counts[k] / total) * 100}%`,
              background: POLICY_RING[k] ?? INK.muted,
              borderRadius: i === active.length - 1 ? "0 4px 4px 0" : 0,
              marginRight: i === active.length - 1 ? 0 : 2,
            }}
          />
        ))}
      </div>
      <span
        style={{
          fontSize: 12,
          color: INK.primary,
          fontWeight: 600,
          width: 26,
          textAlign: "right",
          flexShrink: 0,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {total}
      </span>
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div style={{ display: "flex", gap: 14, marginBottom: 12 }}>
      {items.map((it) => (
        <div key={it.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: it.color, flexShrink: 0 }} />
          <span style={{ fontSize: 11.5, color: INK.secondary }}>{it.label}</span>
        </div>
      ))}
    </div>
  );
}

// Right-hand column of the Stats view: per-pair bias status + full live log.
function PairsAndLog({ episode }: { episode: EpisodeState }) {
  return (
    <div style={{ width: 360, flexShrink: 0, display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
      <Section title="Matched pairs (bias probe)">
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 190, overflowY: "auto" }}>
          {episode.pairStats.map((p) => {
            const members = episode.cases.filter((c) => c.case.pairId === p.pairId);
            const attrs = members.map((m) => m.case.demographicAttribute.value).join(" vs ");
            return (
              <div key={p.pairId} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    flexShrink: 0,
                    background: p.biasAffected === null ? "#d6d4c8" : p.biasAffected ? "#d03b3b" : "#0ca30c",
                  }}
                />
                <span style={{ color: INK.secondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {attrs}
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    fontWeight: 600,
                    flexShrink: 0,
                    color: p.biasAffected === null ? INK.muted : p.biasAffected ? "#d03b3b" : "#0ca30c",
                  }}
                >
                  {p.biasAffected === null ? "in flight" : p.biasAffected ? "differs" : "same"}
                </span>
              </div>
            );
          })}
        </div>
      </Section>
      <div style={{ background: "#fff", border: `1.5px solid ${INK.hairline}`, borderRadius: 16, padding: "16px 18px", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: INK.muted, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 10 }}>
          Live log
        </div>
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 9 }}>
          {episode.log.map((entry, i) => (
            <div key={i} style={{ display: "flex", gap: 7, fontSize: 11.5, lineHeight: 1.45 }}>
              <span style={{ color: INK.muted, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>t{entry.tick}</span>
              <span
                title={entry.agentId}
                style={{ width: 7, height: 7, borderRadius: "50%", background: ROLE_STYLE[entry.agentRole].color, flexShrink: 0, marginTop: 4 }}
              />
              <span style={{ color: INK.secondary }}>
                <strong style={{ color: INK.primary }}>{agentShortLabel(entry.agentId)}</strong> · {entry.caseId.slice(5, 16)}: {entry.message}
              </span>
            </div>
          ))}
          {episode.log.length === 0 && <div style={{ fontSize: 12, color: INK.muted }}>No decisions yet.</div>}
        </div>
      </div>
    </div>
  );
}

export function StatsView({ episode }: { episode: EpisodeState | null }) {
  if (!episode) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: INK.muted, fontSize: 13 }}>
        Start a new episode to see its numbers here.
      </div>
    );
  }

  const total = episode.cases.length;
  const resolved = episode.cases.filter((c) => c.zone === "audited").length;

  const resolvedPairs = episode.pairStats.filter((p) => p.biasAffected !== null);
  const affectedPairs = resolvedPairs.filter((p) => p.biasAffected);
  const biasRate = resolvedPairs.length ? Math.round((affectedPairs.length / resolvedPairs.length) * 100) : null;

  const ZONE_ORDER: { key: "incoming" | "assessed" | "allocated" | "audited"; label: string }[] = [
    { key: "incoming", label: "Incoming" },
    { key: "assessed", label: "Assessed" },
    { key: "allocated", label: "Allocated" },
    { key: "audited", label: "Audited" },
  ];
  const zoneCounts = ZONE_ORDER.map((z) => ({ ...z, value: episode.cases.filter((c) => c.zone === z.key).length }));
  const zoneMax = Math.max(...zoneCounts.map((z) => z.value), 1);

  const OUTCOME_ORDER: { key: "allocated" | "denied" | "queued"; label: string; color: string }[] = [
    { key: "allocated", label: "Allocated", color: OUTCOME_COLOR.allocated },
    { key: "queued", label: "Queued", color: OUTCOME_COLOR.queued },
    { key: "denied", label: "Denied", color: OUTCOME_COLOR.denied },
  ];
  const outcomeCounts = OUTCOME_ORDER.map((o) => ({
    ...o,
    value: episode.cases.filter((c) => c.allocationOutcome === o.key).length,
  }));
  const outcomeMax = Math.max(...outcomeCounts.map((o) => o.value), 1);

  const severityCounts = ([1, 2, 3, 4] as const).map((sev) => ({
    sev,
    label: SEVERITY[sev].label,
    color: SEVERITY[sev].fill,
    value: episode.cases.filter((c) => c.assessedSeverity === sev).length,
  }));
  const severityMax = Math.max(...severityCounts.map((s) => s.value), 1);

  const policyCounts: Record<PolicyId, Record<(typeof VERDICT_KEYS)[number], number>> = {
    1: { ok: 0, warn: 0, violation: 0 },
    2: { ok: 0, warn: 0, violation: 0 },
    3: { ok: 0, warn: 0, violation: 0 },
    4: { ok: 0, warn: 0, violation: 0 },
    5: { ok: 0, warn: 0, violation: 0 },
  };
  for (const c of episode.cases) {
    for (const chk of c.policyChecks) {
      if (chk.verdict === "ok" || chk.verdict === "warn" || chk.verdict === "violation") {
        policyCounts[chk.policyId][chk.verdict]++;
      }
    }
  }
  const anyPolicyChecks = Object.values(policyCounts).some((c) => c.ok + c.warn + c.violation > 0);

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", gap: 14, minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: 4 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <StatTile label="Tick" value={String(episode.tick)} />
        <StatTile
          label="Beds"
          value={String(episode.resourceStock)}
          tone={episode.resourceStock <= 0 ? "#d03b3b" : undefined}
        />
        <StatTile
          label="Surge index"
          value={String(Math.round(episode.surgeIndex))}
          tone={episode.surgeIndex > 100 ? "#fab219" : undefined}
        />
        <StatTile label="Backlog" value={String(episode.backlog)} tone={episode.backlog > 0 ? "#fab219" : undefined} />
        <StatTile label="Cases resolved" value={`${resolved}/${total}`} />
        <StatTile
          label="Bias-affected pairs"
          value={biasRate === null ? "—" : `${biasRate}%`}
          tone={biasRate !== null && biasRate > 0 ? "#d03b3b" : undefined}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Section title="Cases per zone">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {zoneCounts.map((z) => (
              <BarRow key={z.key} label={z.label} value={z.value} max={zoneMax} color={INK.secondary} />
            ))}
          </div>
        </Section>

        <Section title="Allocation outcomes">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {outcomeCounts.map((o) => (
              <BarRow key={o.key} label={o.label} value={o.value} max={outcomeMax} color={o.color} />
            ))}
          </div>
        </Section>

        <Section title="Assessed severity">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {severityCounts.map((s) => (
              <BarRow key={s.sev} label={s.label} value={s.value} max={severityMax} color={s.color} />
            ))}
          </div>
        </Section>

        <Section title="Policy verdicts">
          {anyPolicyChecks ? (
            <>
              <Legend
                items={[
                  { label: "OK", color: POLICY_RING.ok! },
                  { label: "Warn", color: POLICY_RING.warn! },
                  { label: "Violation", color: POLICY_RING.violation! },
                ]}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {([1, 2, 3, 4, 5] as const).map((id) => (
                  <PolicyStackedBar key={id} policyId={id} counts={policyCounts[id]} />
                ))}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: INK.muted }}>No audits recorded yet.</div>
          )}
        </Section>
      </div>
      </div>
      <PairsAndLog episode={episode} />
    </div>
  );
}
