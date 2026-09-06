// Contract test for public.mide_upsert_event against REAL PostgreSQL.
//
// Why this exists
// ---------------
// The route tests (src/app/api/mide/event/route.test.ts) run against
// FakeSupabase, a plain in-memory JS object store. It has no type system, so
// it cannot notice that a plpgsql `RETURN QUERY ... RETURNING <bare column>`
// does not match the function's `RETURNS TABLE` declaration. PostgreSQL
// enforces that BY POSITION and only allows binary-coercible pairs
// (convert_tuples_by_position) -- assignment casts like double precision ->
// numeric are NOT allowed. During Ensayo 2 this made every
// POST /rest/v1/rpc/mide_upsert_event fail with
//   SQLSTATE 42804 "structure of query does not match function result type"
// while the JS-fake route tests stayed green. See
// supabase/migrations/20260905120004_fix_mide_upsert_event_return_types.sql.
//
// This test loads that migration verbatim and exercises the function against
// an embedded real PostgreSQL (@electric-sql/pglite) -- production is never
// touched. The `events` table here is deliberately built with the ADVERSARIAL
// physical types (temperature columns as `double precision`, `status` as
// `varchar`) so the test fails loudly if the RETURNING list ever regresses to
// bare columns.
//
// The second suite covers 20260905120005: once 004 let the INSERT run, the
// literal 'open' / 'resolved' the function writes hit the live status CHECK
// (named "events_status_check", i.e. a value vocabulary different from the
// 20260818000000 reconstruction) with
//   SQLSTATE 23514 "violates check constraint events_status_check".
// 005 re-derives the open/closed values from the column default + the CHECK,
// stores those, and RETURNS a normalised 'open'/'resolved' so the HTTP
// contract is unchanged.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

// @electric-sql/pglite is an embedded real PostgreSQL (WASM). It is a
// devDependency; if it is not installed the whole suite is skipped rather than
// failing, so `npm test` still works without it. To run this test:
//   pnpm add -D @electric-sql/pglite      (this repo uses pnpm)
type PGlite = import("@electric-sql/pglite").PGlite;
let PGliteCtor: typeof import("@electric-sql/pglite").PGlite | undefined;
try {
  ({ PGlite: PGliteCtor } = await import("@electric-sql/pglite"));
} catch {
  // left undefined -> describe.skipIf below turns the suite into a no-op
}

const migrationPath = (name: string) =>
  fileURLToPath(new URL(`../../supabase/migrations/${name}`, import.meta.url));

const MIGRATION_004 = migrationPath(
  "20260905120004_fix_mide_upsert_event_return_types.sql"
);
const MIGRATION_005 = migrationPath(
  "20260905120005_align_mide_upsert_event_status_values.sql"
);

// events with the physical column types most likely to differ from what the
// function declares: value_at_start / peak_value as double precision (a
// natural choice for sensor temperatures), status as varchar. If the fix
// holds here it holds for numeric / text too.
const EVENTS_TABLE_ADVERSARIAL = `
create table public.events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null,
  event_uid text not null,
  event_type text not null,
  severity varchar(16) not null default 'info',
  started_at timestamptz not null,
  ended_at timestamptz,
  value_at_start double precision,
  peak_value double precision,
  status varchar(16) not null default 'open',
  metadata jsonb not null default '{}'::jsonb,
  notified_at timestamptz,
  alert_notified_at timestamptz,
  recovery_notified_at timestamptz,
  alert_notify_claimed_at timestamptz,
  recovery_notify_claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_device_event_uid_unique unique (device_id, event_uid),
  constraint events_status_valid check (status in ('open', 'resolved'))
);
`;

// events as the LIVE database actually has it for the 005 suite: the status
// vocabulary is 'active' / 'resolved' (default 'active'), guarded by an
// UNNAMED check -> PostgreSQL auto-names it "events_status_check", exactly the
// constraint the 23514 names. A public.devices row exists because 005's probe
// does `select id from public.devices limit 1`.
const SCHEMA_REAL_STATUS = `
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  device_code text unique not null
);
insert into public.devices (id, device_code)
values ('11111111-1111-1111-1111-111111111111', 'mide-frio-001');

create table public.events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices (id),
  event_uid text not null,
  event_type text not null,
  severity varchar(16) not null default 'info',
  started_at timestamptz not null,
  ended_at timestamptz,
  value_at_start double precision,
  peak_value double precision,
  status varchar(16) not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  notified_at timestamptz,
  alert_notified_at timestamptz,
  recovery_notified_at timestamptz,
  alert_notify_claimed_at timestamptz,
  recovery_notify_claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_device_event_uid_unique unique (device_id, event_uid),
  check (status in ('active', 'resolved'))
);
`;

