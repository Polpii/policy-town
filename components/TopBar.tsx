import { INK } from "@/lib/theme";

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", minWidth: 56 }}>
      <span style={{ fontSize: 10, color: INK.muted, letterSpacing: 0.3, textTransform: "uppercase" }}>
        {label}
      </span>
      <span
        style={{
          fontSize: 16,
          fontWeight: 600,
          color: tone ?? INK.primary,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Button({
  children,
  onClick,
  disabled,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "8px 14px",
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 500,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
        border: primary ? "none" : `1px solid ${INK.hairline}`,
        background: primary ? INK.primary : "#fff",
        color: primary ? "#fff" : INK.primary,
        transition: "opacity 0.15s ease",
      }}
    >
      {children}
    </button>
  );
}

export function TopBar(props: {
  episodeMode: "multi-agent" | "control" | null;
  viewMode: "visual" | "stats";
  onViewModeChange: (m: "visual" | "stats") => void;
  speed: "normal" | "fast";
  onSpeedChange: (s: "normal" | "fast") => void;
  onNewEpisode: () => void;
  onNextTick: () => void;
  onRunAll: () => void;
  busy: boolean;
  hasEpisode: boolean;
  complete: boolean;
  tick: number;
  resourceStock: number;
  surgeIndex: number;
  backlog: number;
}) {
  const {
    episodeMode,
    viewMode,
    onViewModeChange,
    speed,
    onSpeedChange,
    onNewEpisode,
    onNextTick,
    onRunAll,
    busy,
    hasEpisode,
    complete,
  } = props;

  return (
    <div
      style={{
        height: 64,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 20px",
        borderBottom: `1.5px solid ${INK.hairline}`,
        background: "#fefefe",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: INK.primary }}>PolicyTown</span>
          <span style={{ fontSize: 11, color: INK.muted }}>Triage &amp; allocation bias instrument</span>
        </div>

        {episodeMode && (
          <span
            style={{
              marginLeft: 8,
              padding: "5px 12px",
              borderRadius: 999,
              fontSize: 11.5,
              fontWeight: 700,
              border: `1px solid ${INK.hairline}`,
              color: INK.secondary,
              whiteSpace: "nowrap",
            }}
          >
            {episodeMode === "multi-agent" ? "Multi-agent" : "Control"}
          </span>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <Button onClick={onNewEpisode} disabled={busy} primary={!hasEpisode}>
            New episode
          </Button>
          <Button onClick={onNextTick} disabled={busy || !hasEpisode || complete}>
            Next tick
          </Button>
          <Button onClick={onRunAll} disabled={busy || !hasEpisode || complete}>
            Run to completion
          </Button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
        <div
          style={{
            display: "flex",
            border: `1px solid ${INK.hairline}`,
            borderRadius: 999,
            padding: 2,
          }}
        >
          {(["normal", "fast"] as const).map((s) => (
            <button
              key={s}
              onClick={() => onSpeedChange(s)}
              title={s === "fast" ? "Faster movement on the map" : "Normal movement speed"}
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
                background: speed === s ? INK.primary : "transparent",
                color: speed === s ? "#fff" : INK.secondary,
              }}
            >
              {s === "normal" ? "1×" : "2×"}
            </button>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            border: `1px solid ${INK.hairline}`,
            borderRadius: 999,
            padding: 2,
          }}
        >
          {(["visual", "stats"] as const).map((m) => (
            <button
              key={m}
              onClick={() => onViewModeChange(m)}
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
                background: viewMode === m ? INK.primary : "transparent",
                color: viewMode === m ? "#fff" : INK.secondary,
              }}
            >
              {m === "visual" ? "Map" : "Stats"}
            </button>
          ))}
        </div>
        <Stat label="Tick" value={String(props.tick)} />
        <Stat
          label="Beds"
          value={String(props.resourceStock)}
          tone={hasEpisode && props.resourceStock <= 0 ? "#d03b3b" : undefined}
        />
        <Stat
          label="Surge"
          value={`${Math.round(props.surgeIndex)}`}
          tone={hasEpisode && props.surgeIndex > 100 ? "#fab219" : undefined}
        />
        <Stat
          label="Backlog"
          value={String(props.backlog)}
          tone={hasEpisode && props.backlog > 0 ? "#fab219" : undefined}
        />
      </div>
    </div>
  );
}
