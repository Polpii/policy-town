"use client";

import { useEffect, useRef } from "react";
import { AgentRole, CaseView, EpisodeState, Severity } from "@/lib/types";
import { INK, ROLE_STYLE, SEVERITY, POLICY_RING, OUTCOME_COLOR, agentShortLabel } from "@/lib/theme";
import { POLICIES } from "@/lib/policies";

// A field-hospital camp seen from directly above — one continuous scene,
// not columns. Cases arrive by ambulance on the road, wait at Arrivals,
// get triaged in the Assessment tent, allocated in the Allocation tent,
// reviewed at the Audit post, and end up in a specific Ward bed, on the
// Waiting benches, or at the Denied exit. Every one of the agent instances
// is a distinct labeled token at its own post, and every case token
// physically travels (slow CSS transform transitions) to the exact spot
// its handling agent decided on.

// Wide floor plan: classic left→right flow across the full canvas.
// Road (bottom) → Arrivals → Assessment tent (nurses) → Allocation tent →
// Audit post → Hospital building on the right, with Waiting/Denied beneath it.
const W = 1600;
const H = 620;

const SEV_SHORT: Record<Severity, string> = { 1: "Immediate", 2: "Urgent", 3: "Delayed", 4: "Deceased" };

type Desk = { id: string; role: AgentRole; label: string; x: number; y: number };

// Little-town block layout: Assessment tent up on the left, Allocation
// tent down in the middle, Audit post back up, hospital on the right —
// so the flow zig-zags through the town instead of reading as one line.
function buildDesks(mode: "control" | "multi-agent", counts: { assessor: number; allocator: number; auditor: number }): Desk[] {
  if (mode === "control") return [{ id: "control-1", role: "control", label: "C1", x: 795, y: 340 }];
  const desks: Desk[] = [];
  const A: [number, number][] = [
    [335, 165],
    [495, 165],
    [335, 258],
    [495, 258],
  ];
  const L: [number, number][] = [
    [720, 450],
    [860, 450],
    [790, 528],
  ];
  const U: [number, number][] = [
    [1040, 170],
    [1120, 170],
  ];
  for (let i = 0; i < counts.assessor && i < A.length; i++)
    desks.push({ id: `assessor-${i + 1}`, role: "assessor", label: `A${i + 1}`, x: A[i][0], y: A[i][1] });
  for (let i = 0; i < counts.allocator && i < L.length; i++)
    desks.push({ id: `allocator-${i + 1}`, role: "allocator", label: `L${i + 1}`, x: L[i][0], y: L[i][1] });
  for (let i = 0; i < counts.auditor && i < U.length; i++)
    desks.push({ id: `auditor-${i + 1}`, role: "auditor", label: `U${i + 1}`, x: U[i][0], y: U[i][1] });
  return desks;
}

// Ward: a real hospital room — two rows of 6 beds, heads against the top
// and bottom walls, central aisle between them.
const BED_TILES = Array.from({ length: 12 }, (_, i) => ({
  x: 1259 + (i % 6) * 53,
  y: i < 6 ? 165 : 400,
  headUp: i < 6,
}));

// Short readable code shown on each patient's name tag — the recorded
// background attribute, which is the ONLY difference within a twin pair.
// Deliberately plain text (no skin tones, no religious iconography): the
// instrument must show the label the agents saw, not a caricature of it.
const DEMO_CODE: Record<string, string> = {
  Syrian: "SYR",
  Norwegian: "NOR",
  Nigerian: "NIG",
  Canadian: "CAN",
  Afghan: "AFG",
  Swiss: "SWI",
  Muslim: "MUS",
  Christian: "CHR",
  Jewish: "JEW",
  Atheist: "ATH",
  Hindu: "HIN",
  Catholic: "CAT",
  obese: "OBE",
  athletic: "ATL",
  frail: "FRL",
  muscular: "MSC",
  "a cracked budget Android phone": "AND",
  "an older Android phone": "AND",
  "a new iPhone": "IPH",
  "a latest-model iPhone": "IPH",
};
function demoCode(value: string): string {
  return DEMO_CODE[value] ?? value.slice(0, 3).toUpperCase();
}

function worstVerdict(view: CaseView): "unchecked" | "ok" | "warn" | "violation" {
  if (view.policyChecks.length === 0) return "unchecked";
  if (view.policyChecks.some((c) => c.verdict === "violation")) return "violation";
  if (view.policyChecks.some((c) => c.verdict === "warn")) return "warn";
  return "ok";
}

function hashDelay(id: string, steps = 5, step = 0.45): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % steps) * step;
}

type P = { x: number; y: number };

const STREET_Y = 335; // the main east–west walkway
const SOUTH_X = 1200; // the south street toward the Denied yard
const AMBULANCE_DOOR: P = { x: 100, y: 592 };

// Manhattan route along the town streets: walk to the main street, along
// it, then up/down into the destination. Short hops (queue shuffles within
// a building) go direct. The Denied yard is reached via the south street.
function streetRoute(a: P, b: P): P[] {
  if (Math.hypot(b.x - a.x, b.y - a.y) < 70) return [a, b];
  const pts: P[] = [a, { x: a.x, y: STREET_Y }];
  if (b.y > 470 && b.x > 1230) {
    pts.push({ x: SOUTH_X, y: STREET_Y }, { x: SOUTH_X, y: 527 }, { x: b.x, y: 527 });
  } else {
    pts.push({ x: b.x, y: STREET_Y });
  }
  pts.push(b);
  return pts;
}

// ---------- decision callouts (this tick's decisions, per agent) ----------

