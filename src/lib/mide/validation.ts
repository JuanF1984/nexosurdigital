// Manual validation (no schema library) for the MIDE ingestion endpoints.
// The database also enforces these invariants via CHECK constraints, but we
// validate here too so devices get a clear 400 instead of a raw Postgres
// error, and so bad data never reaches the insert.

const DEVICE_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;
const METRIC_NAME_REGEX = /^[a-z][a-z0-9_]{0,49}$/;
const UNIT_REGEX = /^[A-Za-z%°][A-Za-z0-9%°/._-]{0,15}$/;
const EVENT_UID_REGEX = /^[A-Za-z0-9_-]{1,128}$/;
const EVENT_TYPE_REGEX = /^[A-Z][A-Z0-9_]{1,49}$/;
const ISO_DATETIME_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

const SEVERITIES = ["info", "warning", "critical"] as const;
type Severity = (typeof SEVERITIES)[number];

const REPORT_ALLOWED_FIELDS = new Set([
  "deviceId",
  "firmwareVersion",
  "periodStart",
  "periodEnd",
  "metrics",
]);
const METRIC_ALLOWED_FIELDS = new Set(["metric", "unit", "min", "max", "avg", "samples"]);
const MAX_METRICS_PER_REPORT = 20;

const EVENT_ALLOWED_FIELDS = new Set([
  "deviceId",
  "eventId",
  "type",
  "severity",
  "startedAt",
  "value",
  // Optional, added for the single-row episode model (open then close/recover
  // with the same eventId). A client that never sends these behaves exactly
  // as before.
  "endedAt",
  "peakValue",
  "metadata",
]);

// Experimental alarm-engine metadata is intentionally kept flat and bounded:
// scalar values only (no nested objects/arrays), few keys, short strings. The
// column is jsonb so the shape can evolve during Ensayo 2 without a migration,
// but the payload stays small and predictable.
const MAX_METADATA_KEYS = 20;
const MAX_METADATA_KEY_LENGTH = 40;
const MAX_METADATA_STRING_LENGTH = 64;
const MAX_METADATA_SERIALIZED_BYTES = 1024;

export type MetricInput = {
  metric: string;
  unit: string;
  min: number;
  max: number;
  avg: number;
  samples: number;
};

export type ReportPayload = {
  deviceId: string;
  firmwareVersion: string | null;
  periodStart: string;
  periodEnd: string;
  metrics: MetricInput[];
};

export type EventMetadata = Record<string, string | number | boolean | null>;

export type EventPayload = {
  deviceId: string;
  eventId: string;
  type: string;
  severity: Severity;
  startedAt: string;
  value: number | null;
  endedAt: string | null;
  peakValue: number | null;
  metadata: EventMetadata | null;
};

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function isValidDeviceId(value: unknown): value is string {
  return typeof value === "string" && DEVICE_ID_REGEX.test(value);
}

function isValidIsoDateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ISO_DATETIME_REGEX.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

export function validateReportPayload(body: unknown): Result<ReportPayload> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "El cuerpo debe ser un objeto JSON" };
  }

  for (const key of Object.keys(body as Record<string, unknown>)) {
    if (!REPORT_ALLOWED_FIELDS.has(key)) {
      return { ok: false, error: "Campo desconocido en el cuerpo" };
    }
  }

  const { deviceId, firmwareVersion, periodStart, periodEnd, metrics } =
    body as Record<string, unknown>;

  if (!isValidDeviceId(deviceId)) {
    return { ok: false, error: "deviceId inválido" };
  }

  if (firmwareVersion !== undefined && firmwareVersion !== null) {
    if (
      typeof firmwareVersion !== "string" ||
      firmwareVersion.length === 0 ||
      firmwareVersion.length > 32
    ) {
      return { ok: false, error: "firmwareVersion inválido" };
    }
  }

  if (!isValidIsoDateTime(periodStart)) {
    return { ok: false, error: "periodStart inválido" };
  }

  if (!isValidIsoDateTime(periodEnd)) {
    return { ok: false, error: "periodEnd inválido" };
  }

  if (Date.parse(periodEnd) <= Date.parse(periodStart)) {
    return { ok: false, error: "periodEnd debe ser posterior a periodStart" };
  }

  if (!Array.isArray(metrics) || metrics.length === 0) {
    return { ok: false, error: "metrics debe ser un array no vacío" };
  }

  if (metrics.length > MAX_METRICS_PER_REPORT) {
    return { ok: false, error: "metrics excede la cantidad máxima permitida" };
  }

  const parsedMetrics: MetricInput[] = [];
  const seenMetricNames = new Set<string>();

  for (const rawMetric of metrics) {
    if (typeof rawMetric !== "object" || rawMetric === null || Array.isArray(rawMetric)) {
      return { ok: false, error: "Cada elemento de metrics debe ser un objeto" };
    }

    for (const key of Object.keys(rawMetric as Record<string, unknown>)) {
      if (!METRIC_ALLOWED_FIELDS.has(key)) {
        return { ok: false, error: "Campo desconocido en metrics" };
      }
    }

    const { metric, unit, min, max, avg, samples } = rawMetric as Record<string, unknown>;

    if (typeof metric !== "string" || !METRIC_NAME_REGEX.test(metric)) {
      return { ok: false, error: "metric inválido" };
    }

    // One row per (device, metric, period): a report may not carry the same
    // metric twice, or the idempotent upsert in mide_ingest_report would try
    // to touch the same conflict target twice in one statement.
    if (seenMetricNames.has(metric)) {
      return { ok: false, error: "metric repetido en el mismo reporte" };
    }
    seenMetricNames.add(metric);

    if (typeof unit !== "string" || !UNIT_REGEX.test(unit)) {
      return { ok: false, error: "unit inválido" };
    }

    if (typeof min !== "number" || !Number.isFinite(min)) {
      return { ok: false, error: "min inválido" };
    }

    if (typeof max !== "number" || !Number.isFinite(max)) {
      return { ok: false, error: "max inválido" };
    }

    if (typeof avg !== "number" || !Number.isFinite(avg)) {
      return { ok: false, error: "avg inválido" };
    }

    if (!(min <= avg && avg <= max)) {
      return { ok: false, error: "los valores deben cumplir min <= avg <= max" };
    }

    if (typeof samples !== "number" || !Number.isInteger(samples) || samples <= 0) {
      return { ok: false, error: "samples inválido" };
    }

    parsedMetrics.push({ metric, unit, min, max, avg, samples });
  }

  return {
    ok: true,
    value: {
      deviceId,
      firmwareVersion: (firmwareVersion as string | undefined) ?? null,
      periodStart,
      periodEnd,
      metrics: parsedMetrics,
    },
  };
}

