// In-memory stand-in for the MIDE Supabase client, used by the route tests.
// It emulates only what the /api/mide/* handlers actually call:
//   - from("devices").select(...).eq(...).maybeSingle()
//   - from("device_config").select(...).eq(...).maybeSingle()
//   - rpc("mide_upsert_event", ...)               -> single-row-per-episode upsert
//   - rpc("mide_claim_event_notification", ...)   -> per-kind lease claim
//   - rpc("mide_confirm_event_notification", ...) -> per-kind confirmed-sent mark
//   - rpc("mide_release_event_notification", ...) -> per-kind claim rollback
//   - rpc("mide_ingest_report", ...)              -> one-row-per-period idempotent upsert
// and it enforces the same uniqueness / "keep the most complete" rules the
// real Postgres functions do, so idempotency can be asserted without a DB.

export type FakeDevice = { id: string; device_code: string; active: boolean };
export type FakeDeviceConfig = { device_id: string; max_threshold: number | null };

type FakeEventRow = {
  id: string;
  device_id: string;
  event_uid: string;
  event_type: string;
  severity: string;
  started_at: string;
  value_at_start: number | null;
  ended_at: string | null;
  peak_value: number | null;
  status: "open" | "resolved";
  metadata: Record<string, unknown>;
  alert_notified_at: string | null;
  recovery_notified_at: string | null;
  alert_notify_claimed_at: string | null;
  recovery_notify_claimed_at: string | null;
};

type FakeMeasurementRow = {
  device_id: string;
  metric: string;
  unit: string;
  period_start: string;
  period_end: string;
  min_value: number;
  max_value: number;
  avg_value: number;
  sample_count: number;
};

let eventIdCounter = 0;

export class FakeSupabase {
  // Mirrors the lease in mide_claim_event_notification (interval '2 minutes').
  static readonly NOTIFY_LEASE_MS = 2 * 60 * 1000;

  devices: FakeDevice[];
  deviceConfigs: FakeDeviceConfig[];
  events = new Map<string, FakeEventRow>();
  measurements = new Map<string, FakeMeasurementRow>();
  configVersion = 1;

  constructor(devices: FakeDevice[], deviceConfigs: FakeDeviceConfig[] = []) {
    this.devices = devices;
    this.deviceConfigs = deviceConfigs;
  }

