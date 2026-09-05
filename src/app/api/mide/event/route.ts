import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getMideSupabaseClient } from "@/lib/mide/supabase";
import { isAuthorizedDevice } from "@/lib/mide/auth";
import { mideOk, mideError } from "@/lib/mide/http";
import { validateEventPayload, type EventMetadata } from "@/lib/mide/validation";
import {
  getMideEmailConfig,
  buildAlertEmail,
  buildRecoveryEmail,
  sendMideEmail,
} from "@/lib/mide/notifications";

// Requires Node.js APIs (crypto.timingSafeEqual via mide/auth, Resend SDK) - must not run on the Edge runtime.
export const runtime = "nodejs";

const MAX_BODY_BYTES = 4096;

// The firmware alarm engine only POSTs an "open" when a real alert fired, and
// always stamps metadata.reason with one of these. Gating on it here is the
// explicit belt-and-suspenders the Ensayo 2 spec asks for: an excursion that
// stayed in OBSERVACION and recovered on its own never reaches this endpoint,
// and if one ever did (no reason / NINGUNO) it would not send an e-mail.
const ALERT_REASONS = new Set([
  "GRAVEDAD",
  "PERSISTENCIA_ASCENDENTE",
  "PERSISTENCIA_ESTABLE",
]);

type UpsertEventRow = {
  was_inserted?: boolean;
  event_status?: string;
  event_id?: string;
  event_value?: number | null;
  event_peak?: number | null;
  event_started_at?: string | null;
  event_ended_at?: string | null;
};

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

  const row: UpsertEventRow = (Array.isArray(rpcRows) ? rpcRows[0] : rpcRows) ?? {};
  const created = row.was_inserted ?? true;
  const resolved = row.event_status === "resolved";

  // Fire the e-mail notification for this POST, if it warrants one. Never lets
  // an e-mail problem change the API result: the event is already persisted.
  await maybeNotify({
    supabase,
    deviceRowId: device.id,
    deviceId,
    eventRowId: row.event_id ?? null,
    isClose: endedAt != null,
    severity,
    startedAt,
    metadata,
    valueAtStart: row.event_value ?? value ?? null,
    peakValue: row.event_peak ?? peakValue ?? null,
    endedAtStored: row.event_ended_at ?? endedAt ?? null,
  });

  // `duplicate` keeps its original meaning (an open POST that changed
  // nothing). A close POST reports through `resolved` instead.
  if (endedAt != null) {
    return mideOk({ resolved, created });
  }
  return mideOk({ duplicate: !created });
}

type NotifyArgs = {
  supabase: SupabaseClient;
  deviceRowId: string;
  deviceId: string;
  eventRowId: string | null;
  isClose: boolean;
  severity: string;
  startedAt: string;
  metadata: EventMetadata | null;
  valueAtStart: number | null;
  peakValue: number | null;
  endedAtStored: string | null;
};

/**
 * Sends the ALERT e-mail (on the alarm-engine open) or the RECOVERY e-mail
 * (on the close/recover POST), each at most once per episode. Idempotency is
 * DB-backed and two-phase:
 *   1. mide_claim_event_notification — a per-kind 2-min lease; only one caller
 *      wins it, so concurrent firmware retries never both send. A crash after
 *      this point leaves the lease to expire and the episode retryable.
 *   2. mide_confirm_event_notification — the permanent "sent" marker, written
 *      only after the provider accepts the message; a confirmed kind is never
 *      claimed again.
 * A send that fails while the process is alive calls
 * mide_release_event_notification to drop the lease immediately. Everything
 * here is best-effort and swallowed — the episode row is already committed and
 * the API answer must not depend on the mail provider.
 */
async function maybeNotify(args: NotifyArgs): Promise<void> {
  const { supabase, eventRowId, isClose, metadata } = args;

  const reason = typeof metadata?.reason === "string" ? metadata.reason : null;
  const isAlertOpen = !isClose && reason != null && ALERT_REASONS.has(reason);
  if (!eventRowId || (!isAlertOpen && !isClose)) return;

  const kind = isClose ? "recovery" : "alert";

  const emailConfig = getMideEmailConfig();
  if (!emailConfig) {
    console.warn(
      "mide/event: notificaciones por e-mail no configuradas " +
        "(MIDE_RESEND_API_KEY / MIDE_ALERT_EMAIL_FROM / MIDE_ALERT_EMAIL_TO); " +
        "evento persistido, e-mail omitido"
    );
    return;
  }

  try {
    const { data: claimed, error: claimError } = await supabase.rpc(
      "mide_claim_event_notification",
      { p_event_id: eventRowId, p_kind: kind }
    );
    if (claimError) {
      console.error("mide/event: error reservando la notificación:", claimError.message);
      return;
    }
    // Already notified (a retry of the same open/close): do not re-send.
    if (claimed !== true) return;

    let content;
    if (isClose) {
      const durationMs =
        typeof metadata?.durationMs === "number" ? metadata.durationMs : null;
      content = buildRecoveryEmail({
        deviceId: args.deviceId,
        peakTemperature: args.peakValue,
        durationMs,
        endedAt: args.endedAtStored ?? new Date().toISOString(),
      });
    } else {
      let threshold: number | null = null;
      const { data: cfg, error: cfgError } = await supabase
        .from("device_config")
        .select("max_threshold")
        .eq("device_id", args.deviceRowId)
        .maybeSingle();
      if (cfgError) {
        console.error(
          "mide/event: no se pudo leer device_config para el e-mail:",
          cfgError.message
        );
      } else if (cfg && typeof cfg.max_threshold === "number") {
        threshold = cfg.max_threshold;
      }
      content = buildAlertEmail({
        deviceId: args.deviceId,
        temperature: args.valueAtStart,
        threshold,
        reason,
        severity: args.severity,
        startedAt: args.startedAt,
      });
    }

    const { ok } = await sendMideEmail(emailConfig, content);

    if (ok) {
      // Provider accepted it: mark the kind permanently sent so no retry ever
      // re-sends. Until this runs, the claim is just a 2-min lease — a crash
      // here leaves the episode retryable, not falsely "notified".
      const { error: confirmError } = await supabase.rpc(
        "mide_confirm_event_notification",
        { p_event_id: eventRowId, p_kind: kind }
      );
      if (confirmError) {
        console.error(
          "mide/event: e-mail enviado pero no se pudo confirmar la notificación:",
          confirmError.message
        );
      }
      return;
    }

    // Send failed while the process is alive: drop the claim now so the next
    // firmware retry re-attempts immediately instead of waiting out the lease.
    // The event itself stays persisted; the failure is already logged.
    const { error: releaseError } = await supabase.rpc(
      "mide_release_event_notification",
      { p_event_id: eventRowId, p_kind: kind }
    );
    if (releaseError) {
      console.error(
        "mide/event: no se pudo liberar la reserva de notificación:",
        releaseError.message
      );
    }
  } catch (err) {
    console.error(
      "mide/event: fallo inesperado en la notificación por e-mail:",
      err instanceof Error ? err.message : "error desconocido"
    );
  }
}
