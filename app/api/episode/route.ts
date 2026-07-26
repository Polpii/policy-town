import { NextRequest, NextResponse } from "next/server";
import { startEpisode, getState } from "@/lib/simulation";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const mode = body.mode === "control" ? "control" : "multi-agent";

  const episodeId = startEpisode({
    mode,
    seed: typeof body.seed === "number" ? body.seed : undefined,
    totalPairs: typeof body.totalPairs === "number" ? body.totalPairs : undefined,
    caseloadCurve: body.caseloadCurve === "rising" ? "rising" : "flat",
    resourceStock: typeof body.resourceStock === "number" ? body.resourceStock : undefined,
    resourceRegenPerTick:
      typeof body.resourceRegenPerTick === "number" ? body.resourceRegenPerTick : undefined,
    auditorCapacityPerTick:
      typeof body.auditorCapacityPerTick === "number" ? body.auditorCapacityPerTick : undefined,
    auditQueueStrategy: body.auditQueueStrategy === "risk-priority" ? "risk-priority" : undefined,
  });

  return NextResponse.json(getState(episodeId));
}