// The pre-004 body applied by 20260905120002_mide_event_notifications.sql:
// bare columns in RETURNING. Kept here as a regression fixture.
const FN_PRE_004_BROKEN = `
create or replace function public.mide_upsert_event(
  p_device_id uuid, p_event_uid text, p_type text, p_severity text,
  p_started_at timestamptz, p_value numeric, p_ended_at timestamptz,
  p_peak_value numeric, p_metadata jsonb
) returns table (
  was_inserted boolean, event_status text, event_id uuid,
  event_value numeric, event_peak numeric,
  event_started_at timestamptz, event_ended_at timestamptz
) language plpgsql set search_path = public as $$
begin
  return query
  insert into public.events as e (
    device_id, event_uid, event_type, severity,
    started_at, value_at_start, ended_at, peak_value, status, metadata
  )
  values (
    p_device_id, p_event_uid, p_type, p_severity,
    p_started_at, p_value, p_ended_at, p_peak_value,
    case when p_ended_at is not null then 'resolved' else 'open' end,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (device_id, event_uid) do update set
    ended_at   = coalesce(excluded.ended_at, e.ended_at),
    peak_value = coalesce(excluded.peak_value, e.peak_value),
    severity   = excluded.severity,
    status     = case when excluded.ended_at is not null then 'resolved' else e.status end,
    metadata   = coalesce(e.metadata, '{}'::jsonb) || coalesce(excluded.metadata, '{}'::jsonb)
  returning
    (e.xmax::text::bigint = 0), e.status, e.id,
    e.value_at_start, e.peak_value, e.started_at, e.ended_at;
end;
$$;
`;

const DEVICE = "11111111-1111-1111-1111-111111111111";

type UpsertArgs = {
  eventUid?: string;
  type?: string;
  severity?: string;
  startedAt?: string;
  value?: number | null;
  endedAt?: string | null;
  peakValue?: number | null;
  metadata?: Record<string, unknown> | null;
};

// Shape of one mide_upsert_event result row as PGlite decodes it: numeric ->
// string, timestamptz -> Date, uuid/text -> string, boolean -> boolean.
type UpsertRow = {
  was_inserted: boolean;
  event_status: string;
  event_id: string;
  event_value: string | null;
  event_peak: string | null;
  event_started_at: Date | null;
  event_ended_at: Date | null;
};

type EventsRow = {
  id: string;
  event_uid: string;
  status: string;
  ended_at: Date | null;
  value_at_start: string | null;
  peak_value: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
};

function callUpsert(db: PGlite, a: UpsertArgs = {}) {
  // p_metadata: undefined -> default '{}'; explicit null -> SQL NULL (exercises
  // the coalesce(p_metadata, '{}') branch); object -> jsonb.
  let metadata: string | null;
  if (a.metadata === undefined) metadata = "{}";
  else if (a.metadata === null) metadata = null;
  else metadata = JSON.stringify(a.metadata);

  return db.query<UpsertRow>(
    "select * from public.mide_upsert_event($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      DEVICE,
      a.eventUid ?? "mide-frio-001-h900000001",
      a.type ?? "TEMP_HIGH",
      a.severity ?? "critical",
      a.startedAt ?? "2026-09-05T08:17:32-03:00",
      a.value === undefined ? -9.8 : a.value,
      a.endedAt ?? null,
      a.peakValue ?? null,
      metadata,
    ]
  );
}

const eventsRows = (db: PGlite) =>
  db
    .query<EventsRow>("select * from public.events order by created_at, event_uid")
    .then((r) => r.rows);

// Spinning up the WASM PostgreSQL costs a few seconds, so the whole file
// shares one instance. Booting PGlite can exceed the default 5s hook timeout.
const HOOK_TIMEOUT = 60_000;

