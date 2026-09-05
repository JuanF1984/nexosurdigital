-- MIDE: idempotency for POST /api/mide/report.
--
-- Problem (confirmed in code and in
-- docs/mide/analisis-prueba-prolongada/informe.md §2.3): the report endpoint
-- had NO idempotency protection. When the ESP32 retries a report it did not
-- get a 200 for in time (8 s HTTP timeout), mide_ingest_report() inserted a
-- brand new measurements row every time -> 40 duplicate groups / 43 extra
-- rows over a 10-day run (~1.5 % of raw rows), all sharing the same
-- (device_id, metric, period_start).
--
-- Fix: a natural key + upsert.
--   * Natural key: (device_id, metric, period_start). The firmware keeps
--     period_start stable across retries (accumulator.cpp::mergeReportInto
--     never moves the start, it only extends period_end), so this triple
--     identifies one reporting period uniquely.
--   * On conflict: keep the MOST COMPLETE version of the period. A plain
--     retry carries identical values (its update is a harmless no-op); a
--     retry that also merged a longer window on the device carries a wider
--     period_end and a higher sample_count, so we take that one; a stale or
--     narrower retry is ignored (its update is skipped by the WHERE clause).
--     No valid data is ever lost.
--
-- IMPORTANT: like 20260818000000_mide_schema.sql, the live Supabase project
-- was built by hand. Apply this migration there MANUALLY after diffing it
-- against the real schema. Every statement is written to be safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. De-duplicate existing rows so the UNIQUE constraint can be added.
--    Keep, per (device_id, metric, period_start), the row with the highest
--    sample_count (most complete), then the most recent created_at, then the
--    highest id as a final tiebreak. Mirrors the dedup rule the
--    prueba-prolongada analysis already applied by hand ("fila más completa /
--    de id más alto de cada grupo").
-- ---------------------------------------------------------------------------

delete from public.measurements m
using (
  select
    id,
    row_number() over (
      partition by device_id, metric, period_start
      order by sample_count desc, created_at desc, id desc
    ) as rn
  from public.measurements
) ranked
where m.id = ranked.id
  and ranked.rn > 1;

-- ---------------------------------------------------------------------------
-- 2. Natural-key uniqueness.
-- ---------------------------------------------------------------------------

alter table public.measurements
  drop constraint if exists measurements_device_metric_period_unique;

alter table public.measurements
  add constraint measurements_device_metric_period_unique
  unique (device_id, metric, period_start);

-- The pre-existing plain index idx_measurements_device_metric_period
-- (device_id, metric, period_start DESC) is kept: it still serves the
-- dashboard's "latest periods for a device/metric" query, and its DESC column
-- order differs from the all-ASC index the UNIQUE constraint creates.

-- ---------------------------------------------------------------------------
-- 3. mide_ingest_report: INSERT ... ON CONFLICT DO UPDATE.
--    Same signature and return value as before (returns config_version), so
--    the /api/mide/report route handler is unchanged.
-- ---------------------------------------------------------------------------

create or replace function public.mide_ingest_report(
  p_device_id uuid,
  p_firmware_version text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_metrics jsonb
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_config_version integer;
begin
  insert into public.measurements (
    device_id, metric, unit, period_start, period_end,
    min_value, max_value, avg_value, sample_count
  )
  select
    p_device_id,
    (m ->> 'metric'),
    (m ->> 'unit'),
    p_period_start,
    p_period_end,
    (m ->> 'min')::numeric,
    (m ->> 'max')::numeric,
    (m ->> 'avg')::numeric,
    (m ->> 'samples')::integer
  from jsonb_array_elements(p_metrics) as m
  on conflict (device_id, metric, period_start) do update set
    period_end   = excluded.period_end,
    unit         = excluded.unit,
    min_value    = excluded.min_value,
    max_value    = excluded.max_value,
    avg_value    = excluded.avg_value,
    sample_count = excluded.sample_count
  where excluded.sample_count >= public.measurements.sample_count;

  update public.devices
  set last_seen_at = now(),
      firmware_version = coalesce(p_firmware_version, firmware_version)
  where id = p_device_id;

  select config_version into v_config_version
  from public.device_config
  where device_id = p_device_id;

  return v_config_version;
end;
$$;

revoke all on function public.mide_ingest_report(uuid, text, timestamptz, timestamptz, jsonb) from public;
grant execute on function public.mide_ingest_report(uuid, text, timestamptz, timestamptz, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Extra privilege the upsert needs.
--    mide_ingest_report runs SECURITY INVOKER (caller = service_role). It was
--    a plain INSERT before; now it is INSERT ... ON CONFLICT DO UPDATE, so
--    service_role needs UPDATE on measurements too (it already had INSERT).
--    No SELECT is needed here (the function has no RETURNING on measurements).
-- ---------------------------------------------------------------------------

grant update on public.measurements to service_role;

