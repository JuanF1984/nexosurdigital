// In-memory stand-in for the MIDE Supabase client, used by the route tests.
// It emulates only what the /api/mide/* handlers actually call:
//   - from("devices").select(...).eq(...).maybeSingle()
//   - rpc("mide_upsert_event", ...)   -> single-row-per-episode upsert
//   - rpc("mide_ingest_report", ...)  -> one-row-per-period idempotent upsert
// and it enforces the same uniqueness / "keep the most complete" rules the
// real Postgres functions do, so idempotency can be asserted without a DB.

export type FakeDevice = { id: string; device_code: string; active: boolean };

type FakeEventRow = {
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

export class FakeSupabase {
  devices: FakeDevice[];
  events = new Map<string, FakeEventRow>();
  measurements = new Map<string, FakeMeasurementRow>();
  configVersion = 1;

  constructor(devices: FakeDevice[]) {
    this.devices = devices;
  }

  from(table: string) {
    if (table !== "devices") {
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
        const match = this.devices.find((d) =>
          Object.entries(filters).every(([k, v]) => (d as Record<string, unknown>)[k] === v)
        );
        return Promise.resolve({ data: match ? { ...match } : null, error: null });
      },
    };
    return builder;
  }

  rpc(name: string, args: Record<string, unknown>) {
    if (name === "mide_upsert_event") return Promise.resolve(this.#upsertEvent(args));
    if (name === "mide_ingest_report") return Promise.resolve(this.#ingestReport(args));
    throw new Error(`FakeSupabase: unexpected rpc "${name}"`);
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
      this.events.set(key, {
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
      });
      return {
        data: [{ was_inserted: true, event_status: closing ? "resolved" : "open" }],
        error: null,
      };
    }

    existing.ended_at = endedAt ?? existing.ended_at;
    existing.peak_value = (a.p_peak_value as number | null) ?? existing.peak_value;
    existing.severity = a.p_severity as string;
    if (closing) existing.status = "resolved";
    existing.metadata = { ...existing.metadata, ...incomingMeta };
    return { data: [{ was_inserted: false, event_status: existing.status }], error: null };
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