  from(table: string) {
    let source: Record<string, unknown>[];
    if (table === "devices") {
      source = this.devices as unknown as Record<string, unknown>[];
    } else if (table === "device_config") {
      source = this.deviceConfigs as unknown as Record<string, unknown>[];
    } else {
      throw new Error(`FakeSupabase: unexpected table "${table}"`);
    }

    const filters: Record<string, unknown> = {};
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return builder;
      },
      maybeSingle: () => {
        const match = source.find((r) =>
          Object.entries(filters).every(([k, v]) => r[k] === v)
        );
        return Promise.resolve({ data: match ? { ...match } : null, error: null });
      },
    };
    return builder;
  }

  rpc(name: string, args: Record<string, unknown>) {
    if (name === "mide_upsert_event") return Promise.resolve(this.#upsertEvent(args));
    if (name === "mide_claim_event_notification") {
      return Promise.resolve(this.#claimNotification(args));
    }
    if (name === "mide_confirm_event_notification") {
      return Promise.resolve(this.#confirmNotification(args));
    }
    if (name === "mide_release_event_notification") {
      return Promise.resolve(this.#releaseNotification(args));
    }
    if (name === "mide_ingest_report") return Promise.resolve(this.#ingestReport(args));
    throw new Error(`FakeSupabase: unexpected rpc "${name}"`);
  }

  #eventById(id: string): FakeEventRow | undefined {
    for (const row of this.events.values()) if (row.id === id) return row;
    return undefined;
  }

  /**
   * Test helper: model a worker that won a notification claim and then died
   * before confirming (or releasing) it — age every outstanding claim past
   * the lease so the next claim call can reclaim it.
   */
  abandonClaims(): void {
    const stale = new Date(Date.now() - FakeSupabase.NOTIFY_LEASE_MS - 60_000).toISOString();
    for (const row of this.events.values()) {
      if (row.alert_notify_claimed_at != null && row.alert_notified_at == null) {
        row.alert_notify_claimed_at = stale;
      }
      if (row.recovery_notify_claimed_at != null && row.recovery_notified_at == null) {
        row.recovery_notify_claimed_at = stale;
      }
    }
  }

  static #cols(kind: unknown) {
    return kind === "recovery"
      ? { sent: "recovery_notified_at" as const, claim: "recovery_notify_claimed_at" as const }
      : { sent: "alert_notified_at" as const, claim: "alert_notify_claimed_at" as const };
  }

  #upsertEvent(a: Record<string, unknown>) {
    const deviceId = a.p_device_id as string;
    const eventUid = a.p_event_uid as string;
    const endedAt = (a.p_ended_at as string | null) ?? null;
    const closing = endedAt != null;
    const incomingMeta = (a.p_metadata as Record<string, unknown> | null) ?? {};
    const key = `${deviceId}|${eventUid}`;
    const existing = this.events.get(key);

    if (!existing) {
      const row: FakeEventRow = {
        id: `evt-${++eventIdCounter}`,
        device_id: deviceId,
        event_uid: eventUid,
        event_type: a.p_type as string,
        severity: a.p_severity as string,
        started_at: a.p_started_at as string,
        value_at_start: (a.p_value as number | null) ?? null,
        ended_at: endedAt,
        peak_value: (a.p_peak_value as number | null) ?? null,
        status: closing ? "resolved" : "open",
        metadata: { ...incomingMeta },
        alert_notified_at: null,
        recovery_notified_at: null,
        alert_notify_claimed_at: null,
        recovery_notify_claimed_at: null,
      };
      this.events.set(key, row);
      return {
        data: [
          {
            was_inserted: true,
            event_status: row.status,
            event_id: row.id,
            event_value: row.value_at_start,
            event_peak: row.peak_value,
            event_started_at: row.started_at,
            event_ended_at: row.ended_at,
          },
        ],
        error: null,
      };
    }

    existing.ended_at = endedAt ?? existing.ended_at;
    existing.peak_value = (a.p_peak_value as number | null) ?? existing.peak_value;
    existing.severity = a.p_severity as string;
    if (closing) existing.status = "resolved";
    existing.metadata = { ...existing.metadata, ...incomingMeta };
    return {
      data: [
        {
          was_inserted: false,
          event_status: existing.status,
          event_id: existing.id,
          event_value: existing.value_at_start,
          event_peak: existing.peak_value,
          event_started_at: existing.started_at,
          event_ended_at: existing.ended_at,
        },
      ],
      error: null,
    };
  }

  // Wins the claim only if the kind is not already confirmed-sent AND there is
  // no live lease (no claim, or the last claim is older than NOTIFY_LEASE_MS).
  #claimNotification(a: Record<string, unknown>) {
    const row = this.#eventById(a.p_event_id as string);
    if (!row) return { data: false, error: null };
    const { sent, claim } = FakeSupabase.#cols(a.p_kind);
    if (row[sent] != null) return { data: false, error: null };
    const claimedAt = row[claim];
    const leaseAlive =
      claimedAt != null && Date.now() - Date.parse(claimedAt) < FakeSupabase.NOTIFY_LEASE_MS;
    if (leaseAlive) return { data: false, error: null };
    row[claim] = new Date().toISOString();
    return { data: true, error: null };
  }

  // Permanent "sent" mark, written only after the provider accepts. Clears the
  // lease. Idempotent.
  #confirmNotification(a: Record<string, unknown>) {
    const row = this.#eventById(a.p_event_id as string);
    if (row) {
      const { sent, claim } = FakeSupabase.#cols(a.p_kind);
      if (row[sent] == null) {
        row[sent] = new Date().toISOString();
        row[claim] = null;
      }
    }
    return { data: null, error: null };
  }

  // Drop the lease without confirming (send failed, process still alive).
  // Never touches an already-confirmed kind.
  #releaseNotification(a: Record<string, unknown>) {
    const row = this.#eventById(a.p_event_id as string);
    if (row) {
      const { sent, claim } = FakeSupabase.#cols(a.p_kind);
      if (row[sent] == null) row[claim] = null;
    }
    return { data: null, error: null };
  }

  #ingestReport(a: Record<string, unknown>) {
    const deviceId = a.p_device_id as string;
    const metrics = a.p_metrics as Array<Record<string, unknown>>;
    for (const m of metrics) {
      const key = `${deviceId}|${m.metric}|${a.p_period_start}`;
      const incoming: FakeMeasurementRow = {
        device_id: deviceId,
        metric: m.metric as string,
        unit: m.unit as string,
        period_start: a.p_period_start as string,
        period_end: a.p_period_end as string,
        min_value: m.min as number,
        max_value: m.max as number,
        avg_value: m.avg as number,
        sample_count: m.samples as number,
      };
      const existing = this.measurements.get(key);
      if (!existing || incoming.sample_count >= existing.sample_count) {
        this.measurements.set(key, incoming);
      }
      // else: a stale / narrower retry is ignored, matching the WHERE guard.
    }
    return { data: this.configVersion, error: null };
  }
}
