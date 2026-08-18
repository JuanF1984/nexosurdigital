import { NextRequest } from "next/server";
import { getMideSupabaseClient } from "@/lib/mide/supabase";
import { isAuthorizedDevice } from "@/lib/mide/auth";
import { mideOk, mideError } from "@/lib/mide/http";
import { isValidDeviceId } from "@/lib/mide/validation";

// Requires Node.js APIs (crypto.timingSafeEqual via mide/auth) - must not run on the Edge runtime.
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (
    !process.env.SUPABASE_URL ||
    !process.env.SUPABASE_SECRET_KEY ||
    !process.env.MIDE_DEVICE_API_KEY
  ) {
    console.error("mide/config: missing required server environment variables");
    return mideError(500, "Error interno del servidor");
  }

  if (!isAuthorizedDevice(request)) {
    return mideError(401, "No autorizado");
  }

  const deviceId = request.nextUrl.searchParams.get("deviceId");
  if (!isValidDeviceId(deviceId)) {
    return mideError(400, "deviceId inválido");
  }

  const supabase = getMideSupabaseClient();

  const { data: device, error: deviceError } = await supabase
    .from("devices")
    .select("id, active")
    .eq("device_code", deviceId)
    .maybeSingle();

  if (deviceError) {
    console.error("mide/config: error consultando dispositivo:", deviceError.message);
    return mideError(500, "Error interno del servidor");
  }

  if (!device) {
    return mideError(404, "Dispositivo no encontrado");
  }

  if (!device.active) {
    return mideError(403, "Dispositivo inactivo");
  }

  const { data: config, error: configError } = await supabase
    .from("device_config")
    .select(
      "config_version, sample_interval_seconds, report_interval_seconds, min_threshold, max_threshold, alarm_delay_seconds, recovery_delay_seconds, hysteresis"
    )
    .eq("device_id", device.id)
    .maybeSingle();

  if (configError) {
    console.error("mide/config: error consultando configuración:", configError.message);
    return mideError(500, "Error interno del servidor");
  }

  if (!config) {
    return mideError(404, "Configuración no encontrada");
  }

  return mideOk({
    version: config.config_version,
    sampleIntervalSeconds: config.sample_interval_seconds,
    reportIntervalSeconds: config.report_interval_seconds,
    minThreshold: config.min_threshold,
    maxThreshold: config.max_threshold,
    alarmDelaySeconds: config.alarm_delay_seconds,
    recoveryDelaySeconds: config.recovery_delay_seconds,
    hysteresis: config.hysteresis,
  });
}
