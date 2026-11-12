import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Stateless CORS proxy.
 *
 * - Accepts { url, method, headers, body } and forwards verbatim.
 * - The API key travels inside `headers`/`body` for that single request only.
 * - Nothing is stored, nothing is logged (no console.*, no persistence).
 * - Only https outbound URLs are allowed.
 */

const ALLOWED_PROTOCOL = "https:";

function deny(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request): Promise<NextResponse> {
  let payload: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };

  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return deny("Invalid JSON body");
  }

  const { url, method = "GET", headers = {}, body } = payload;

  if (!url || typeof url !== "string") return deny("Missing url");
  if (method === "OPTIONS") return deny("Method not allowed", 405);
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase())) {
    return deny("Unsupported method");
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return deny("Invalid url");
  }
  if (parsed.protocol !== ALLOWED_PROTOCOL) return deny("Only https urls are allowed");

  const forwarded: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v === "string") forwarded[k] = v;
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      method: method.toUpperCase(),
      headers: forwarded,
      body: body ?? undefined,
      cache: "no-store",
      redirect: "follow",
    });

      const responseHeaders = new Headers({
      "content-type": upstream.headers.get("content-type") || "application/octet-stream",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    });
    const retryAfter = upstream.headers.get("retry-after");
    if (retryAfter) responseHeaders.set("retry-after", retryAfter);

    const buf = await upstream.arrayBuffer();
    return new NextResponse(buf, { status: upstream.status, headers: responseHeaders });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upstream request failed";
    // Never include the payload/headers (which may contain keys) in the message.
    return deny(message.split("\n")[0].slice(0, 200), 502);
  }
}

export async function GET(): Promise<NextResponse> {
  return deny("POST only");
}
