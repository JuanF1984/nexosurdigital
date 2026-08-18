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

  const { deviceId, eventId, type, severity, startedAt, value } = validation.value;

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

  // Idempotency relies on the (device_id, event_uid) unique constraint: a
  // retried event (device didn't see our previous response) hits a unique
  // violation (23505) here and is reported back as a successful no-op
  // instead of creating a duplicate row or a second future notification.
  const { error: insertError } = await supabase.from("events").insert({
    device_id: device.id,
    event_uid: eventId,
    event_type: type,
    severity,
    started_at: startedAt,
    value_at_start: value,
  });

  if (insertError) {
    if (insertError.code === "23505") {
      return mideOk({ duplicate: true });
    }
    console.error("mide/event: error insertando evento:", insertError.message);
    return mideError(500, "Error interno del servidor");
  }

  return mideOk({ duplicate: false });
}
