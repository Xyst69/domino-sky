import { NextResponse } from "next/server";
import { CrisisRequest } from "@/ai/contract";
import { compileCrisis } from "@/ai/crisis";
import { AI_CONFIG, clientIp, rateLimited } from "@/ai/server";

export const runtime = "nodejs";
export const maxDuration = 20;

export async function POST(req: Request) {
  if (rateLimited(clientIp(req))) return NextResponse.json({ error: "Too many requests. Wait a minute and try again." }, { status: 429 });
  const parsed = CrisisRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Describe the disruption in a few words (up to 500 characters)." }, { status: 400 });
  const result = await compileCrisis(parsed.data.text, { ...AI_CONFIG, timeoutMs: 12_000 });
  return NextResponse.json(result);
}
