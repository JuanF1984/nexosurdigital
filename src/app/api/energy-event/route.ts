import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { Resend } from "resend";

// Requires Node.js APIs (crypto.timingSafeEqual, Resend SDK) - must not run on the Edge runtime.
export const runtime = "nodejs";

const ALLOWED_EVENTS = ["CORTE", "BAJA_TENSION", "RESTAURADO", "NORMAL"] as const;
type EnergyEventType = (typeof ALLOWED_EVENTS)[number];

const EVENT_LABELS: Record<EnergyEventType, string> = {
  CORTE: "Corte de energía",
  BAJA_TENSION: "Baja tensión",
  RESTAURADO: "Energía restaurada",
  NORMAL: "Estado normal",
};

const EVENT_SUBJECTS: Record<EnergyEventType, string> = {
  CORTE: "Corte de energía detectado",
  BAJA_TENSION: "Baja tensión detectada",
  RESTAURADO: "Energía restaurada",
  NORMAL: "Reporte de estado normal",
};

const DEVICE_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;
// ISO 8601 date-time with mandatory offset (Z or +/-HH:MM), e.g. 2026-08-01T17:18:55-03:00
const ISO_DATETIME_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

const MAX_BODY_BYTES = 4096; // small, fixed-shape payload; no legitimate reason to be larger
const ALLOWED_FIELDS = new Set([
  "deviceId",
  "event",
  "dateTime",
  "durationSeconds",
  "cutStartedAt",
  "restoredAt",
]);

// Tolerance for rounding/delivery delays when checking that durationSeconds
// matches the (restoredAt - cutStartedAt) difference reported by the device.
const DURATION_TOLERANCE_SECONDS = 2;

type RestoredPayload = {
  deviceId: string;
  event: "RESTAURADO";
  cutStartedAt: string;
  restoredAt: string;
  durationSeconds: number;
};

type StandardPayload = {
  deviceId: string;
  event: Exclude<EnergyEventType, "RESTAURADO">;
  dateTime: string;
  durationSeconds: null;
};

type ParsedPayload = RestoredPayload | StandardPayload;

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

/**
 * Constant-time comparison that also avoids leaking information (or throwing)
 * when the two inputs have different lengths, by comparing fixed-length
 * digests instead of the raw strings.
 */
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} h`);
  if (minutes > 0) parts.push(`${minutes} min`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds} s`);
  return parts.join(" ");
}

function isValidIsoDateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ISO_DATETIME_REGEX.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null;
}

/**
 * Validates the parsed JSON body against the fixed schema. Returns either
 * the typed payload or an error message describing the first problem found.
 * No unknown fields are accepted. The shape required depends on `event`:
 * RESTAURADO requires cutStartedAt/restoredAt/durationSeconds and forbids
 * dateTime; every other event keeps the original dateTime-based shape and
 * forbids cutStartedAt/restoredAt.
 */
function validatePayload(
  body: unknown
): { ok: true; value: ParsedPayload } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "El cuerpo debe ser un objeto JSON" };
  }

  for (const key of Object.keys(body as Record<string, unknown>)) {
    if (!ALLOWED_FIELDS.has(key)) {
      return { ok: false, error: "Campo desconocido en el cuerpo" };
    }
  }

  const { deviceId, event, dateTime, durationSeconds, cutStartedAt, restoredAt } =
    body as Record<string, unknown>;

  if (typeof deviceId !== "string" || !DEVICE_ID_REGEX.test(deviceId)) {
    return { ok: false, error: "deviceId inválido" };
  }

  if (typeof event !== "string" || !(ALLOWED_EVENTS as readonly string[]).includes(event)) {
    return { ok: false, error: "event inválido" };
  }
  const eventType = event as EnergyEventType;

  if (eventType === "RESTAURADO") {
    if (!isAbsent(dateTime)) {
      return { ok: false, error: "dateTime no debe enviarse para RESTAURADO" };
    }

    if (!isValidIsoDateTime(cutStartedAt)) {
      return { ok: false, error: "cutStartedAt inválido" };
    }

    if (!isValidIsoDateTime(restoredAt)) {
      return { ok: false, error: "restoredAt inválido" };
    }

    if (
      typeof durationSeconds !== "number" ||
      !Number.isInteger(durationSeconds) ||
      durationSeconds < 0 ||
      durationSeconds > 604800
    ) {
      return { ok: false, error: "durationSeconds inválido" };
    }

    const cutMs = Date.parse(cutStartedAt);
    const restoredMs = Date.parse(restoredAt);

    if (restoredMs < cutMs) {
      return { ok: false, error: "restoredAt debe ser posterior o igual a cutStartedAt" };
    }

    const actualDiffSeconds = (restoredMs - cutMs) / 1000;
    if (Math.abs(actualDiffSeconds - durationSeconds) > DURATION_TOLERANCE_SECONDS) {
      return {
        ok: false,
        error: "durationSeconds no coincide con la diferencia entre restoredAt y cutStartedAt",
      };
    }

    return {
      ok: true,
      value: { deviceId, event: eventType, cutStartedAt, restoredAt, durationSeconds },
    };
  }

  // CORTE, BAJA_TENSION, NORMAL and any other currently-allowed non-RESTAURADO event.
  if (!isAbsent(cutStartedAt)) {
    return { ok: false, error: "cutStartedAt solo es válido para RESTAURADO" };
  }

  if (!isAbsent(restoredAt)) {
    return { ok: false, error: "restoredAt solo es válido para RESTAURADO" };
  }

  if (!isValidIsoDateTime(dateTime)) {
    return { ok: false, error: "dateTime inválido" };
  }

  if (durationSeconds !== null) {
    if (typeof durationSeconds === "number") {
      return { ok: false, error: "durationSeconds solo es válido para RESTAURADO" };
    }
    return { ok: false, error: "durationSeconds inválido" };
  }

  return {
    ok: true,
    value: { deviceId, event: eventType, dateTime, durationSeconds: null },
  };
}

