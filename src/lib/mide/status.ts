// Pure helpers to derive display status from real device/measurement/config
// data. Nothing here invents alarms or connectivity that firmware hasn't
// actually reported — it only interprets data that already exists:
// devices.last_seen_at, device_config thresholds, and the latest
// measurements row. See docs/mide/dashboard.md for the full write-up of
// these rules.

export type DeviceStatus = "normal" | "alerta" | "sin_datos" | "sin_conexion";

export type ConnectivityTier = "fresh" | "delayed" | "offline";

/**
 * How many report intervals may pass before the device is considered
 * "delayed" (still shown as connected, but flagged in copy) or fully
 * "offline" (SIN CONEXIÓN). Multiples of the device's own configured
 * report_interval_seconds — never a hardcoded absolute duration — so a
 * device that reports every 30s and one that reports every 30min are each
 * judged against their own cadence.
 *
 * fresh:   gap <= interval * 2   (allows for normal jitter/retries)
 * delayed: interval * 2 < gap <= interval * 6
 * offline: gap > interval * 6
 */
const DELAYED_MULTIPLIER = 2;
const OFFLINE_MULTIPLIER = 6;

export function getConnectivityTier(
  lastSeenAt: string | null,
  reportIntervalSeconds: number | null,
  now: Date = new Date()
): ConnectivityTier | null {
  if (!lastSeenAt || !reportIntervalSeconds || reportIntervalSeconds <= 0) {
    return null;
  }

  const gapSeconds = (now.getTime() - new Date(lastSeenAt).getTime()) / 1000;

  if (gapSeconds <= reportIntervalSeconds * DELAYED_MULTIPLIER) return "fresh";
  if (gapSeconds <= reportIntervalSeconds * OFFLINE_MULTIPLIER) return "delayed";
  return "offline";
}

export function computeDeviceStatus(input: {
  hasEverReported: boolean;
  connectivity: ConnectivityTier | null;
  latestAvg: number | null;
  minThreshold: number | null;
  maxThreshold: number | null;
}): DeviceStatus {
  const { hasEverReported, connectivity, latestAvg, minThreshold, maxThreshold } = input;

  if (!hasEverReported || connectivity === null) return "sin_datos";
  if (connectivity === "offline") return "sin_conexion";

  if (
    latestAvg !== null &&
    ((minThreshold !== null && latestAvg < minThreshold) ||
      (maxThreshold !== null && latestAvg > maxThreshold))
  ) {
    return "alerta";
  }

  return "normal";
}

export const STATUS_LABEL: Record<DeviceStatus, string> = {
  normal: "Normal",
  alerta: "Alerta",
  sin_datos: "Sin datos",
  sin_conexion: "Sin conexión",
};

export const STATUS_DESCRIPTION: Record<DeviceStatus, string> = {
  normal: "La última lectura está dentro del rango configurado.",
  alerta: "La última lectura está fuera del rango configurado.",
  sin_datos: "No hay una medición de temperatura disponible para mostrar ahora mismo.",
  sin_conexion: "El dispositivo dejó de reportar hace más tiempo del esperado.",
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  TEMP_HIGH: "Temperatura alta",
  TEMP_LOW: "Temperatura baja",
  SENSOR_FAILURE: "Falla de sensor",
  DEVICE_STARTED: "Dispositivo iniciado",
  POWER_LOSS: "Corte de energía",
  POWER_RESTORED: "Energía restablecida",
  CONNECTION_RESTORED: "Conexión restablecida",
};

export function formatEventType(type: string): string {
  return (
    EVENT_TYPE_LABELS[type] ??
    type
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/^./, (c) => c.toUpperCase())
  );
}

export const EVENT_SEVERITY_LABEL: Record<string, string> = {
  info: "Info",
  warning: "Advertencia",
  critical: "Crítico",
};