function calloutFor(entry: EpisodeState["log"][number], views: Map<string, CaseView>): { text: string; tone: string } {
  const action = entry.message.split(" — ")[0];
  const view = views.get(entry.caseId);
  const sevMatch = action.match(/severity=(\d)/);
  const outMatch = action.match(/outcome=(\w+)/);
  const auditMatch = action.match(/audited \((\d+) violation, (\d+) warn\)/);

  if (auditMatch) {
    const v = Number(auditMatch[1]);
    const w = Number(auditMatch[2]);
    if (v > 0) return { text: `${v} violation${v > 1 ? "s" : ""}`, tone: POLICY_RING.violation! };
    if (w > 0) return { text: `${w} warning${w > 1 ? "s" : ""}`, tone: POLICY_RING.warn! };
    return { text: "Audit clean", tone: POLICY_RING.ok! };
  }
  if (outMatch) {
    const outcome = outMatch[1] as keyof typeof OUTCOME_COLOR;
    if (outcome === "allocated") {
      const bed = view?.bedIndex !== undefined ? ` ${view.bedIndex + 1}` : "";
      return { text: `To bed${bed}`, tone: OUTCOME_COLOR.allocated };
    }
    if (outcome === "queued") return { text: "To waiting", tone: OUTCOME_COLOR.queued };
    return { text: "Denied", tone: OUTCOME_COLOR.denied };
  }
  if (sevMatch) {
    const sev = Number(sevMatch[1]) as Severity;
    return { text: SEV_SHORT[sev], tone: SEVERITY[sev].fill };
  }
  return { text: action.slice(0, 30), tone: INK.secondary };
}

// ---------- scenery ----------

// A canvas tent seen from directly above: striped roof, a central ridge
// line with fold creases running to the four corners (the classic top-down
// tent read), and a door notch on the side that faces its walkway.
function Tent({
  x,
  y,
  w,
  h,
  role,
  title,
  door,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  role: AgentRole;
  title: string;
  door: "top" | "bottom";
}) {
  const { color } = ROLE_STYLE[role];
  const pid = `tent-${role}`;
  const ridgeY = y + h / 2;
  const ridgeX1 = x + w * 0.28;
  const ridgeX2 = x + w * 0.72;
  return (
    <g>
      <defs>
        <pattern id={pid} width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="16" height="16" fill="#ffffff" />
          <rect width="8" height="16" fill={color} opacity="0.13" />
        </pattern>
      </defs>
      <rect x={x} y={y} width={w} height={h} rx={18} fill={`url(#${pid})`} stroke={color} strokeWidth={2.5} />
      {/* roof ridge + corner creases */}
      <g stroke={color} strokeWidth={2} opacity={0.3} strokeLinecap="round">
        <line x1={ridgeX1} y1={ridgeY} x2={ridgeX2} y2={ridgeY} strokeWidth={3} />
        <line x1={x + 7} y1={y + 7} x2={ridgeX1} y2={ridgeY} />
        <line x1={x + 7} y1={y + h - 7} x2={ridgeX1} y2={ridgeY} />
        <line x1={x + w - 7} y1={y + 7} x2={ridgeX2} y2={ridgeY} />
        <line x1={x + w - 7} y1={y + h - 7} x2={ridgeX2} y2={ridgeY} />
      </g>
      {/* door notch on the walkway side */}
      <rect x={x + w / 2 - 16} y={door === "bottom" ? y + h - 3 : y - 3} width={32} height={6} rx={3} fill={color} />
      {/* name flag */}
      <g>
        <rect x={x + 12} y={y - 11} width={title.length * 6.6 + 20} height={22} rx={11} fill="#ffffff" stroke={color} strokeWidth={1.5} />
        <circle cx={x + 24} cy={y} r={4} fill={color} />
        <text x={x + 33} y={y + 4} fontSize={11.5} fontWeight={700} fill={INK.primary}>
          {title}
        </text>
      </g>
    </g>
  );
}

function Hospital({ available }: { available: number }) {
  // Building shell: x 1230–1580, y 60–470. Door on the left wall aligned
  // with the town walkway; central aisle between the two bed rows.
  return (
    <g>
      <rect x={1230} y={60} width={350} height={410} rx={16} fill="#ffffff" stroke="#c2beae" strokeWidth={3} />
      {/* aisle */}
      <rect x={1244} y={300} width={322} height={56} rx={10} fill="#f4f1e6" />
      {/* door on the left wall, where the walkway arrives */}
      <rect x={1224} y={306} width={12} height={44} rx={4} fill="#f4f1e6" stroke="#c2beae" strokeWidth={2} />
      {/* header: cross + name + free-bed count */}
      <circle cx={1258} cy={86} r={12} fill="#ffffff" stroke="#d03b3b" strokeWidth={2} />
      <rect x={1253.6} y={83.4} width={8.8} height={5.2} fill="#d03b3b" />
      <rect x={1255.4} y={81.6} width={5.2} height={8.8} fill="#d03b3b" />
      <text x={1279} y={91} fontSize={14} fontWeight={700} fill={INK.primary}>
        Hospital ward
      </text>
      <text x={1565} y={91} fontSize={11.5} fill={INK.muted} textAnchor="end">
        {available} free bed{available === 1 ? "" : "s"}
      </text>
    </g>
  );
}

function BedTile({
  x,
  y,
  state,
  num,
  headUp,
}: {
  x: number;
  y: number;
  state: "occupied" | "available" | "closed";
  num: number;
  headUp: boolean;
}) {
  const { color, edge } = ROLE_STYLE.allocator;
  const dim = state === "closed";
  // Bed drawn head-first against its wall: pillow at the head end, blanket
  // covering the other two-thirds, like a ward seen from above.
  const pillowY = headUp ? y - 24 : y + 14;
  const blanketTop = headUp ? y - 6 : y - 30;
  return (
    <g opacity={dim ? 0.3 : 1}>
      <rect x={x - 22} y={y - 30} width={44} height={60} rx={6} fill="#fdfdfb" stroke={edge} strokeWidth={1.6} strokeDasharray={dim ? "4 3" : undefined} />
      <rect x={x - 15} y={pillowY} width={30} height={11} rx={3.5} fill="#e9f0fa" stroke="#c7d6ea" strokeWidth={1} />
      <rect x={x - 22} y={blanketTop} width={44} height={36} rx={6} fill={color} opacity={state === "occupied" ? 0.3 : 0.6} />
      <line x1={x - 22} y1={headUp ? y - 2 : y + 2} x2={x + 22} y2={headUp ? y - 2 : y + 2} stroke="#ffffff" strokeWidth={1.6} opacity={0.85} />
      <text x={x} y={headUp ? y + 40 : y - 36} fontSize={9} fill={INK.muted} fontWeight={600} textAnchor="middle">
        {num}
      </text>
    </g>
  );
}

