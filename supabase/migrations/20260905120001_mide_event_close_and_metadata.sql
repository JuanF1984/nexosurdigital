-- MIDE: single-row episode model for POST /api/mide/event.
--
-- Before: the route only ever INSERTed the "open" alert. The events table
-- already had ended_at / peak_value / status columns, but nothing ever wrote
-- them, and the firmware's rich alarm-engine metadata (band, deviation,
-- trend, reason, time out of range, duration) had nowhere to go and stayed
-- only in the device's serial log.
--
-- After: one row per thermal episode, keyed by (device_id, event_uid).
--   * First POST, no endedAt          -> row created, status 'open'.
--   * Later POST, same event_uid,
--     with endedAt + peakValue        -> SAME row updated: ended_at,
--                                        peak_value, status 'resolved',
--                                        metadata merged.
--   * Close arriving before the open  -> row is created already 'resolved'.
--   * Every POST is idempotent: a retry never creates a second row and
--     never regresses ended_at / peak_value / status.
--
-- status is derived by the database from the presence of endedAt; the
-- firmware never sends status.
--
-- Backwards compatible: endedAt, peakValue and metadata are all optional. A
-- client that keeps sending only the original 6 fields
-- ({deviceId,eventId,type,severity,startedAt,value}) behaves exactly as before.
--
-- IMPORTANT: apply MANUALLY to the live Supabase project after diffing
-- against the real schema (see 20260818000000_mide_schema.sql header).

-- ---------------------------------------------------------------------------
-- 1. Experimental alarm-engine metadata: ONE jsonb column, not one column
--    per field, because the shape is still being tuned during Ensayo 2.
-- ---------------------------------------------------------------------------

alter table public.events
  add column if not exists metadata jsonb not null default '{}'::jsonb;

comment on column public.events.metadata is
  'Optional, EXPERIMENTAL alarm-engine metadata: band, maxDeviationC, trend, '
  'trendSlopeCPerMin, reason, timeOutOfRangeMs, durationMs. Written by '
  '/api/mide/event from the firmware; merged (open values then final values) '
  'across the open and close POSTs of the same episode. Shape may change '
  'during Ensayo 2 - do not build hard dependencies on it yet.';

-- ---------------------------------------------------------------------------
-- 2. mide_upsert_event: open-or-close a single episode row, idempotently.
--
--    p_ended_at IS NULL   -> "open" semantics  (create if absent, else no-op)
--    p_ended_at NOT NULL   -> "close" semantics (create resolved, or resolve
--                             the existing row)
--
--    Returns (was_inserted, event_status) so the route can answer with
--    { duplicate } / { resolved, created }. The OUT names avoid colliding
--    with the events.status column referenced inside the query.
--
--    SECURITY INVOKER (default): runs with the caller's privileges (the
--    server's service_role key), grants no elevated access on its own.
-- ---------------------------------------------------------------------------

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
returns table (was_inserted boolean, event_status text)
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
  -- xmax = 0 on a freshly INSERTed row, non-zero on a row that was UPDATEd by
  -- the ON CONFLICT path. Cast via text to avoid "operator does not exist:
  -- xid = integer" on stricter PostgreSQL builds.
  returning (e.xmax::text::bigint = 0), e.status;
end;
$$;

revoke all on function public.mide_upsert_event(uuid, text, text, text, timestamptz, numeric, timestamptz, numeric, jsonb) from public;
grant execute on function public.mide_upsert_event(uuid, text, text, text, timestamptz, numeric, timestamptz, numeric, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Extra privileges the upsert needs.
--    mide_upsert_event runs SECURITY INVOKER (caller = service_role), same
--    posture as mide_ingest_report. service_role already had INSERT on
--    events; the ON CONFLICT DO UPDATE needs UPDATE, and the
--    RETURNING (xmax = 0), status needs SELECT.
-- ---------------------------------------------------------------------------

grant update, select on public.events to service_role;

