import { NextResponse } from "next/server";
import { DispatchRequest } from "@/ai/contract";
import { dispatch } from "@/ai/dispatcher";
import { AI_CONFIG, clientIp, rateLimited } from "@/ai/server";
import { ENGINE_VERSION, NETWORK } from "@/engine";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  if (rateLimited("dispatch", clientIp(req))) return NextResponse.json({ error: "Too many requests. Wait a minute and try again." }, { status: 429 });
  const parsed = DispatchRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const body = parsed.data;
  if (body.engineVersion !== ENGINE_VERSION)
    return NextResponse.json({ error: "This page is out of date. Reload to get the current engine." }, { status: 409 });
  const known = new Set(NETWORK.airports.map((a) => a.id));
  if (!body.closures.every((c) => known.has(c.airport))) return NextResponse.json({ error: "Unknown airport." }, { status: 400 });

  const result = await dispatch(body, AI_CONFIG);
  return NextResponse.json(result);
}
