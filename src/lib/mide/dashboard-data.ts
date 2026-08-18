import type { SupabaseClient } from "@supabase/supabase-js";
import { getMideSupabaseClient } from "@/lib/mide/supabase";

// Server-only read access for the MIDE dashboard. Uses the same service-role
// client as the ingestion routes — never imported from client components.
// Requires SELECT on `measurements` and `events`, which the ingestion API
// does not need and therefore does not have by default (it only INSERTs).
// See docs/mide/dashboard.md for the exact GRANT statements to run and why
// each query below degrades to an "unavailable" section instead of crashing
// the page if those grants aren't applied yet.

export type DeviceRecord = {
  id: string;
  deviceCode: string;
  deviceType: string;
  name: string;
  location: string | null;
  active: boolean;
  firmwareVersion: string | null;
  lastSeenAt: string | null;
};

export type DeviceConfigRecord = {
  configVersion: number;
  sampleIntervalSeconds: number;
  reportIntervalSeconds: number;
  minThreshold: number | null;
  maxThreshold: number | null;
  alarmDelaySeconds: number | null;
  recoveryDelaySeconds: number | null;
  hysteresis: number | null;
};

export type MeasurementPoint = {
  periodStart: string;
  periodEnd: string;
  min: number;
  max: number;
  avg: number;
  samples: number;
};

export type EventRecord = {
  id: string;
  type: string;
  severity: string;
  startedAt: string;
  endedAt: string | null;
  valueAtStart: number | null;
  peakValue: number | null;
  status: string;
};

export type SectionResult<T> = { ok: true; data: T } | { ok: false };

export type DeviceDashboardData = {
  device: DeviceRecord | null;
  config: DeviceConfigRecord | null;
  measurements: SectionResult<MeasurementPoint[]>;
  events: SectionResult<EventRecord[]>;
};

const TEMPERATURE_METRIC = "temperature";
const MEASUREMENTS_WINDOW_HOURS = 24;
const MEASUREMENTS_MAX_ROWS = 500;
const EVENTS_MAX_ROWS = 20;

export async function getDeviceDashboardData(deviceCode: string): Promise<DeviceDashboardData> {
  const supabase = getMideSupabaseClient();

  const { data: deviceRow, error: deviceError } = await supabase
    .from("devices")
    .select(
      "id, device_code, device_type, name, location, active, firmware_version, last_seen_at"
    )
    .eq("device_code", deviceCode)
    .maybeSingle();

  if (deviceError) {
    console.error("mide/dashboard: error consultando dispositivo:", deviceError.message);
  }

  if (!deviceRow) {
    return { device: null, config: null, measurements: { ok: false }, events: { ok: false } };
  }

  const device: DeviceRecord = {
    id: deviceRow.id,
    deviceCode: deviceRow.device_code,
    deviceType: deviceRow.device_type,
    name: deviceRow.name,
    location: deviceRow.location,
    active: deviceRow.active,
    firmwareVersion: deviceRow.firmware_version,
    lastSeenAt: deviceRow.last_seen_at,
  };

  const [config, measurements, events] = await Promise.all([
    fetchConfig(supabase, device.id),
    fetchMeasurements(supabase, device.id),
    fetchEvents(supabase, device.id),
  ]);

  return { device, config, measurements, events };
}

async function fetchConfig(
  supabase: SupabaseClient,
  deviceId: string
): Promise<DeviceConfigRecord | null> {
  const { data, error } = await supabase
    .from("device_config")
    .select(
      "config_version, sample_interval_seconds, report_interval_seconds, min_threshold, max_threshold, alarm_delay_seconds, recovery_delay_seconds, hysteresis"
    )
    .eq("device_id", deviceId)
    .maybeSingle();

  if (error) {
    console.error("mide/dashboard: error consultando configuración:", error.message);
    return null;
  }
  if (!data) return null;

  return {
    configVersion: data.config_version,
    sampleIntervalSeconds: data.sample_interval_seconds,
    reportIntervalSeconds: data.report_interval_seconds,
    minThreshold: data.min_threshold,
    maxThreshold: data.max_threshold,
    alarmDelaySeconds: data.alarm_delay_seconds,
    recoveryDelaySeconds: data.recovery_delay_seconds,
    hysteresis: data.hysteresis,
  };
}

async function fetchMeasurements(
  supabase: SupabaseClient,
  deviceId: string
): Promise<SectionResult<MeasurementPoint[]>> {
  const since = new Date(Date.now() - MEASUREMENTS_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("measurements")
    .select("period_start, period_end, min_value, max_value, avg_value, sample_count")
    .eq("device_id", deviceId)
    .eq("metric", TEMPERATURE_METRIC)
    .gte("period_start", since)
    .order("period_start", { ascending: true })
    .limit(MEASUREMENTS_MAX_ROWS);

  if (error) {
    // Expected until `grant select on public.measurements to service_role;`
    // is applied — see docs/mide/dashboard.md. Logged, never shown raw to
    // the user.
    console.error("mide/dashboard: error consultando mediciones:", error.message);
    return { ok: false };
  }

  return {
    ok: true,
    data: (data ?? []).map((row) => ({
      periodStart: row.period_start,
      periodEnd: row.period_end,
      min: row.min_value,
      max: row.max_value,
      avg: row.avg_value,
      samples: row.sample_count,
    })),
  };
}

async function fetchEvents(
  supabase: SupabaseClient,
  deviceId: string
): Promise<SectionResult<EventRecord[]>> {
  const { data, error } = await supabase
    .from("events")
    .select("id, event_type, severity, started_at, ended_at, value_at_start, peak_value, status")
    .eq("device_id", deviceId)
    .order("started_at", { ascending: false })
    .limit(EVENTS_MAX_ROWS);

  if (error) {
    // Expected until `grant select on public.events to service_role;` is
    // applied — see docs/mide/dashboard.md.
    console.error("mide/dashboard: error consultando eventos:", error.message);
    return { ok: false };
  }

  return {
    ok: true,
    data: (data ?? []).map((row) => ({
      id: row.id,
      type: row.event_type,
      severity: row.severity,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      valueAtStart: row.value_at_start,
      peakValue: row.peak_value,
      status: row.status,
    })),
  };
}
