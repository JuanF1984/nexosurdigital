import { NextRequest } from "next/server";
import { getMideSupabaseClient } from "@/lib/mide/supabase";
import { isAuthorizedDevice } from "@/lib/mide/auth";
import { mideOk, mideError } from "@/lib/mide/http";
import { validateEventPayload } from "@/lib/mide/validation";

// Requires Node.js APIs (crypto.timingSafeEqual via mide/auth) - must not run on the Edge runtime.
export const runtime = "nodejs";

const MAX_BODY_BYTES = 4096;

export async function POST(request: NextRequest) {
  if (
    !process.env.SUPABASE_URL ||
    !process.env.SUPABASE_SECRET_KEY ||
    !process.env.MIDE_DEVICE_API_KEY
  ) {
    console.error("mide/event: missing required server environment variables");
    return mideError(500, "Error interno del servidor");
  }

  if (!isAuthorizedDevice(request)) {
    return mideError(401, "No autorizado");
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return mideError(415, "Content-Type debe ser application/json");
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return mideError(400, "No se pudo leer el cuerpo de la petición");
  }

  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return mideError(400, "El cuerpo de la petición es demasiado grande");
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return mideError(400, "JSON inválido");
  }

  const validation = validateEventPayload(parsedBody);
  if (!validation.ok) {
    return mideError(400, validation.error);
  }

  const { deviceId, eventId, type, severity, startedAt, value, endedAt, peakValue, metadata } =
    validation.value;

  const supabase = getMideSupabaseClient();

  const { data: device, error: deviceError } = await supabase
    .from("devices")
    .select("id")
    .eq("device_code", deviceId)
    .maybeSingle();

  if (deviceError) {
    console.error("mide/event: error consultando dispositivo:", deviceError.message);
    return mideError(500, "Error interno del servidor");
  }

  if (!device) {
    return mideError(404, "Dispositivo no encontrado");
  }

  // One row per thermal episode, keyed by (device_id, event_uid). The upsert
  // in mide_upsert_event makes every POST idempotent:
  //   - no endedAt  -> creates the row (status 'open'), or is a harmless
  //     no-op if the device is retrying an open it already sent;
  //   - with endedAt -> resolves the SAME row (ended_at, peak_value,
  //     status 'resolved', metadata merged), or creates it already resolved
  //     if the close somehow arrives before the open.
  // A retry never creates a second row and never regresses the episode.
  const { data: rpcRows, error: rpcError } = await supabase.rpc("mide_upsert_event", {
    p_device_id: device.id,
    p_event_uid: eventId,
    p_type: type,
    p_severity: severity,
    p_started_at: startedAt,
    p_value: value,
    p_ended_at: endedAt,
    p_peak_value: peakValue,
    p_metadata: metadata ?? {},
  });

  if (rpcError) {
    console.error("mide/event: error registrando evento:", rpcError.message);
    return mideError(500, "Error interno del servidor");
  }

  const row = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
  const created = row?.was_inserted ?? true;
  const resolved = row?.event_status === "resolved";

  // `duplicate` keeps its original meaning (an open POST that changed
  // nothing). A close POST reports through `resolved` instead.
  if (endedAt != null) {
    return mideOk({ resolved, created });
  }
  return mideOk({ duplicate: !created });
}
