import { NextRequest, NextResponse } from "next/server";
import { advanceTick, getState } from "@/lib/simulation";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const episodeId = body.episodeId as string | undefined;
  if (!episodeId) {
    return NextResponse.json({ error: "episodeId is required" }, { status: 400 });
  }

  try {
    await advanceTick(episodeId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error while advancing tick";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json(getState(episodeId));
}
