-- MIDE: align mide_upsert_event with the REAL status contract of public.events.
--
-- After 20260905120004 fixed the 42804, POST /rest/v1/rpc/mide_upsert_event now
-- fails with:
--
--   SQLSTATE 23514
--   new row for relation "events" violates check constraint "events_status_check"
--
-- ---------------------------------------------------------------------------
-- Root cause
-- ---------------------------------------------------------------------------
-- mide_upsert_event writes the literal 'open' on an apertura (p_ended_at IS
-- NULL) and 'resolved' on a cierre, both in the INSERT ... VALUES and in the
-- ON CONFLICT DO UPDATE SET status = ... . Those literals come from
-- 20260818000000_mide_schema.sql / docs, which are a RECONSTRUCTION of the
-- hand-created schema, not an introspection of it.
--
-- The live table does NOT use that reconstruction:
--   * its status CHECK is named "events_status_check" -- PostgreSQL's
--     auto-generated name for an UNNAMED check -- not the reconstruction's
--     explicit "events_status_valid";
--   * it rejects at least 'open'. The single-row model never reached the CHECK
--     before: 20260905120002's body aborted the whole statement with 42804
--     during the RETURNING projection, so the row was never actually checked.
--     20260905120004 let the INSERT run, exposing the next mismatch.
--
-- Evidence for what the real "open" value is: the ORIGINAL /api/mide/event
-- route (commit 9d92aed, pre single-row model) inserted events WITHOUT ever
-- setting status, and those inserts were verified green against the real
-- database (docs/mide/api.md, "15/17 casos ... contra la base real"). So the
-- column DEFAULT of public.events.status is CHECK-valid and IS the real
-- "open / active" state. The real "resolved / closed" state is the other value
-- the CHECK allows.
--
-- Inspect the live contract before running this (it is also re-derived
-- automatically below):
--
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid = 'public.events'::regclass and contype = 'c';
--
--   select column_default
--   from information_schema.columns
--   where table_schema='public' and table_name='events' and column_name='status';
--
--   select status, count(*) from public.events group by 1 order by 2 desc;
--
-- ---------------------------------------------------------------------------
-- Fix (does NOT touch the constraint)
-- ---------------------------------------------------------------------------
-- Re-create mide_upsert_event so that:
--   * apertura  writes  v_open   = the current DEFAULT of events.status
--                                  (the proven-valid "active" state);
--   * cierre    writes  v_closed = the CHECK-allowed value that is not v_open
--                                  (preferring an obviously "resolved/closed"
--                                  label when the CHECK lists more than two);
--   * the row model is unchanged: one row per (device_id, event_uid),
--     idempotent apertura/cierre, cierre-before-apertura creates it already
--     closed, metadata merged, severity updated;
--   * the function still RETURNS a NORMALISED event_status ('open' / 'resolved'
--     derived from ended_at), so the HTTP contract of /api/mide/event and its
--     route code (row.event_status === "resolved") are byte-for-byte unchanged
--     regardless of the physical status vocabulary.
--
-- v_open / v_closed are resolved from the catalog and then PROBE-tested with a
-- rolled-back trial INSERT; if either is rejected by a CHECK the migration
-- aborts with a clear message instead of shipping a function that 23514s.
--
-- Notification columns / functions are NOT touched. Same argument list, same
-- RETURNS TABLE (same OUT names AND types) -> CREATE OR REPLACE, no DROP,
-- grants and dependencies preserved.
--
-- IMPORTANT: incremental over the live schema. Apply MANUALLY. Do NOT retro-edit
-- earlier migrations. Idempotent / safe to re-run.

do $mig$
declare
  v_open    text;
  v_closed  text;
  v_defexpr text;
  v_allowed text[];
  v_probe   text;
  v_dev     uuid;
