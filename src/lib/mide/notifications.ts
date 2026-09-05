// E-mail notifications for MIDE Frío thermal alarms (Ensayo 2).
//
// Kept fully separate from /api/energy-event: its own env vars
// (MIDE_RESEND_API_KEY / MIDE_ALERT_EMAIL_FROM / MIDE_ALERT_EMAIL_TO), no
// shared imports. The small HTML/format helpers below are deliberately
// copied from energy-event rather than imported, to preserve that boundary
// (see docs/mide/arquitectura.md).
//
// The route decides WHEN to notify and owns the DB-backed idempotency claim
// (mide_claim_event_notification). This module only builds the message and
// hands it to Resend, and it never throws: a provider failure is reported
// through the return value so the event stays persisted and the API stays 2xx.

import { Resend } from "resend";

const ALERT_REASON_LABELS: Record<string, string> = {
  GRAVEDAD: "Gravedad: la temperatura entró en una banda crítica",
  PERSISTENCIA_ASCENDENTE:
    "Persistencia: fuera de rango y todavía subiendo",
  PERSISTENCIA_ESTABLE:
    "Persistencia: fuera de rango de forma sostenida",
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: "Crítica",
  warning: "Advertencia",
  info: "Informativa",
};

export type MideEmailConfig = {
  apiKey: string;
  from: string;
  recipients: string[];
};

export type MideEmailContent = { subject: string; text: string; html: string };

export type AlertEmailInput = {
  deviceId: string;
  /** °C at the moment the alarm fired (value_at_start). */
  temperature: number | null;
  /** Configured high threshold from device_config, if available. */
  threshold: number | null;
  /** Raw alarm-engine reason: GRAVEDAD | PERSISTENCIA_ASCENDENTE | PERSISTENCIA_ESTABLE. */
  reason: string | null;
  /** "critical" | "warning" | "info". */
  severity: string;
  /** ISO 8601 with offset, as sent by the firmware. */
  startedAt: string;
};

export type RecoveryEmailInput = {
  deviceId: string;
  /** °C reported with the close POST (peak_value), i.e. the worst point. */
  peakTemperature: number | null;
  /** Episode length in milliseconds, from the firmware metadata, if present. */
  durationMs: number | null;
  /** ISO 8601 with offset. */
  endedAt: string;
};

/**
 * Reads the MIDE e-mail env vars. Returns null when any is missing or blank,
 * which the caller treats as "notifications not configured" — the event is
 * still persisted, the API still answers 2xx.
 */
export function getMideEmailConfig(): MideEmailConfig | null {
  const apiKey = process.env.MIDE_RESEND_API_KEY?.trim();
  const from = process.env.MIDE_ALERT_EMAIL_FROM?.trim();
  const rawTo = process.env.MIDE_ALERT_EMAIL_TO ?? "";

  const recipients = rawTo
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);

  if (!apiKey || !from || recipients.length === 0) return null;

  return { apiKey, from, recipients };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const AR_DATETIME = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Argentina/Buenos_Aires",
});

/** ISO (with offset) -> "05/09/2026, 08:17" in Argentina time, or the raw
 *  string if it cannot be parsed. */
function formatDateTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return AR_DATETIME.format(new Date(ms));
}

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} h`);
  if (minutes > 0) parts.push(`${minutes} min`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds} s`);
  return parts.join(" ");
}

function formatCelsius(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${value.toFixed(1)} °C`;
}

type Line = { label: string; value: string };

function renderText(title: string, lines: Line[]): string {
  return [title, "", ...lines.map((l) => `${l.label}: ${l.value}`)].join("\n");
}

function renderHtml(title: string, lines: Line[]): string {
  const rows = lines
    .map(
      (l) =>
        `  <p style="margin:4px 0"><strong>${escapeHtml(l.label)}:</strong> ${escapeHtml(
          l.value
        )}</p>`
    )
    .join("\n");
  return `<div style="font-family:sans-serif;font-size:14px;color:#111">
  <h2 style="margin:0 0 12px">${escapeHtml(title)}</h2>
${rows}
</div>`;
}

export function buildAlertEmail(input: AlertEmailInput): MideEmailContent {
  const title = "MIDE Frío — Alerta de temperatura";
  const subject = `Alerta de temperatura — ${input.deviceId}`;

  const lines: Line[] = [{ label: "Dispositivo", value: input.deviceId }];

  const temp = formatCelsius(input.temperature);
  if (temp) lines.push({ label: "Temperatura", value: temp });

  const threshold = formatCelsius(input.threshold);
  if (threshold) lines.push({ label: "Umbral configurado", value: threshold });

  if (
    input.temperature != null &&
    Number.isFinite(input.temperature) &&
    input.threshold != null &&
    Number.isFinite(input.threshold)
  ) {
    const deviation = input.temperature - input.threshold;
    const sign = deviation > 0 ? "+" : "";
    lines.push({
      label: "Desviación respecto del umbral",
      value: `${sign}${deviation.toFixed(1)} °C`,
    });
  }

  if (input.reason && ALERT_REASON_LABELS[input.reason]) {
    lines.push({ label: "Motivo", value: ALERT_REASON_LABELS[input.reason] });
  }

  lines.push({
    label: "Severidad",
    value: SEVERITY_LABELS[input.severity] ?? input.severity,
  });
  lines.push({ label: "Fecha y hora", value: formatDateTime(input.startedAt) });

  return { subject, text: renderText(title, lines), html: renderHtml(title, lines) };
}

export function buildRecoveryEmail(input: RecoveryEmailInput): MideEmailContent {
  const title = "MIDE Frío — Temperatura normalizada";
  const subject = `Temperatura normalizada — ${input.deviceId}`;

  const lines: Line[] = [{ label: "Dispositivo", value: input.deviceId }];

  const peak = formatCelsius(input.peakTemperature);
  if (peak) lines.push({ label: "Pico durante el episodio", value: peak });

  if (input.durationMs != null && Number.isFinite(input.durationMs) && input.durationMs >= 0) {
    lines.push({
      label: "Duración del episodio",
      value: formatDuration(input.durationMs / 1000),
    });
  }

  lines.push({ label: "Recuperación", value: formatDateTime(input.endedAt) });

  return { subject, text: renderText(title, lines), html: renderHtml(title, lines) };
}

/**
 * Hands one message to Resend. Never throws: returns { ok: false } on any
 * error (missing id, provider error, network throw) after logging a message
 * with no secrets in it. The caller keeps the event persisted regardless and
 * releases its notification claim so a later retry can re-attempt.
 */
export async function sendMideEmail(
  config: MideEmailConfig,
  content: MideEmailContent
): Promise<{ ok: boolean }> {
  try {
    const resend = new Resend(config.apiKey);
    const { data, error } = await resend.emails.send({
      from: config.from,
      to: config.recipients,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });

    if (error || !data?.id) {
      console.error("mide/event: el proveedor de e-mail no confirmó el envío");
      return { ok: false };
    }
    return { ok: true };
  } catch {
    console.error("mide/event: error inesperado al enviar el e-mail de notificación");
    return { ok: false };
  }
}