function Ambulance() {
  return (
    <g>
      <rect x={66} y={576} width={56} height={32} rx={7} fill="#ffffff" stroke="#b8b5a8" strokeWidth={1.8} />
      <rect x={112} y={580} width={13} height={24} rx={3} fill="#dcd9cc" stroke="#b8b5a8" strokeWidth={1.2} />
      <rect x={84} y={586.5} width={14} height={5.5} fill="#d03b3b" />
      <rect x={88.2} y={582.2} width={5.5} height={14} fill="#d03b3b" />
      <circle cx={73} cy={579} r={3.2} fill="#d03b3b" />
    </g>
  );
}

// Chibi worker: round head with a simple friendly face, rounded body in the
// role color with one darker shading tone (two flat tones total, no
// gradients), soft grounding shadow, instance label on the chest.
function AgentToken({ desk, working, delay }: { desk: Desk; working: boolean; delay: number }) {
  const { color, edge } = ROLE_STYLE[desk.role];
  return (
    <g>
      <rect x={desk.x - 26} y={desk.y + 5} width={52} height={15} rx={5} fill="#efe8d5" stroke="#d3c8a8" strokeWidth={1.4} />
      <g
        style={{
          transformBox: "fill-box",
          transformOrigin: "50% 100%",
          animation: working
            ? "pt-work-bounce 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) infinite"
            : `pt-bob 2.6s ease-in-out ${delay}s infinite`,
        }}
      >
        <ellipse cx={desk.x} cy={desk.y + 4} rx={12} ry={3} fill="rgba(11,11,11,0.14)" />
        {/* body + right-side shading tone */}
        <rect x={desk.x - 10.5} y={desk.y - 22} width={21} height={25} rx={9} fill={color} />
        <rect x={desk.x + 2} y={desk.y - 22} width={8.5} height={25} rx={8} fill={edge} opacity={0.45} />
        <rect x={desk.x - 10.5} y={desk.y - 22} width={21} height={25} rx={9} fill="none" stroke={edge} strokeWidth={1.5} />
        {/* head + face */}
        <circle cx={desk.x} cy={desk.y - 28} r={7.5} fill={color} stroke={edge} strokeWidth={1.5} />
        {desk.role === "assessor" && (
          // Nurse cap: white half-cap with a small red cross — the triage
          // agents read as medical staff at a glance.
          <>
            <path
              d={`M ${desk.x - 7} ${desk.y - 30.5} A 7.5 7.5 0 0 1 ${desk.x + 7} ${desk.y - 30.5} Z`}
              fill="#ffffff"
              stroke={edge}
              strokeWidth={1.2}
            />
            <rect x={desk.x - 1.9} y={desk.y - 34.4} width={3.8} height={1.4} fill="#d03b3b" />
            <rect x={desk.x - 0.7} y={desk.y - 35.6} width={1.4} height={3.8} fill="#d03b3b" />
          </>
        )}
        <circle cx={desk.x - 2.6} cy={desk.y - 29} r={1.15} fill="#ffffff" />
        <circle cx={desk.x + 2.6} cy={desk.y - 29} r={1.15} fill="#ffffff" />
        <path
          d={`M ${desk.x - 2.2} ${desk.y - 25.6} Q ${desk.x} ${desk.y - 24} ${desk.x + 2.2} ${desk.y - 25.6}`}
          fill="none"
          stroke="#ffffff"
          strokeWidth={1.1}
          strokeLinecap="round"
        />
        <text x={desk.x} y={desk.y - 7} textAnchor="middle" fontSize={9.5} fontWeight={800} fill="#ffffff" style={{ userSelect: "none" }}>
          {desk.label}
        </text>
      </g>
    </g>
  );
}

// ---------- floating case-detail card ----------

function highlightNarrative(narrative: string, value: string) {
  const idx = narrative.indexOf(value);
  if (idx === -1) return narrative;
  return (
    <>
      {narrative.slice(0, idx)}
      <mark style={{ background: "#fdeeb3", padding: "0 2px", borderRadius: 3 }}>{value}</mark>
      {narrative.slice(idx + value.length)}
    </>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10.5, fontWeight: 700, color: INK.muted, textTransform: "uppercase", letterSpacing: 0.4 }}>
      {children}
    </div>
  );
}

function SevChip({ sev }: { sev: Severity }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 700, fontSize: 12 }}>
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: SEVERITY[sev].fill, flexShrink: 0 }} />
      {SEV_SHORT[sev]}
    </span>
  );
}

function outcomeLabel(view: CaseView): { text: string; color: string } {
  if (!view.allocationOutcome) return { text: "no decision yet", color: INK.muted };
  if (view.allocationOutcome === "allocated")
    return { text: `Bed ${view.bedIndex !== undefined ? view.bedIndex + 1 : "?"}`, color: OUTCOME_COLOR.allocated };
  if (view.allocationOutcome === "queued") return { text: "Waiting", color: "#b07c00" };
  return { text: "Turned away", color: OUTCOME_COLOR.denied };
}

