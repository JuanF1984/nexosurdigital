-- MIDE: fix POST /rest/v1/rpc/mide_upsert_event failing with
--
--   HTTP 400
--   SQLSTATE 42804
--   "structure of query does not match function result type"
--
-- observed repeatedly during Ensayo 2 while POST /rpc/mide_ingest_report keeps
-- returning 200. The firmware alarm/event is fine and reaches the backend; the
-- RPC contract is what Postgres rejects.
--
-- ---------------------------------------------------------------------------
-- Root cause
-- ---------------------------------------------------------------------------
-- mide_upsert_event (created by 20260905120002_mide_event_notifications.sql,
-- already applied here) ends with:
--
--   return query
--   insert into public.events as e (...)
--   values (...)
--   on conflict (device_id, event_uid) do update set ...
--   returning
--     (e.xmax::text::bigint = 0),   -- boolean
--     e.status,                     -- <- bare column
--     e.id,                         -- <- bare column
--     e.value_at_start,             -- <- bare column
--     e.peak_value,                 -- <- bare column
--     e.started_at,                 -- <- bare column
--     e.ended_at;                   -- <- bare column
--
-- against a RETURNS TABLE of
--   (was_inserted boolean, event_status text, event_id uuid,
--    event_value numeric, event_peak numeric,
--    event_started_at timestamptz, event_ended_at timestamptz).
--
-- For RETURN QUERY, PostgreSQL matches the query's result columns to the
-- function's declared OUT columns BY POSITION and requires each pair to be the
-- SAME type or BINARY-coercible (convert_tuples_by_position). It does NOT run
-- assignment casts. So if any physical column of public.events is stored as a
-- type that is only *assignment*-coercible to the declared OUT type, the whole
-- call fails at runtime with 42804 -- exactly what Ensayo 2 hit. The function
-- was created successfully (the body is not structurally checked at CREATE
-- time) and had never been exercised against the real events table before
-- Ensayo 2 (the route tests use an in-memory JS double with no type system),
-- which is why this only surfaced now.
--
-- Reproduced locally against real PostgreSQL 18 (via @electric-sql/pglite,
-- production untouched). With events.value_at_start / events.peak_value stored
-- as double precision (or real):
--
--   ERROR 42804: structure of query does not match function result type
--   DETAIL: Returned type double precision does not match expected type
--           numeric in column "event_value" (position 4).
--
-- The same failure occurs if events.started_at / events.ended_at are
-- `timestamp` (no tz) vs the declared `timestamptz`, or if events.status is
-- `varchar(n)` vs the declared `text`. All of these are "structure of query
-- does not match function result type". (A different message --
-- "column \"status\" is of type <enum> but expression is of type text" --
-- would mean status is a real enum; that is NOT what the logs show, so status
-- being an enum is ruled out. Confirm the exact offender with:
--
--   select column_name, data_type, udt_name,
--          character_maximum_length, numeric_precision
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'events'
--     and column_name in ('status','value_at_start','peak_value',
--                         'started_at','ended_at','id')
--   order by ordinal_position;
-- )
--
-- ---------------------------------------------------------------------------
-- Fix
-- ---------------------------------------------------------------------------
-- Pin every RETURNING expression to the EXACT type declared in RETURNS TABLE
-- with an explicit cast, so the query result is type-identical to the OUT
-- columns regardless of how the underlying events columns are physically
-- stored. This is not an arbitrary cast: RETURNS TABLE is the RPC's contract
-- (the route's UpsertEventRow, the fake, and the tests all already expect
-- boolean / text / uuid / numeric / timestamptz), and every prior migration
-- and docs/mide/base-de-datos.md already document these columns as
-- numeric / text / timestamptz. float8/real -> numeric is a shortest-round-trip
-- conversion in modern PostgreSQL (e.g. -9.8 stays -9.8), so no precision
-- surprise for temperature values. status::text and *::timestamptz are no-ops
-- when the columns already have those types.
--
-- Nothing else changes: same argument list, same RETURNS TABLE (same OUT names
-- AND types), same INSERT ... ON CONFLICT behaviour (one row per
-- (device_id, event_uid); open creates/no-ops, close resolves or creates
-- already-resolved; metadata merged; idempotent retries). Because the
-- signature is unchanged, CREATE OR REPLACE FUNCTION is enough -- no DROP, so
-- existing grants (execute to service_role) and dependencies are preserved.
--
-- Notification columns / functions (alert_notify_claimed_at,
-- recovery_notify_claimed_at, alert_notified_at, recovery_notified_at,
-- mide_claim_event_notification, mide_confirm_event_notification,
-- mide_release_event_notification) are NOT touched.
--
-- IMPORTANT: incremental over the live schema. Apply MANUALLY to the Supabase
-- project. Do NOT retro-edit 20260905120002 -- it must keep describing what was
-- actually applied. Idempotent / safe to re-run.

create or replace function public.mide_upsert_event(
  p_device_id  uuid,
  p_event_uid  text,
  p_type       text,
  p_severity   text,
  p_started_at timestamptz,
  p_value      numeric,
  p_ended_at   timestamptz,
  p_peak_value numeric,
  p_metadata   jsonb
)
returns table (
  was_inserted boolean,
  event_status text,
  event_id     uuid,
  event_value  numeric,
  event_peak   numeric,
  event_started_at timestamptz,
  event_ended_at   timestamptz
)
language plpgsql
set search_path = public
as $$
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
  -- xmax = 0 on a freshly INSERTed row, non-zero on a row updated by the
  -- ON CONFLICT path. Cast via text to avoid "operator does not exist:
  -- xid = integer" on stricter PostgreSQL builds.
  --
  -- Every other RETURNING expression is cast to the EXACT type of its
  -- RETURNS TABLE column so RETURN QUERY's positional, binary-coercible-only
  -- structure check always passes, whatever the physical column types of
  -- public.events are (numeric vs double precision/real, text vs varchar,
  -- timestamptz vs timestamp).
  returning
    (e.xmax::text::bigint = 0),
    e.status::text,
    e.id::uuid,
    e.value_at_start::numeric,
    e.peak_value::numeric,
    e.started_at::timestamptz,
    e.ended_at::timestamptz;
end;
$$;

-- Re-issue the grants defensively. CREATE OR REPLACE keeps existing privileges,
-- so this is a no-op on the live DB, but it keeps the migration self-contained
-- and safe to run on a fresh environment (same posture as 20260905120002 /
-- 20260905120003).
revoke all on function public.mide_upsert_event(uuid, text, text, text, timestamptz, numeric, timestamptz, numeric, jsonb) from public;
grant execute on function public.mide_upsert_event(uuid, text, text, text, timestamptz, numeric, timestamptz, numeric, jsonb) to service_role;

-- mide_upsert_event runs SECURITY INVOKER (caller = service_role). It already
-- had update, select on public.events from 20260905120001; nothing new needed.

-- The RETURNS TABLE shape is unchanged, so PostgREST's schema cache does not
-- strictly need this -- included to match the 20260905120003 pattern and to be
-- safe if the function was previously in a broken state in the cache.
notify pgrst, 'reload schema';
