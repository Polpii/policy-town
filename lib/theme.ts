import { AgentRole, PolicyVerdict, Severity } from "./types";

// Domain-standard START triage colors for the severity fill, chosen to align
// with the validated status palette (critical/warning/good) plus black for
// the terminal severity.
export const SEVERITY: Record<Severity, { fill: string; label: string }> = {
  1: { fill: "#d03b3b", label: "Immediate" },
  2: { fill: "#fab219", label: "Urgent" },
  3: { fill: "#0ca30c", label: "Delayed" },
  4: { fill: "#2a2a28", label: "Deceased / expectant" },
};

// The policy-status ring is a separate visual channel from severity fill.
// "unchecked" renders as a visible neutral-gray dashed ring — a case that
// slipped past audit must never be mistaken for an audited-clean one, so
// ok is a distinct soft green and unchecked stays gray forever.
export const POLICY_RING: Record<PolicyVerdict | "unchecked", string | null> = {
  unchecked: "#b8b6ac",
  ok: "#6aab52",
  warn: "#fab219",
  violation: "#d03b3b",
};

// `edge` is a darker step of `color`, used as a 3D-button drop edge under the
// agent token (a flat offset shadow, game-badge style) instead of a blur).
// No emoji and no icon-library glyphs anywhere — each agent instance is a
// flat boardgame-piece token drawn inline in MapView, identified by role
// color plus an instance label (A1–A4 / L1–L3 / U1–U2 / C1).
export const ROLE_STYLE: Record<AgentRole, { color: string; edge: string; label: string }> = {
  assessor: { color: "#2a78d6", edge: "#1c5aa8", label: "Assessor" },
  allocator: { color: "#1baf7a", edge: "#0f8a5c", label: "Allocator" },
  auditor: { color: "#4a3aa7", edge: "#35297d", label: "Auditor" },
  control: { color: "#eb6834", edge: "#c94f1f", label: "Control" },
};

// Pastel station-floor tint per role, used behind the map's station areas.
// Kept light enough that the SEVERITY/POLICY_RING case-token colors on top
// still read clearly against it.
export const ROLE_STATION_BG: Record<AgentRole | "incoming", string> = {
  incoming: "#f4f3ec",
  assessor: "#e9f2fc",
  allocator: "#e8f9f1",
  auditor: "#efecfa",
  control: "#fdf0e6",
};

// Allocation-outcome status colors — good/warning/critical, shared between
// the map's outcome badges and the stats dashboard's bar chart.
export const OUTCOME_COLOR: Record<"allocated" | "queued" | "denied", string> = {
  allocated: "#0ca30c",
  queued: "#fab219",
  denied: "#d03b3b",
};

// "assessor-3" → "A3", "allocator-1" → "L1", "auditor-2" → "U2", "control-1" → "C1".
export function agentShortLabel(agentId: string): string {
  const [role, num] = agentId.split("-");
  const letter = role === "assessor" ? "A" : role === "allocator" ? "L" : role === "auditor" ? "U" : "C";
  return `${letter}${num ?? "1"}`;
}

export const INK = {
  primary: "#0b0b0b",
  secondary: "#52514e",
  muted: "#898781",
  border: "rgba(11,11,11,0.10)",
  hairline: "#e1e0d9",
};
