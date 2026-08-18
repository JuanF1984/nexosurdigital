import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

// Baseline device authentication: a single shared secret sent as a Bearer
// token (same pattern as /api/energy-event, but with its own env var so the
// two systems stay fully independent). This is an interim measure — the
// device roadmap calls for per-device secrets + HMAC signing (see
// docs/mide/seguridad.md); deviceId alone is never treated as sufficient
// authentication.
function safeCompare(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a, "utf8").digest();
  const digestB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(digestA, digestB);
}

function extractBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/.exec(header.trim());
  return match ? match[1].trim() : null;
}

export function isAuthorizedDevice(request: NextRequest): boolean {
  const apiKey = process.env.MIDE_DEVICE_API_KEY;
  if (!apiKey) return false;

  const token = extractBearerToken(request.headers.get("authorization"));
  if (!token) return false;

  return safeCompare(token, apiKey);
}
