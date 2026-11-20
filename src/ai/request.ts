import type { ZodType } from "zod";
import { clientIp, rateLimited } from "./server";

const MAX_BYTES = 8192;

/** Bound the bytes read even when a client streams a body without Content-Length. */
async function readJson(req: Request): Promise<unknown | Response> {
  const tooLarge = () => Response.json({ error: "Request exceeds 8 KiB." }, { status: 413 });
  if (Number(req.headers.get("content-length")) > MAX_BYTES) return tooLarge();
  const reader = req.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let json = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return JSON.parse(json + decoder.decode());
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return tooLarge();
      }
      json += decoder.decode(value, { stream: true });
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export async function readAiRequest<T>(req: Request, route: string, schema: ZodType<T>, invalid: string): Promise<T | Response> {
  if (rateLimited(route, clientIp(req))) {
    return Response.json({ error: "Too many requests. Wait a minute and try again." }, {
      status: 429, headers: { "Retry-After": "60" },
    });
  }
  if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return Response.json({ error: "Send the request as application/json." }, { status: 415 });
  }
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const parsed = schema.safeParse(body);
  return parsed.success ? parsed.data : Response.json({ error: invalid }, { status: 400 });
}