describe.skipIf(!PGliteCtor)("mide_upsert_event — SQL contract against real PostgreSQL", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await PGliteCtor!.create();
    // Supabase's service_role: the migration's grants target it.
    await db.exec("create role service_role");
    await db.exec(EVENTS_TABLE_ADVERSARIAL);
    // Start from the broken body applied by 20260905120002 ...
    await db.exec(FN_PRE_004_BROKEN);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.close();
  });

  it("regression fixture: the pre-004 body fails with 42804 on double precision / varchar columns", async () => {
    await expect(callUpsert(db)).rejects.toMatchObject({
      code: "42804",
      message: expect.stringContaining("structure of query does not match function result type"),
    });
  });

  describe("with migration 20260905120004 applied", () => {
    beforeAll(async () => {
      // ... then apply the migration verbatim: CREATE OR REPLACE over the
      // broken body, exactly as it runs on Supabase. No DROP, grants kept.
      await db.exec(readFileSync(MIGRATION_004, "utf8"));
      await db.exec("truncate public.events");
    }, HOOK_TIMEOUT);

    it("1. new open: creates one open row, was_inserted=true, echoes the value", async () => {
      const { rows } = await callUpsert(db, { eventUid: "e1", value: -9.8 });
      expect(rows[0]).toMatchObject({
        was_inserted: true,
        event_status: "open",
        event_ended_at: null,
      });
      expect(Number(rows[0].event_value)).toBe(-9.8);
      expect(typeof rows[0].event_id).toBe("string");
      const stored = (await eventsRows(db)).filter((r) => r.event_uid === "e1");
      expect(stored).toHaveLength(1);
      expect(stored[0].status).toBe("open");
    });

    it("2. retry of the same open: no duplicate, was_inserted=false, still open", async () => {
      await callUpsert(db, { eventUid: "e2" });
      const { rows } = await callUpsert(db, { eventUid: "e2" });
      expect(rows[0].was_inserted).toBe(false);
      expect(rows[0].event_status).toBe("open");
      expect((await eventsRows(db)).filter((r) => r.event_uid === "e2")).toHaveLength(1);
    });

    it("3. close of an open row: same row resolved, ended_at + peak_value set, metadata merged", async () => {
      await callUpsert(db, {
        eventUid: "e3",
        metadata: { reason: "GRAVEDAD", band: 2, trend: "ASCENDIENDO" },
      });
      const { rows } = await callUpsert(db, {
        eventUid: "e3",
        endedAt: "2026-09-05T08:42:00-03:00",
        peakValue: -7.9,
        metadata: { maxDeviationC: 7.1, durationMs: 1_480_000 },
      });
      expect(rows[0]).toMatchObject({ was_inserted: false, event_status: "resolved" });
      expect(Number(rows[0].event_peak)).toBe(-7.9);
      expect(rows[0].event_ended_at).toBeInstanceOf(Date);

      const [row] = (await eventsRows(db)).filter((r) => r.event_uid === "e3");
      expect(row.status).toBe("resolved");
      expect(Number(row.peak_value)).toBe(-7.9);
      expect(row.ended_at).toBeInstanceOf(Date);
      expect(row.metadata).toMatchObject({
        reason: "GRAVEDAD",
        band: 2,
        trend: "ASCENDIENDO",
        maxDeviationC: 7.1,
        durationMs: 1_480_000,
      });
    });

    it("4. retry of the same close: still one resolved row, no regression", async () => {
      await callUpsert(db, { eventUid: "e4" });
      await callUpsert(db, { eventUid: "e4", endedAt: "2026-09-05T08:42:00-03:00", peakValue: -7.9 });
      const { rows } = await callUpsert(db, {
        eventUid: "e4",
        endedAt: "2026-09-05T08:42:00-03:00",
        peakValue: -7.9,
      });
      expect(rows[0].event_status).toBe("resolved");
      expect((await eventsRows(db)).filter((r) => r.event_uid === "e4")).toHaveLength(1);
    });

    it("5. close with no prior open: creates the row already resolved, was_inserted=true", async () => {
      const { rows } = await callUpsert(db, {
        eventUid: "e5",
        endedAt: "2026-09-05T09:10:00-03:00",
        peakValue: -6.1,
        metadata: { reason: "GRAVEDAD" },
      });
      expect(rows[0]).toMatchObject({ was_inserted: true, event_status: "resolved" });
      const [row] = (await eventsRows(db)).filter((r) => r.event_uid === "e5");
      expect(row.status).toBe("resolved");
      expect(row.ended_at).toBeInstanceOf(Date);
    });

    it("6. metadata is deep-merged across the open and close POSTs", async () => {
      await callUpsert(db, { eventUid: "e6", metadata: { reason: "GRAVEDAD", band: 3 } });
      await callUpsert(db, {
        eventUid: "e6",
        endedAt: "2026-09-05T10:00:00-03:00",
        peakValue: -5,
        metadata: { durationMs: 900_000, timeOutOfRangeMs: 120_000 },
      });
      const [row] = (await eventsRows(db)).filter((r) => r.event_uid === "e6");
      expect(row.metadata).toEqual({
        reason: "GRAVEDAD",
        band: 3,
        durationMs: 900_000,
        timeOutOfRangeMs: 120_000,
      });
    });

    it("7. optional nulls: null value / peak / metadata are accepted and returned as null / {}", async () => {
      const { rows } = await callUpsert(db, {
        eventUid: "e7",
        value: null,
        peakValue: null,
        metadata: null,
      });
      expect(rows[0].event_value).toBeNull();
      expect(rows[0].event_peak).toBeNull();
      expect(rows[0].event_ended_at).toBeNull();
      const [row] = (await eventsRows(db)).filter((r) => r.event_uid === "e7");
      expect(row.metadata).toEqual({});
    });

    it("8. returned column types match the declared RETURNS TABLE (bool/text/uuid/numeric/timestamptz)", async () => {
      const res = await callUpsert(db, { eventUid: "e8" });
      const byName = Object.fromEntries(res.fields.map((f) => [f.name, f.dataTypeID]));
      // OIDs: 16 bool, 25 text, 2950 uuid, 1700 numeric, 1184 timestamptz
      expect(byName).toMatchObject({
        was_inserted: 16,
        event_status: 25,
        event_id: 2950,
        event_value: 1700,
        event_peak: 1700,
        event_started_at: 1184,
        event_ended_at: 1184,
      });
    });
  });
});

