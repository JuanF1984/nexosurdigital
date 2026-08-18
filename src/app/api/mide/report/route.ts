import { NextRequest } from "next/server";
import { getMideSupabaseClient } from "@/lib/mide/supabase";
import { isAuthorizedDevice } from "@/lib/mide/auth";
import { mideOk, mideError } from "@/lib/mide/http";
import { validateReportPayload } from "@/lib/mide/validation";

// Requires Node.js APIs (crypto.timingSafeEqual via mide/auth) - must not run on the Edge runtime.
export const runtime = "nodejs";

const MAX_BODY_BYTES = 16384; // small periodic summary report; a handful of metrics at most

export async function POST(request: NextRequest) {
  if (
    !process.env.SUPABASE_URL ||
    !process.env.SUPABASE_SECRET_KEY ||
    !process.env.MIDE_DEVICE_API_KEY
  ) {
    console.error("mide/report: missing required server environment variables");
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

  const validation = validateReportPayload(parsedBody);
  if (!validation.ok) {
    return mideError(400, validation.error);
  }

  const { deviceId, firmwareVersion, periodStart, periodEnd, metrics } = validation.value;

  const supabase = getMideSupabaseClient();

  const { data: device, error: deviceError } = await supabase
    .from("devices")
    .select("id, active")
    .eq("device_code", deviceId)
    .maybeSingle();

  if (deviceError) {
    console.error("mide/report: error consultando dispositivo:", deviceError.message);
    return mideError(500, "Error interno del servidor");
  }

  if (!device) {
    return mideError(404, "Dispositivo no encontrado");
  }

  if (!device.active) {
    return mideError(403, "Dispositivo inactivo");
  }

  // Insert + device update happen atomically in a single transaction via RPC
  // (see supabase/migrations, function mide_ingest_report). See
  // docs/mide/base-de-datos.md for why this was chosen over two separate
  // client calls.
  const { data: configVersion, error: rpcError } = await supabase.rpc("mide_ingest_report", {
    p_device_id: device.id,
    p_firmware_version: firmwareVersion,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_metrics: metrics,
  });

  if (rpcError) {
    console.error("mide/report: error insertando reporte:", rpcError.message);
    return mideError(500, "Error interno del servidor");
  }

  return mideOk({ configVersion: configVersion ?? null });
}