function buildEmail(payload: ParsedPayload) {
  const { deviceId, event } = payload;
  const subject = `${EVENT_SUBJECTS[event]} - ${deviceId}`;

  if (event === "RESTAURADO") {
    const { cutStartedAt, restoredAt, durationSeconds } = payload;
    const durationText = formatDuration(durationSeconds);

    const text = [
      `Dispositivo: ${deviceId}`,
      `Evento: ${EVENT_LABELS[event]}`,
      `Inicio del corte: ${cutStartedAt}`,
      `Restauración del servicio: ${restoredAt}`,
      `Duración total: ${durationText}`,
    ].join("\n");

    const html = `<div style="font-family:sans-serif;font-size:14px;color:#111">
  <h2 style="margin:0 0 12px">${escapeHtml(EVENT_SUBJECTS[event])}</h2>
  <p style="margin:4px 0"><strong>Dispositivo:</strong> ${escapeHtml(deviceId)}</p>
  <p style="margin:4px 0"><strong>Evento:</strong> ${escapeHtml(EVENT_LABELS[event])}</p>
  <p style="margin:4px 0"><strong>Inicio del corte:</strong> ${escapeHtml(cutStartedAt)}</p>
  <p style="margin:4px 0"><strong>Restauración del servicio:</strong> ${escapeHtml(restoredAt)}</p>
  <p style="margin:4px 0"><strong>Duración total:</strong> ${escapeHtml(durationText)}</p>
</div>`;

    return { subject, text, html };
  }

  const { dateTime } = payload;

  const text = [
    `Dispositivo: ${deviceId}`,
    `Evento: ${EVENT_LABELS[event]}`,
    `Fecha y hora: ${dateTime}`,
  ].join("\n");

  const html = `<div style="font-family:sans-serif;font-size:14px;color:#111">
  <h2 style="margin:0 0 12px">${escapeHtml(EVENT_SUBJECTS[event])}</h2>
  <p style="margin:4px 0"><strong>Dispositivo:</strong> ${escapeHtml(deviceId)}</p>
  <p style="margin:4px 0"><strong>Evento:</strong> ${escapeHtml(EVENT_LABELS[event])}</p>
  <p style="margin:4px 0"><strong>Fecha y hora:</strong> ${escapeHtml(dateTime)}</p>
</div>`;

  return { subject, text, html };
}

export async function POST(request: NextRequest) {
  const deviceApiKey = process.env.DEVICE_API_KEY;
  const resendApiKey = process.env.RESEND_API_KEY;
  const alertEmailTo = process.env.ALERT_EMAIL_TO;
  const alertEmailFrom = process.env.ALERT_EMAIL_FROM;

  if (!deviceApiKey || !resendApiKey || !alertEmailTo || !alertEmailFrom) {
    console.error("energy-event: missing required server environment variables");
    return jsonError(500, "Error interno del servidor");
  }

  const token = extractBearerToken(request.headers.get("authorization"));
  if (!token || !safeCompare(token, deviceApiKey)) {
    return jsonError(401, "No autorizado");
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return jsonError(415, "Content-Type debe ser application/json");
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return jsonError(400, "No se pudo leer el cuerpo de la petición");
  }

  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return jsonError(400, "El cuerpo de la petición es demasiado grande");
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return jsonError(400, "JSON inválido");
  }

  const validation = validatePayload(parsedBody);
  if (!validation.ok) {
    return jsonError(400, validation.error);
  }

  const { subject, text, html } = buildEmail(validation.value);
  const recipients = alertEmailTo
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);

  try {
    const resend = new Resend(resendApiKey);
    const { data, error } = await resend.emails.send({
      from: alertEmailFrom,
      to: recipients,
      subject,
      text,
      html,
    });

    if (error || !data?.id) {
      console.error("energy-event: Resend no confirmó el envío del correo");
      return jsonError(500, "No se pudo enviar el correo de alerta");
    }

    return NextResponse.json({ ok: true, emailId: data.id }, { status: 200 });
  } catch {
    console.error("energy-event: error inesperado al enviar el correo");
    return jsonError(500, "Error interno del servidor");
  }
}