begin
  -- 1. v_open := current default of public.events.status --------------------
  select pg_get_expr(ad.adbin, ad.adrelid)
    into v_defexpr
  from pg_attribute a
  join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
  where a.attrelid = 'public.events'::regclass and a.attname = 'status';

  if v_defexpr is null then
    raise exception
      '20260905120005: public.events.status has no DEFAULT; cannot infer the '
      'open-state value. Read the constraint (see header) and set v_open by hand.';
  end if;
  execute 'select ' || v_defexpr into v_open;

  -- 2. v_closed := the other value events_status_check allows --------------
  select array_agg(distinct m[1])
    into v_allowed
  from pg_constraint c
       cross join lateral regexp_matches(
         pg_get_constraintdef(c.oid), '''([^'']+)''', 'g') as m
  where c.conrelid = 'public.events'::regclass
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%status%';

  if v_allowed is null then
    raise exception
      '20260905120005: no enumerable status CHECK found on public.events '
      '(constraint shape not "status IN (...)" / "= ANY (ARRAY[...])"). '
      'Set v_open / v_closed by hand from the header query.';
  end if;

  -- prefer an explicitly closed-looking label, else the single remaining one
  select x into v_closed
  from unnest(v_allowed) as x
  where x is distinct from v_open and x ~* '(resolv|clos|cerr|termin|done|end|fin)'
  limit 1;

  if v_closed is null then
    select x into v_closed
    from unnest(v_allowed) as x
    where x is distinct from v_open
    limit 1;
  end if;

  if v_closed is null then
    raise exception
      '20260905120005: events_status_check allows only %; cannot pick a closed '
      'state distinct from the open state %.', v_allowed, v_open;
  end if;

  -- 3. probe both values against the live row constraints -----------------
  select id into v_dev from public.devices limit 1;
  foreach v_probe in array array[v_open, v_closed] loop
    begin
      insert into public.events
        (device_id, event_uid, event_type, started_at, status)
      values
        (coalesce(v_dev, gen_random_uuid()),
         '__mide_status_probe_' || gen_random_uuid()::text,
         'STATUS_PROBE', now(), v_probe);
      -- force a rollback of just this trial row; the CHECK already ran
      raise exception using errcode = 'P0001', message = '__probe_rollback__';
    exception
      when check_violation then
        raise exception
          '20260905120005 aborted: status value %L is rejected by a CHECK on '
          'public.events. Read the header query and set v_open / v_closed to '
          'values the live constraint allows.', v_probe;
      when foreign_key_violation then
        null;  -- no devices row for the FK, but the status CHECK passed
      when sqlstate 'P0001' then
        null;  -- CHECK (and every other row constraint) passed; row rolled back
    end;
  end loop;

  raise notice '20260905120005: status vocabulary resolved -> open=%, closed=%',
    v_open, v_closed;

  -- 4. (re)create the function with the resolved vocabulary --------------
  execute format($fn$
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
    as $body$
    begin
      return query
      insert into public.events as e (
        device_id, event_uid, event_type, severity,
        started_at, value_at_start, ended_at, peak_value, status, metadata
      )
      values (
        p_device_id, p_event_uid, p_type, p_severity,
        p_started_at, p_value, p_ended_at, p_peak_value,
        case when p_ended_at is not null then %1$L else %2$L end,
        coalesce(p_metadata, '{}'::jsonb)
      )
      on conflict (device_id, event_uid) do update set
        ended_at   = coalesce(excluded.ended_at, e.ended_at),
        peak_value = coalesce(excluded.peak_value, e.peak_value),
        severity   = excluded.severity,
        status     = case when excluded.ended_at is not null
                          then %1$L else e.status end,
        metadata   = coalesce(e.metadata, '{}'::jsonb)
                     || coalesce(excluded.metadata, '{}'::jsonb)
      -- xmax = 0 on a fresh INSERT, non-zero on the ON CONFLICT UPDATE path.
      -- event_status is NORMALISED ('open' / 'resolved' from ended_at) so the
      -- /api/mide/event HTTP contract does not depend on the physical status
      -- vocabulary. Every other RETURNING expr is pinned to its OUT type
      -- (kept from 20260905120004).
      returning
        (e.xmax::text::bigint = 0),
        (case when e.ended_at is not null then 'resolved' else 'open' end)::text,
        e.id::uuid,
        e.value_at_start::numeric,
        e.peak_value::numeric,
        e.started_at::timestamptz,
        e.ended_at::timestamptz;
    end;
    $body$;
  $fn$, v_closed, v_open);
end
$mig$;

-- Grants: CREATE OR REPLACE keeps them; re-issued defensively (no-op on live).
revoke all on function public.mide_upsert_event(uuid, text, text, text, timestamptz, numeric, timestamptz, numeric, jsonb) from public;
grant execute on function public.mide_upsert_event(uuid, text, text, text, timestamptz, numeric, timestamptz, numeric, jsonb) to service_role;

notify pgrst, 'reload schema';