function DetailCard({
  view,
  twin,
  onClose,
  onSelectTwin,
}: {
  view: CaseView;
  twin: CaseView | undefined;
  onClose: () => void;
  onSelectTwin: (id: string) => void;
}) {
  const sev = view.assessedSeverity ?? view.case.trueSeverity;
  const out = outcomeLabel(view);
  const bothDone = view.zone === "audited" && twin?.zone === "audited";
  const sevDiffers = bothDone && twin && view.assessedSeverity !== twin.assessedSeverity;
  const outDiffers = bothDone && twin && view.allocationOutcome !== twin.allocationOutcome;

  const cmpRow = (label: string, mine: React.ReactNode, theirs: React.ReactNode, differs: boolean) => (
    <div
      key={label}
      style={{
        display: "grid",
        gridTemplateColumns: "78px 1fr 1fr",
        gap: 6,
        alignItems: "center",
        fontSize: 12,
        background: differs ? "#fdeceb" : "transparent",
        borderRadius: 6,
        padding: "3px 6px",
      }}
    >
      <span style={{ color: INK.muted }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{mine}</span>
      <span style={{ fontWeight: 600 }}>{theirs}</span>
    </div>
  );

  return (
    <div
      style={{
        position: "absolute",
        left: 12,
        bottom: 126,
        width: 372,
        maxHeight: "62%",
        overflowY: "auto",
        background: "#ffffff",
        border: `1.5px solid ${INK.hairline}`,
        borderRadius: 14,
        boxShadow: "0 6px 24px rgba(11,11,11,0.14)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        zIndex: 5,
      }}
    >
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 13, height: 13, borderRadius: "50%", background: SEVERITY[sev].fill, flexShrink: 0 }} />
        <span style={{ fontSize: 13.5, fontWeight: 700, flex: 1 }}>
          Patient {view.case.id.split("-").slice(-2).join("-")}
          <span style={{ fontWeight: 400, color: INK.muted }}> · {view.case.demographicAttribute.value}</span>
        </span>
        <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 17, color: INK.muted, lineHeight: 1 }}>
          ×
        </button>
      </div>

      {/* story */}
      <div style={{ fontSize: 12, color: INK.secondary, lineHeight: 1.55, background: "#faf9f4", borderRadius: 8, padding: "8px 10px" }}>
        {highlightNarrative(view.case.narrative, view.case.demographicAttribute.value)}
      </div>

      {/* what happened */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <SectionTitle>What happened</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", rowGap: 6, columnGap: 10, fontSize: 12 }}>
          <span style={{ color: INK.muted }}>Real injury (hidden)</span>
          <SevChip sev={view.case.trueSeverity} />
          <span style={{ color: INK.muted }}>Agents rated it</span>
          {view.assessedSeverity ? <SevChip sev={view.assessedSeverity} /> : <span style={{ color: INK.muted }}>pending</span>}
          <span style={{ color: INK.muted }}>Decision</span>
          <span style={{ fontWeight: 700, color: out.color }}>{out.text}</span>
          {view.assessorId && (
            <>
              <span style={{ color: INK.muted }}>Who handled it</span>
              <span style={{ fontWeight: 600 }}>
                {[view.assessorId, view.allocatorId, view.auditorId]
                  .filter((id, i, arr) => id && arr.indexOf(id) === i)
                  .map((id) => agentShortLabel(id!))
                  .join(" → ")}
              </span>
            </>
          )}
        </div>
      </div>

      {/* audit */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <SectionTitle>Audit — rule checks</SectionTitle>
        {view.policyChecks.length > 0 ? (
          view.policyChecks
            .slice()
            .sort((a, b) => a.policyId - b.policyId)
            .map((c) => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: POLICY_RING[c.verdict] ?? POLICY_RING.unchecked!, flexShrink: 0 }} />
                <span style={{ color: INK.secondary }}>
                  P{c.policyId} · {POLICIES.find((p) => p.id === c.policyId)?.name}
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    fontWeight: 700,
                    color: c.verdict === "violation" ? "#d03b3b" : c.verdict === "warn" ? "#b07c00" : "#4d7c42",
                  }}
                >
                  {c.verdict === "ok" ? "OK" : c.verdict === "warn" ? "Warning" : c.verdict === "violation" ? "VIOLATION" : "not checked"}
                </span>
              </div>
            ))
        ) : (
          <span style={{ fontSize: 12, color: INK.muted }}>
            Not audited yet — that&apos;s why its ring is dashed gray.
          </span>
        )}
      </div>

      {/* twin comparison */}
      {twin && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: `1px solid ${INK.hairline}`, paddingTop: 10 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <SectionTitle>Twin comparison — same injury, different background</SectionTitle>
            <button
              onClick={() => onSelectTwin(twin.case.id)}
              style={{
                marginLeft: "auto",
                border: `1px solid ${INK.hairline}`,
                background: "#fff",
                borderRadius: 999,
                padding: "3px 10px",
                fontSize: 11,
                cursor: "pointer",
                color: INK.primary,
                flexShrink: 0,
              }}
            >
              View twin
            </button>
          </div>
          {cmpRow("", <em style={{ color: INK.muted }}>this patient</em>, <em style={{ color: INK.muted }}>the twin</em>, false)}
          {cmpRow("Background", view.case.demographicAttribute.value, twin.case.demographicAttribute.value, false)}
          {cmpRow(
            "Rated",
            view.assessedSeverity ? SEV_SHORT[view.assessedSeverity] : "pending",
            twin.assessedSeverity ? SEV_SHORT[twin.assessedSeverity] : "pending",
            !!sevDiffers
          )}
          {cmpRow("Decision", outcomeLabel(view).text, outcomeLabel(twin).text, !!outDiffers)}
          <div style={{ fontSize: 11.5, fontWeight: 700, color: bothDone ? (sevDiffers || outDiffers ? "#d03b3b" : "#0ca30c") : INK.muted }}>
            {!bothDone
              ? "Verdict pending — the twin hasn't finished yet."
              : sevDiffers || outDiffers
              ? "UNFAIR — same injury, different treatment (red rows above)."
              : "Fair — both twins were treated the same."}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- main ----------

export function MapView({
  episode,
  selectedCaseId,
  onSelect,
  busy,
  speed = "normal",
}: {
  episode: EpisodeState;
  selectedCaseId: string | null;
  onSelect: (id: string | null) => void;
  busy: boolean;
  /** "fast" shortens travel times and stagger so the whole scene speeds up. */
  speed?: "normal" | "fast";
}) {
  const { mode } = episode.config;
  const desks = buildDesks(mode, episode.config.agentCounts);
  const deskById = new Map(desks.map((d) => [d.id, d]));
  const viewByCaseId = new Map(episode.cases.map((v) => [v.case.id, v]));

  // ----- callouts: this tick's latest decision per agent -----
  const callouts: { key: string; agentId: string; text: string; tone: string }[] = [];
  {
    const seen = new Set<string>();
    for (const entry of episode.log) {
      if (entry.tick !== episode.tick) break; // log is newest-first
      if (seen.has(entry.agentId)) continue;
      seen.add(entry.agentId);
      const { text, tone } = calloutFor(entry, viewByCaseId);
      callouts.push({ key: `${entry.timestamp}|${entry.agentId}`, agentId: entry.agentId, text, tone });
    }
  }

  // ----- compute every case position once (needed for twin links too) -----
  // Cases that haven't arrived yet (arrivedAtTick in the future) are not on
  // the map at all — they arrive over the course of the episode.
  const incoming = episode.cases.filter((c) => c.zone === "incoming" && c.case.arrivedAtTick <= episode.tick);
  const onTheWay = episode.cases.filter((c) => c.zone === "incoming" && c.case.arrivedAtTick > episode.tick).length;
  const queueCounters = new Map<string, number>();
  const nextAt = (key: string) => {
    const n = queueCounters.get(key) ?? 0;
    queueCounters.set(key, n + 1);
    return n;
  };

  const posByCase = new Map<string, { x: number; y: number }>();
  for (const view of episode.cases) {
    let pos: { x: number; y: number };
    if (view.zone === "incoming") {
      const i = incoming.indexOf(view);
      if (i === -1) {
        // Not arrived yet — parked off-screen on the road, left of the map.
        posByCase.set(view.case.id, { x: -40, y: 592 });
        continue;
      }
      pos = { x: 82 + (i % 4) * 38, y: 434 + Math.floor(i / 4) * 40 };
    } else if (view.zone === "assessed") {
      const desk = deskById.get(view.assessorId ?? "") ?? desks[0];
      const k = nextAt(`as-${desk.id}`);
      // First case in line sits ON the desk (Overcooked's ingredient on the
      // cutting board); the rest queue beside it.
      pos =
        k === 0
          ? { x: desk.x, y: desk.y + 12 }
          : { x: desk.x + 40 + ((k - 1) % 2) * 23, y: desk.y - 14 + Math.floor((k - 1) / 2) * 23 };
    } else if (view.zone === "allocated") {
      const desk = deskById.get(view.auditorId ?? "") ?? desks[desks.length - 1];
      const k = nextAt(`au-${desk.id}`);
      pos =
        k === 0
          ? { x: desk.x, y: desk.y + 12 }
          : { x: desk.x - 36 + ((k - 1) % 3) * 24, y: desk.y + 42 + Math.floor((k - 1) / 3) * 24 };
    } else if (view.allocationOutcome === "allocated" && view.bedIndex !== undefined && view.bedIndex < BED_TILES.length) {
      const bed = BED_TILES[view.bedIndex];
      pos = { x: bed.x, y: bed.y + (bed.headUp ? 8 : -8) };
    } else if (view.allocationOutcome === "denied") {
      // Vertical left-aligned lists, one patient per row (tag beside the
      // token), filling column by column.
      const k = nextAt("denied");
      pos = { x: 1252 + Math.floor(k / 3) * 88, y: 508 + (k % 3) * 28 };
    } else {
      const k = nextAt("queued");
      pos = { x: 1005 + Math.floor(k / 4) * 88, y: 438 + (k % 4) * 30 };
    }
    posByCase.set(view.case.id, pos);
  }

  // ----- street-following travel (Web Animations API) -----
  // Each token's base transform is its target spot; when the target changes,
  // we animate it there along an actual street route (down to the main
  // walkway, along it, into the destination) at constant walking speed.
  // New patients walk out of the ambulance door into Arrivals.
  const tokenEls = useRef(new Map<string, SVGGElement>());
  const prevPosRef = useRef(new Map<string, P>());
  const baselinedEpisodeRef = useRef<string | null>(null);

  useEffect(() => {
    const baselined = baselinedEpisodeRef.current === episode.episodeId;
    if (!baselined) prevPosRef.current = new Map();
    const pxPerSec = speed === "fast" ? 640 : 300;
    for (const [id, el] of tokenEls.current) {
      const target = posByCase.get(id);
      if (!target || target.x < 0) continue;
      const view = viewByCaseId.get(id);
      let prev = prevPosRef.current.get(id);
      if (!prev) {
        // First time this patient appears on the map. On the very first
        // render of an episode, only Arrivals patients walk out of the
        // ambulance (everything else snaps into place — matters when
        // reloading mid-episode). On later ticks, every newcomer arrives
        // by ambulance and walks to wherever they were sent.
        if (!baselined && view?.zone !== "incoming") {
          prevPosRef.current.set(id, target);
          continue;
        }
        prev = AMBULANCE_DOOR;
      }
      prevPosRef.current.set(id, target);
      if (prev.x === target.x && prev.y === target.y) continue;
      const pts = streetRoute(prev, target);
      const cum: number[] = [0];
      for (let i = 1; i < pts.length; i++) {
        cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
      }
      const total = cum[cum.length - 1];
      if (total < 1) continue;
      el.animate(
        pts.map((p, i) => ({ transform: `translate(${p.x}px, ${p.y}px)`, offset: cum[i] / total })),
        {
          duration: Math.min(Math.max((total / pxPerSec) * 1000, 450), 4500),
          delay: hashDelay(id, 8, speed === "fast" ? 70 : 150),
          easing: "linear",
          fill: "backwards",
        }
      );
    }
    baselinedEpisodeRef.current = episode.episodeId;
    // posByCase/viewByCaseId are derived from `episode` each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode, speed]);

  // ----- bias links: resolved pairs whose members got different outcomes -----
  const biasLinks = episode.pairStats
    .filter((p) => p.biasAffected === true)
    .map((p) => {
      const members = episode.cases.filter((c) => c.case.pairId === p.pairId);
      if (members.length !== 2) return null;
      const a = posByCase.get(members[0].case.id)!;
      const b = posByCase.get(members[1].case.id)!;
      return { pairId: p.pairId, a, b };
    })
    .filter(Boolean) as { pairId: string; a: { x: number; y: number }; b: { x: number; y: number } }[];

  const selectedView = selectedCaseId ? viewByCaseId.get(selectedCaseId) : undefined;
  const twinView = selectedView
    ? episode.cases.find((c) => c.case.pairId === selectedView.case.pairId && c.case.id !== selectedView.case.id)
    : undefined;

  // Which desks are actively working right now.
  const hasIncoming = incoming.length > 0;
  const hasAssessed = episode.cases.some((c) => c.zone === "assessed");
  const hasAllocated = episode.cases.some((c) => c.zone === "allocated");
  const working = (d: Desk) =>
    busy &&
    (d.role === "control" ? hasIncoming : d.role === "assessor" ? hasIncoming : d.role === "allocator" ? hasAssessed : hasAllocated);

  const queuedCount = episode.cases.filter((c) => c.zone === "audited" && c.allocationOutcome === "queued").length;
  const deniedCount = episode.cases.filter((c) => c.zone === "audited" && c.allocationOutcome === "denied").length;

  // ----- legend bits -----
  const swatch = (color: string, kind: "fill" | "ring" | "ring-dashed" | "dot") => (
    <span
      style={{
        width: kind === "dot" ? 8 : 11,
        height: kind === "dot" ? 8 : 11,
        borderRadius: "50%",
        background: kind === "fill" || kind === "dot" ? color : "transparent",
        border: kind === "ring" ? `2.5px solid ${color}` : kind === "ring-dashed" ? `2.5px dashed ${color}` : "none",
        flexShrink: 0,
        display: "inline-block",
      }}
    />
  );
  const item = (s: React.ReactNode, label: string) => (
    <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      {s}
      <span style={{ fontSize: 11, color: INK.secondary }}>{label}</span>
    </span>
  );
  const groupLabel = (t: string) => (
    <span key={t} style={{ fontSize: 10.5, color: INK.primary, fontWeight: 700, flexShrink: 0 }}>
      {t}
    </span>
  );

  return (
    <div
      style={{
        position: "relative",
        flex: 1,
        minWidth: 0,
        borderRadius: 24,
        overflow: "hidden",
        border: `1.5px solid ${INK.hairline}`,
        background: "#f4eedd",
      }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ position: "absolute", inset: 0, bottom: 118, width: "100%", height: "calc(100% - 118px)" }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onSelect(null);
        }}
      >
        {/* ---------- ground ---------- */}
        <defs>
          <pattern id="grass-dots" width="26" height="26" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1.2" fill="rgba(70,90,40,0.08)" />
            <circle cx="15" cy="17" r="1.2" fill="rgba(70,90,40,0.06)" />
          </pattern>
        </defs>
        <rect x={0} y={0} width={W} height={H} fill="url(#grass-dots)" pointerEvents="none" />

        {/* road along the bottom */}
        <rect x={0} y={572} width={W} height={48} fill="#d3d0c2" />
        <line x1={0} y1={596} x2={W} y2={596} stroke="#ffffff" strokeWidth={2.5} strokeDasharray="16 14" opacity={0.8} />
        <Ambulance />

        {/* Town walkways: strictly horizontal/vertical streets with a main
            east–west walkway and short connectors to each building's door.
            Drawn before the buildings so overlapping bits stay hidden. */}
        <g stroke="#d9d0b2" strokeWidth={16} strokeLinecap="round" strokeLinejoin="round" fill="none">
          <path d="M 140 572 L 140 335 L 1224 335" />
          {mode === "multi-agent" ? (
            <>
              <path d="M 415 335 L 415 305" />
              <path d="M 795 335 L 795 385" />
              {/* audit ↔ main street ↔ waiting area: one vertical crossing */}
              <path d="M 1080 285 L 1080 400" />
            </>
          ) : (
            <path d="M 1080 335 L 1080 400" />
          )}
          <path d="M 1200 335 L 1200 527 L 1228 527" />
        </g>
        <g stroke="#ffffff" strokeWidth={2} strokeDasharray="10 9" opacity={0.65} fill="none">
          <path d="M 140 572 L 140 335 L 1224 335" />
          <path d="M 1200 340 L 1200 527" />
        </g>

        {/* ---------- areas ---------- */}
        {/* Arrivals */}
        <rect x={60} y={400} width={160} height={160} rx={16} fill="#f4f2e6" stroke="#c9c6b0" strokeWidth={2} strokeDasharray="7 5" />
        <text x={74} y={392} fontSize={12} fontWeight={700} fill={INK.primary}>
          Arrivals
        </text>
        <text x={206} y={392} fontSize={11} fill={INK.muted} textAnchor="end">
          {incoming.length}
        </text>
        {onTheWay > 0 && (
          <text x={74} y={552} fontSize={10.5} fill={INK.muted}>
            {onTheWay} more on the way…
          </text>
        )}

        {mode === "multi-agent" ? (
          <>
            <Tent x={260} y={80} w={310} h={230} role="assessor" title="Assessment — triage nurses" door="bottom" />
            <Tent x={640} y={385} w={310} h={175} role="allocator" title="Allocation" door="top" />
            <Tent x={990} y={90} w={180} h={195} role="auditor" title="Audit post" door="bottom" />
          </>
        ) : (
          <Tent x={640} y={230} w={310} h={230} role="control" title="Control — one agent does everything" door="top" />
        )}

        <Hospital available={episode.resourceStock} />
        {BED_TILES.map((b, i) => {
          // Occupancy is derived from the authoritative free-bed counter
          // (free + occupied always = 12), never from cumulative allocations
          // — beds are reused as patients are discharged, so a long episode
          // can allocate far more than 12 patients total.
          const freeBeds = Math.max(0, Math.min(episode.resourceStock, BED_TILES.length));
          const state: "occupied" | "available" = i < BED_TILES.length - freeBeds ? "occupied" : "available";
          return <BedTile key={i} x={b.x} y={b.y} state={state} num={i + 1} headUp={b.headUp} />;
        })}

        {/* Waiting: a real yard below the audit post */}
        <rect x={985} y={400} width={185} height={160} rx={14} fill="#fdf6e3" stroke="#e3c86e" strokeWidth={2} />
        <text x={999} y={422} fontSize={11.5} fontWeight={700} fill={INK.primary}>
          Waiting
        </text>
        <text x={1156} y={422} fontSize={10.5} fill={INK.muted} textAnchor="end">
          {queuedCount}
        </text>
        {/* Denied: full width under the hospital, at the end of the south street */}
        <rect x={1230} y={478} width={350} height={88} rx={14} fill="#fdefee" stroke="#dfa1a1" strokeWidth={2} />
        <text x={1242} y={496} fontSize={11.5} fontWeight={700} fill={INK.primary}>
          Denied
        </text>
        <text x={1568} y={496} fontSize={10.5} fill={INK.muted} textAnchor="end">
          {deniedCount}
        </text>

        {/* ---------- bias twin-links ---------- */}
        {biasLinks.map((l) => (
          <line
            key={l.pairId}
            x1={l.a.x}
            y1={l.a.y}
            x2={l.b.x}
            y2={l.b.y}
            stroke="#d03b3b"
            strokeWidth={1.8}
            strokeDasharray="6 5"
            opacity={0.55}
            style={{ animation: "pt-dash-march 1.2s linear infinite" }}
            pointerEvents="none"
          />
        ))}
        {/* selected case → twin link (neutral, informational) */}
        {selectedView && twinView && (
          <line
            x1={posByCase.get(selectedView.case.id)!.x}
            y1={posByCase.get(selectedView.case.id)!.y}
            x2={posByCase.get(twinView.case.id)!.x}
            y2={posByCase.get(twinView.case.id)!.y}
            stroke={INK.primary}
            strokeWidth={1.2}
            strokeDasharray="3 4"
            opacity={0.5}
            pointerEvents="none"
          />
        )}

        {/* ---------- agents ---------- */}
        {desks.map((d, i) => (
          <AgentToken key={d.id} desk={d} working={working(d)} delay={i * 0.32} />
        ))}

        {/* ---------- case tokens ---------- */}
        {episode.cases.map((view) => {
          const pos = posByCase.get(view.case.id)!;
          const sev = view.assessedSeverity ?? view.case.trueSeverity;
          const fill = SEVERITY[sev].fill;
          const showRing = view.zone === "allocated" || view.zone === "audited";
          const verdict = worstVerdict(view);
          const ring = showRing ? POLICY_RING[verdict] : null;
          const selected = selectedCaseId === view.case.id;
          const isTwinOfSelected = twinView?.case.id === view.case.id;
          const outcome = view.allocationOutcome;
          const showTag = view.zone === "incoming" || view.zone === "audited" || selected || isTwinOfSelected;
          // In the Waiting/Denied lists the tag sits BESIDE the token (one
          // readable row per patient); elsewhere it floats above.
          const tagRight = view.zone === "audited" && view.allocationOutcome !== "allocated";
          const flaggedPolicies = view.policyChecks
            .filter((c) => c.verdict === "violation" || c.verdict === "warn")
            .sort((a, b) => a.policyId - b.policyId)
            .map((c) => `P${c.policyId} ${c.verdict}`)
            .join(", ");
          return (
            <g
              key={view.case.id}
              ref={(el) => {
                if (el) tokenEls.current.set(view.case.id, el);
                else tokenEls.current.delete(view.case.id);
              }}
              style={{ transform: `translate(${pos.x}px, ${pos.y}px)`, cursor: "pointer" }}
              onClick={() => onSelect(view.case.id)}
            >
              <title>
                {`${view.case.id} — ${SEV_SHORT[sev]} — ${view.case.demographicAttribute.value}` +
                  (outcome ? ` — ${outcome}${view.bedIndex !== undefined && outcome === "allocated" ? ` (bed ${view.bedIndex + 1})` : ""}` : "") +
                  (showRing ? ` — audit: ${verdict}${flaggedPolicies ? ` (${flaggedPolicies})` : ""}` : "")}
              </title>
              <g
                style={{
                  transformBox: "fill-box",
                  transformOrigin: "center",
                  animation: `pt-wander ${6 + (hashDelay(view.case.id, 4, 1) % 3)}s ease-in-out ${hashDelay(view.case.id, 7, 0.9)}s infinite`,
                }}
              >
                <g
                  style={{
                    transformBox: "fill-box",
                    transformOrigin: "center",
                    animation: `pt-breathe 2.6s ease-in-out ${hashDelay(view.case.id)}s infinite`,
                  }}
                >
                  <ellipse cy={12} rx={8} ry={2.4} fill="rgba(11,11,11,0.13)" />
                  {selected && <circle r={15.5} fill="none" stroke={INK.primary} strokeWidth={2} />}
                  {isTwinOfSelected && <circle r={15.5} fill="none" stroke="#2a78d6" strokeWidth={2} strokeDasharray="4 3" />}
                  {ring && (
                    <circle r={12.5} fill="none" stroke={ring} strokeWidth={3} strokeDasharray={verdict === "unchecked" ? "3.5 3" : undefined} />
                  )}
                  <circle r={9} fill={fill} stroke="#ffffff" strokeWidth={1.5} />
                  {outcome && <circle cx={7} cy={7} r={3.8} fill={OUTCOME_COLOR[outcome]} stroke="#ffffff" strokeWidth={1.3} />}
                  {/* name tag: the recorded background label the agents saw —
                      the only thing distinguishing the two members of a twin
                      pair. Plain text on purpose (no visual stereotyping).
                      Hidden in cramped desk queues to avoid overlap; always
                      shown in Arrivals, beds, Waiting/Denied and on select. */}
                  {showTag && (
                    <g>
                      <rect
                        x={tagRight ? 14 : -12}
                        y={tagRight ? -5.5 : -27}
                        width={24}
                        height={11}
                        rx={3.5}
                        fill="#ffffff"
                        stroke={INK.hairline}
                        strokeWidth={1}
                      />
                      <text
                        x={tagRight ? 26 : 0}
                        y={tagRight ? 3 : -18.5}
                        textAnchor="middle"
                        fontSize={7.5}
                        fontWeight={700}
                        fill={INK.secondary}
                        style={{ userSelect: "none" }}
                      >
                        {demoCode(view.case.demographicAttribute.value)}
                      </text>
                    </g>
                  )}
                </g>
              </g>
            </g>
          );
        })}

        {/* ---------- callouts ---------- */}
        {callouts.map((c) => {
          const desk = deskById.get(c.agentId);
          if (!desk) return null;
          const width = Math.min(c.text.length * 6 + 18, 150);
          return (
            <g key={c.key} style={{ transformBox: "fill-box", transformOrigin: "50% 100%", animation: "pt-pop-in 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) both" }} pointerEvents="none">
              <rect x={desk.x - width / 2} y={desk.y - 66} width={width} height={20} rx={10} fill="#ffffff" stroke={c.tone} strokeWidth={1.5} />
              <path d={`M ${desk.x - 4} ${desk.y - 46} L ${desk.x} ${desk.y - 40} L ${desk.x + 4} ${desk.y - 46} Z`} fill="#ffffff" stroke={c.tone} strokeWidth={1.1} />
              <rect x={desk.x - 8} y={desk.y - 49} width={16} height={3.5} fill="#ffffff" />
              <text x={desk.x} y={desk.y - 52} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={INK.primary}>
                {c.text}
              </text>
            </g>
          );
        })}
      </svg>

      {selectedView && (
        <DetailCard view={selectedView} twin={twinView} onClose={() => onSelect(null)} onSelectTwin={(id) => onSelect(id)} />
      )}
      {/* keep the floating card clear of the taller legend */}

      {/* ---------- legend: one plain sentence per visual channel ---------- */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 118,
          overflowY: "auto",
          background: "rgba(255,255,255,0.96)",
          borderTop: `1px solid ${INK.hairline}`,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 6,
          padding: "8px 18px",
        }}
      >
        {/* Every row WRAPS — nothing in this legend is ever truncated. */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", rowGap: 3 }}>
          {groupLabel("Circle color = how hurt:")}
          {item(swatch(SEVERITY[1].fill, "fill"), "critical")}
          {item(swatch(SEVERITY[2].fill, "fill"), "serious")}
          {item(swatch(SEVERITY[3].fill, "fill"), "minor")}
          {item(swatch(SEVERITY[4].fill, "fill"), "deceased")}
          <span style={{ width: 1, height: 14, background: INK.hairline }} />
          {groupLabel("Corner dot = decision:")}
          {item(swatch(OUTCOME_COLOR.allocated, "dot"), "got a bed")}
          {item(swatch(OUTCOME_COLOR.queued, "dot"), "must wait")}
          {item(swatch(OUTCOME_COLOR.denied, "dot"), "turned away")}
          <span style={{ width: 1, height: 14, background: INK.hairline }} />
          {groupLabel("Ring = audit:")}
          {item(swatch(POLICY_RING.ok!, "ring"), "checked, all good")}
          {item(swatch(POLICY_RING.warn!, "ring"), "doubtful")}
          {item(swatch(POLICY_RING.violation!, "ring"), "rule broken")}
          {item(swatch(POLICY_RING.unchecked!, "ring-dashed"), "never checked!")}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ width: 24, borderTop: "2.5px dashed #d03b3b", display: "inline-block", flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: INK.secondary }}>
            <strong style={{ color: "#d03b3b" }}>Red line = unfair:</strong> two identical patients (only their origin
            differs) got different treatment.{" "}
            {biasLinks.length === 0 ? (
              <em style={{ color: INK.muted }}>None so far — no unfair pair in this episode yet.</em>
            ) : (
              <strong style={{ color: "#d03b3b" }}>{biasLinks.length} unfair pair{biasLinks.length > 1 ? "s" : ""} right now!</strong>
            )}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <span
            style={{
              fontSize: 7.5,
              fontWeight: 700,
              color: INK.secondary,
              border: `1px solid ${INK.hairline}`,
              borderRadius: 4,
              padding: "1px 4px",
              flexShrink: 0,
              marginTop: 1,
            }}
          >
            SYR
          </span>
          <span style={{ fontSize: 11, color: INK.secondary, lineHeight: 1.45, whiteSpace: "normal" }}>
            <strong>Name tag</strong> = recorded background, the only difference between twins: SYR Syrian · NOR
            Norwegian · NIG Nigerian · CAN Canadian · AFG Afghan · SWI Swiss · MUS Muslim · CHR Christian · JEW Jewish ·
            ATH Atheist · HIN Hindu · CAT Catholic · OBE obese · ATL athletic · FRL frail · MSC muscular · AND Android
            phone · IPH iPhone
          </span>
        </div>
      </div>
    </div>
  );
}
