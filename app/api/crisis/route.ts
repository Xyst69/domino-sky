import { NextResponse } from "next/server";
import { CrisisRequest } from "@/ai/contract";
import { compileCrisis } from "@/ai/crisis";
import { AI_CONFIG } from "@/ai/server";
import { readAiRequest } from "@/ai/request";

export const runtime = "nodejs";
export const maxDuration = 20;

export async function POST(req: Request) {
  const body = await readAiRequest(req, "crisis", CrisisRequest, "Describe the disruption in a few words (up to 500 characters).");
  if (body instanceof Response) return body;
  const result = await compileCrisis(body.text, { ...AI_CONFIG, timeoutMs: 12_000 });
  return NextResponse.json(result);
}