export function validateEventPayload(body: unknown): Result<EventPayload> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "El cuerpo debe ser un objeto JSON" };
  }

  for (const key of Object.keys(body as Record<string, unknown>)) {
    if (!EVENT_ALLOWED_FIELDS.has(key)) {
      return { ok: false, error: "Campo desconocido en el cuerpo" };
    }
  }

  const { deviceId, eventId, type, severity, startedAt, value, endedAt, peakValue, metadata } =
    body as Record<string, unknown>;

  if (!isValidDeviceId(deviceId)) {
    return { ok: false, error: "deviceId inválido" };
  }

  if (typeof eventId !== "string" || !EVENT_UID_REGEX.test(eventId)) {
    return { ok: false, error: "eventId inválido" };
  }

  if (typeof type !== "string" || !EVENT_TYPE_REGEX.test(type)) {
    return { ok: false, error: "type inválido" };
  }

  if (typeof severity !== "string" || !(SEVERITIES as readonly string[]).includes(severity)) {
    return { ok: false, error: "severity inválido" };
  }

  if (!isValidIsoDateTime(startedAt)) {
    return { ok: false, error: "startedAt inválido" };
  }

  if (value !== undefined && value !== null) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ok: false, error: "value inválido" };
    }
  }

  // endedAt present => this POST closes/resolves the episode identified by
  // (deviceId, eventId). Absent => it opens (or is a retry of the open).
  if (endedAt !== undefined && endedAt !== null) {
    if (!isValidIsoDateTime(endedAt)) {
      return { ok: false, error: "endedAt inválido" };
    }
    if (Date.parse(endedAt) < Date.parse(startedAt)) {
      return { ok: false, error: "endedAt no puede ser anterior a startedAt" };
    }
  }

  if (peakValue !== undefined && peakValue !== null) {
    if (typeof peakValue !== "number" || !Number.isFinite(peakValue)) {
      return { ok: false, error: "peakValue inválido" };
    }
  }

  let parsedMetadata: EventMetadata | null = null;
  if (metadata !== undefined && metadata !== null) {
    if (typeof metadata !== "object" || Array.isArray(metadata)) {
      return { ok: false, error: "metadata debe ser un objeto plano" };
    }
    const entries = Object.entries(metadata as Record<string, unknown>);
    if (entries.length > MAX_METADATA_KEYS) {
      return { ok: false, error: "metadata excede la cantidad máxima de claves" };
    }
    for (const [key, metaValue] of entries) {
      if (key.length === 0 || key.length > MAX_METADATA_KEY_LENGTH) {
        return { ok: false, error: "clave de metadata inválida" };
      }
      const t = typeof metaValue;
      if (metaValue === null || t === "number" || t === "boolean") {
        if (t === "number" && !Number.isFinite(metaValue as number)) {
          return { ok: false, error: "valor numérico de metadata inválido" };
        }
        continue;
      }
      if (t === "string") {
        if ((metaValue as string).length > MAX_METADATA_STRING_LENGTH) {
          return { ok: false, error: "valor de texto de metadata demasiado largo" };
        }
        continue;
      }
      return { ok: false, error: "metadata sólo admite valores escalares" };
    }
    if (Buffer.byteLength(JSON.stringify(metadata), "utf8") > MAX_METADATA_SERIALIZED_BYTES) {
      return { ok: false, error: "metadata demasiado grande" };
    }
    parsedMetadata = metadata as EventMetadata;
  }

  return {
    ok: true,
    value: {
      deviceId,
      eventId,
      type,
      severity: severity as Severity,
      startedAt,
      value: (value as number | undefined) ?? null,
      endedAt: (endedAt as string | undefined) ?? null,
      peakValue: (peakValue as number | undefined) ?? null,
      metadata: parsedMetadata,
    },
  };
}