describe.skipIf(!PGliteCtor)(
  "mide_upsert_event — status vocabulary (migration 005) against real PostgreSQL",
  () => {
    let db: PGlite;

    const statusCheckDef = () =>
      db
        .query<{ definition: string }>(
          `select pg_get_constraintdef(c.oid) as definition
             from pg_constraint c
            where c.conrelid = 'public.events'::regclass
              and c.contype = 'c'
              and c.conname = 'events_status_check'`
        )
        .then((r) => r.rows[0]?.definition ?? null);

    beforeAll(async () => {
      db = await PGliteCtor!.create();
      await db.exec("create role service_role");
      await db.exec(SCHEMA_REAL_STATUS);
      // Start from the state after 20260905120004: the 42804 is fixed, so the
      // INSERT runs and now reaches the status CHECK.
      await db.exec(FN_PRE_004_BROKEN);
      await db.exec(readFileSync(MIGRATION_004, "utf8"));
    }, HOOK_TIMEOUT);

    afterAll(async () => {
      await db?.close();
    });

    it("regression: after 004 only, an apertura violates events_status_check (23514)", async () => {
      await expect(callUpsert(db, { eventUid: "boom" })).rejects.toMatchObject({
        code: "23514",
        message: expect.stringContaining("events_status_check"),
      });
    });

    describe("with migration 20260905120005 applied", () => {
      let checkBefore: string | null;

      beforeAll(async () => {
        checkBefore = await statusCheckDef();
        await db.exec(readFileSync(MIGRATION_005, "utf8"));
        await db.exec("truncate public.events");
      }, HOOK_TIMEOUT);

      it("does NOT touch events_status_check", async () => {
        expect(checkBefore).not.toBeNull();
        expect(await statusCheckDef()).toBe(checkBefore);
      });

      it("1. apertura: stores the schema's active value, returns normalised event_status='open'", async () => {
        const { rows } = await callUpsert(db, { eventUid: "a1", value: -9.8 });
        expect(rows[0]).toMatchObject({ was_inserted: true, event_status: "open" });
        const [row] = (await eventsRows(db)).filter((r) => r.event_uid === "a1");
        expect(row.status).toBe("active");
        expect(row.ended_at).toBeNull();
      });

      it("2. retry apertura: no duplicate, still active/open", async () => {
        await callUpsert(db, { eventUid: "a2" });
        const { rows } = await callUpsert(db, { eventUid: "a2" });
        expect(rows[0].was_inserted).toBe(false);
        expect(rows[0].event_status).toBe("open");
        const stored = (await eventsRows(db)).filter((r) => r.event_uid === "a2");
        expect(stored).toHaveLength(1);
        expect(stored[0].status).toBe("active");
      });

      it("3. cierre: same row -> stored status 'resolved', event_status 'resolved', ended_at + peak + metadata", async () => {
        await callUpsert(db, { eventUid: "a3", metadata: { reason: "GRAVEDAD", band: 2 } });
        const { rows } = await callUpsert(db, {
          eventUid: "a3",
          endedAt: "2026-09-05T08:42:00-03:00",
          peakValue: -7.9,
          metadata: { durationMs: 1_480_000 },
        });
        expect(rows[0]).toMatchObject({ was_inserted: false, event_status: "resolved" });
        expect(Number(rows[0].event_peak)).toBe(-7.9);
        const [row] = (await eventsRows(db)).filter((r) => r.event_uid === "a3");
        expect(row.status).toBe("resolved");
        expect(row.ended_at).toBeInstanceOf(Date);
        expect(row.metadata).toMatchObject({ reason: "GRAVEDAD", band: 2, durationMs: 1_480_000 });
      });

      it("4. retry cierre: still one resolved row", async () => {
        await callUpsert(db, { eventUid: "a4" });
        await callUpsert(db, { eventUid: "a4", endedAt: "2026-09-05T08:42:00-03:00", peakValue: -7.9 });
        const { rows } = await callUpsert(db, {
          eventUid: "a4",
          endedAt: "2026-09-05T08:42:00-03:00",
          peakValue: -7.9,
        });
        expect(rows[0].event_status).toBe("resolved");
        const stored = (await eventsRows(db)).filter((r) => r.event_uid === "a4");
        expect(stored).toHaveLength(1);
        expect(stored[0].status).toBe("resolved");
      });

      it("5. cierre sin apertura previa: crea la fila ya resuelta (stored 'resolved')", async () => {
        const { rows } = await callUpsert(db, {
          eventUid: "a5",
          endedAt: "2026-09-05T09:10:00-03:00",
          peakValue: -6.1,
          metadata: { reason: "GRAVEDAD" },
        });
        expect(rows[0]).toMatchObject({ was_inserted: true, event_status: "resolved" });
        const [row] = (await eventsRows(db)).filter((r) => r.event_uid === "a5");
        expect(row.status).toBe("resolved");
        expect(row.ended_at).toBeInstanceOf(Date);
      });

      it("6. metadata deep-merge across apertura + cierre", async () => {
        await callUpsert(db, { eventUid: "a6", metadata: { reason: "GRAVEDAD", band: 3 } });
        await callUpsert(db, {
          eventUid: "a6",
          endedAt: "2026-09-05T10:00:00-03:00",
          peakValue: -5,
          metadata: { durationMs: 900_000, timeOutOfRangeMs: 120_000 },
        });
        const [row] = (await eventsRows(db)).filter((r) => r.event_uid === "a6");
        expect(row.metadata).toEqual({
          reason: "GRAVEDAD",
          band: 3,
          durationMs: 900_000,
          timeOutOfRangeMs: 120_000,
        });
      });

      it("7. optional nulls still accepted; metadata defaults to {}", async () => {
        const { rows } = await callUpsert(db, {
          eventUid: "a7",
          value: null,
          peakValue: null,
          metadata: null,
        });
        expect(rows[0].event_value).toBeNull();
        expect(rows[0].event_peak).toBeNull();
        const [row] = (await eventsRows(db)).filter((r) => r.event_uid === "a7");
        expect(row.metadata).toEqual({});
        expect(row.status).toBe("active");
      });

      it("8. returned column types unchanged (bool/text/uuid/numeric/timestamptz)", async () => {
        const res = await callUpsert(db, { eventUid: "a8" });
        const byName = Object.fromEntries(res.fields.map((f) => [f.name, f.dataTypeID]));
        expect(byName).toMatchObject({
          was_inserted: 16,
          event_status: 25,
          event_id: 2950,
          event_value: 1700,
          event_peak: 1700,
          event_started_at: 1184,
          event_ended_at: 1184,
        });
      });
    });
  }
);
