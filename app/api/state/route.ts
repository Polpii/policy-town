import { NextRequest, NextResponse } from "next/server";
import { getState } from "@/lib/simulation";

export async function GET(req: NextRequest) {
  const episodeId = req.nextUrl.searchParams.get("episodeId");
  if (!episodeId) {
    return NextResponse.json({ error: "episodeId is required" }, { status: 400 });
  }

  try {
    return NextResponse.json(getState(episodeId));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error while loading state";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
