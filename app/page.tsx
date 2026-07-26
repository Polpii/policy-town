"use client";

import { useState } from "react";
import { EpisodeState } from "@/lib/types";
import { TopBar } from "@/components/TopBar";
import { MapView } from "@/components/MapView";
import { StatsView } from "@/components/StatsView";
import { SetupPanel, EpisodeSetup, DEFAULT_SETUP } from "@/components/SetupPanel";
import { INK } from "@/lib/theme";

export default function Home() {
  const [viewMode, setViewMode] = useState<"visual" | "stats">("visual");
  const [episode, setEpisode] = useState<EpisodeState | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(true);
  const [setup, setSetup] = useState<EpisodeSetup>(DEFAULT_SETUP);
  const [speed, setSpeed] = useState<"normal" | "fast">("normal");

  async function startEpisode(cfg: EpisodeSetup) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/episode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: cfg.mode,
          totalPairs: cfg.totalPairs,
          caseloadCurve: cfg.caseloadCurve,
          resourceStock: cfg.resourceStock,
          resourceRegenPerTick: cfg.resourceRegenPerTick,
          auditorCapacityPerTick: cfg.auditorCapacityPerTick,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start episode");
      setEpisode(data);
      setSelectedCaseId(null);
      setShowSetup(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function nextTick(current: EpisodeState): Promise<boolean> {
    try {
      const res = await fetch("/api/tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episodeId: current.episodeId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to advance tick");
      setEpisode(data);
      return (data as EpisodeState).cases.every((c) => c.zone === "audited");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return true;
    }
  }

  async function handleNextTick() {
    if (!episode) return;
    setBusy(true);
    setError(null);
    await nextTick(episode);
    setBusy(false);
  }

  async function handleRunAll() {
    if (!episode) return;
    setBusy(true);
    setError(null);
    const maxTicks = 80;
    let current = episode;
    for (let i = 0; i < maxTicks; i++) {
      const res = await fetch("/api/tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episodeId: current.episodeId }),
      }).catch(() => null);
      if (!res) break;
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to advance tick");
        break;
      }
      current = data as EpisodeState;
      setEpisode(current);
      if (current.cases.every((c) => c.zone === "audited")) break;
    }
    setBusy(false);
  }

  const complete = !!episode && episode.cases.length > 0 && episode.cases.every((c) => c.zone === "audited");

  return (
    <main style={{ position: "fixed", inset: 0, background: "#fefefe", display: "flex", flexDirection: "column" }}>
      <TopBar
        episodeMode={episode?.config.mode ?? null}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        speed={speed}
        onSpeedChange={setSpeed}
        onNewEpisode={() => setShowSetup(true)}
        onNextTick={handleNextTick}
        onRunAll={handleRunAll}
        busy={busy}
        hasEpisode={!!episode}
        complete={complete}
        tick={episode?.tick ?? 0}
        resourceStock={episode?.resourceStock ?? 0}
        surgeIndex={episode?.surgeIndex ?? 0}
        backlog={episode?.backlog ?? 0}
      />

      {error && (
        <div
          style={{
            padding: "8px 20px",
            background: "#fdeceb",
            color: "#d03b3b",
            fontSize: 12.5,
            borderBottom: `1px solid ${INK.hairline}`,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ flex: 1, display: "flex", gap: 14, padding: 16, minHeight: 0, position: "relative" }}>
        {!episode ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <SetupPanel value={setup} onChange={setSetup} onStart={startEpisode} busy={busy} />
          </div>
        ) : viewMode === "stats" ? (
          <StatsView episode={episode} />
        ) : (
          <MapView episode={episode} selectedCaseId={selectedCaseId} onSelect={setSelectedCaseId} busy={busy} speed={speed} />
        )}

        {/* Setup overlay when an episode is already on screen */}
        {episode && showSetup && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(11,11,11,0.25)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 20,
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowSetup(false);
            }}
          >
            <SetupPanel value={setup} onChange={setSetup} onStart={startEpisode} busy={busy} onCancel={() => setShowSetup(false)} />
          </div>
        )}
      </div>
    </main>
  );
}
