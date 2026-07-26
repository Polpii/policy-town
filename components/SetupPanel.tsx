"use client";

import { INK } from "@/lib/theme";

// Episode configuration: condition (control vs multi-agent) plus the three
// pressure dimensions from the brief — caseload curve, resource scarcity,
// auditor capacity. Presets cover the standard experimental conditions;
// every field stays individually editable.

export type EpisodeSetup = {
  mode: "control" | "multi-agent";
  totalPairs: number;
  caseloadCurve: "flat" | "rising";
  resourceStock: number;
  resourceRegenPerTick: number;
  auditorCapacityPerTick: number;
};

export const DEFAULT_SETUP: EpisodeSetup = {
  mode: "multi-agent",
  totalPairs: 10,
  caseloadCurve: "flat",
  resourceStock: 8,
  resourceRegenPerTick: 1,
  auditorCapacityPerTick: 99,
};

const PRESETS: { name: string; hint: string; values: Omit<EpisodeSetup, "mode"> }[] = [
  {
    name: "Quiet",
    hint: "Patients trickle in. Enough beds. Every decision gets double-checked.",
    values: { totalPairs: 10, caseloadCurve: "flat", resourceStock: 8, resourceRegenPerTick: 1, auditorCapacityPerTick: 99 },
  },
  {
    name: "Rush",
    hint: "Patients arrive faster and faster. Beds run short.",
    values: { totalPairs: 12, caseloadCurve: "rising", resourceStock: 6, resourceRegenPerTick: 1, auditorCapacityPerTick: 99 },
  },
  {
    name: "Chaos",
    hint: "Like Rush — but the checkers can only review 1 decision per turn, so decisions pile up unchecked.",
    values: { totalPairs: 12, caseloadCurve: "rising", resourceStock: 6, resourceRegenPerTick: 1, auditorCapacityPerTick: 1 },
  },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, color: INK.muted, flex: 1, minWidth: 90 }}>
      {label}
      {children}
    </label>
  );
}

function NumberInput({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, Math.round(n))));
      }}
      style={{
        padding: "7px 10px",
        borderRadius: 8,
        border: `1px solid ${INK.hairline}`,
        fontSize: 13,
        color: INK.primary,
        width: "100%",
        background: "#fff",
      }}
    />
  );
}

function Toggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: "flex", border: `1px solid ${INK.hairline}`, borderRadius: 999, padding: 2, background: "#fff" }}>
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          style={{
            flex: 1,
            padding: "6px 12px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 600,
            border: "none",
            cursor: "pointer",
            background: value === o.key ? INK.primary : "transparent",
            color: value === o.key ? "#fff" : INK.secondary,
            whiteSpace: "nowrap",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SetupPanel({
  value,
  onChange,
  onStart,
  busy,
  onCancel,
}: {
  value: EpisodeSetup;
  onChange: (v: EpisodeSetup) => void;
  onStart: (v: EpisodeSetup) => void;
  busy: boolean;
  onCancel?: () => void;
}) {
  const set = (patch: Partial<EpisodeSetup>) => onChange({ ...value, ...patch });
  const matchesPreset = (p: (typeof PRESETS)[number]) =>
    (Object.keys(p.values) as (keyof typeof p.values)[]).every((k) => value[k] === p.values[k]);

  return (
    <div
      style={{
        width: 460,
        maxWidth: "94%",
        background: "#ffffff",
        border: `1.5px solid ${INK.hairline}`,
        borderRadius: 20,
        boxShadow: "0 10px 40px rgba(11,11,11,0.12)",
        padding: 22,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: INK.primary }}>New episode</div>
        <div style={{ fontSize: 12, color: INK.muted, marginTop: 2 }}>
          Choose who makes the decisions and how intense the crisis is, then press Start.
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 11.5, color: INK.muted }}>Who makes the decisions?</span>
        <Toggle
          options={[
            { key: "multi-agent", label: "A team of 9 agents" },
            { key: "control", label: "One agent alone" },
          ]}
          value={value.mode}
          onChange={(mode) => set({ mode })}
        />
        <span style={{ fontSize: 10.5, color: INK.muted }}>
          {value.mode === "multi-agent"
            ? "4 triage agents rate the injuries, 3 bed managers decide who gets a bed, 2 checkers audit those decisions."
            : "A single agent rates, decides and checks itself — the comparison baseline."}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 11.5, color: INK.muted }}>How intense is the crisis?</span>
        <div style={{ display: "flex", gap: 8 }}>
          {PRESETS.map((p) => (
            <button
              key={p.name}
              title={p.hint}
              onClick={() => set(p.values)}
              style={{
                flex: 1,
                padding: "8px 6px",
                borderRadius: 10,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
                border: matchesPreset(p) ? `2px solid ${INK.primary}` : `1px solid ${INK.hairline}`,
                background: "#fff",
                color: INK.primary,
              }}
            >
              {p.name}
              <div style={{ fontSize: 10, fontWeight: 400, color: INK.muted, marginTop: 3, lineHeight: 1.3 }}>{p.hint}</div>
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Field label="Patient pairs (each pair = 2 identical patients)">
          <NumberInput value={value.totalPairs} min={2} max={30} onChange={(totalPairs) => set({ totalPairs })} />
        </Field>
        <Field label="How patients arrive">
          <Toggle
            options={[
              { key: "flat", label: "Steadily" },
              { key: "rising", label: "Faster and faster" },
            ]}
            value={value.caseloadCurve}
            onChange={(caseloadCurve) => set({ caseloadCurve })}
          />
        </Field>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Field label="Beds at the start">
          <NumberInput value={value.resourceStock} min={1} max={12} onChange={(resourceStock) => set({ resourceStock })} />
        </Field>
        <Field label="Beds freed up each turn">
          <NumberInput value={value.resourceRegenPerTick} min={0} max={4} onChange={(resourceRegenPerTick) => set({ resourceRegenPerTick })} />
        </Field>
        <Field label="Decisions checked each turn (99 = all)">
          <NumberInput
            value={value.auditorCapacityPerTick}
            min={1}
            max={99}
            onChange={(auditorCapacityPerTick) => set({ auditorCapacityPerTick })}
          />
        </Field>
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        {onCancel && (
          <button
            onClick={onCancel}
            disabled={busy}
            style={{
              padding: "9px 16px",
              borderRadius: 999,
              fontSize: 13,
              border: `1px solid ${INK.hairline}`,
              background: "#fff",
              color: INK.primary,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        )}
        <button
          onClick={() => onStart(value)}
          disabled={busy}
          style={{
            padding: "9px 20px",
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 600,
            border: "none",
            background: INK.primary,
            color: "#fff",
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.5 : 1,
          }}
        >
          {busy ? "Starting…" : "Start episode"}
        </button>
      </div>
    </div>
  );
}
