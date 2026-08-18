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
]);

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

export type EventPayload = {
  deviceId: string;
  eventId: string;
  type: string;
  severity: Severity;
  startedAt: string;
  value: number | null;
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

  const { deviceId, eventId, type, severity, startedAt, value } =
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

  return {
    ok: true,
    value: {
      deviceId,
      eventId,
      type,
      severity: severity as Severity,
      startedAt,
      value: (value as number | undefined) ?? null,
    },
  };
}
