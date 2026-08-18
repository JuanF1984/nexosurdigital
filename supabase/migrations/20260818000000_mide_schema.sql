-- MIDE platform schema (devices, measurements, events, device_config).
--
-- IMPORTANT: these four tables were originally created MANUALLY in the
-- Supabase project this app talks to. This migration is a best-effort,
-- reproducible re-derivation of that manually-created schema, written from
-- the project's design notes rather than from a live introspection dump
-- (no DB credentials were available while writing it). Before running this
-- against the existing project, diff it against the real schema
-- (`supabase db diff` or an equivalent manual check) — every statement below
-- is written defensively (IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS)
-- so it is safe to re-run, but column/constraint names must match reality
-- before you rely on it. See supabase/README.md and
-- docs/mide/base-de-datos.md for more context.
--
-- This schema is intentionally separate from, and has no relationship to,
-- the pre-existing /api/energy-event feature (which has no database at all).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- devices
-- ---------------------------------------------------------------------------

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  device_code text not null unique,
  device_type text not null,
  name text not null,
  location text,
  active boolean not null default true,
  firmware_version text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.devices is
  'MIDE devices (any product line: frio, energia, aire, ...). Not exclusive to temperature.';

-- ---------------------------------------------------------------------------
-- measurements
--
-- Periodic summaries reported by a device, NOT individual sensor readings.
-- One row per (device, metric, reporting period). "metric" is a free-form
-- string (temperature, humidity, co2, voltage, ...) so the schema is not
-- tied to any single product.
-- ---------------------------------------------------------------------------

create table if not exists public.measurements (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices (id) on delete cascade,
  metric text not null,
  unit text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  min_value numeric not null,
  max_value numeric not null,
  avg_value numeric not null,
  sample_count integer not null,
  created_at timestamptz not null default now(),
  constraint measurements_period_valid check (period_end > period_start),
  constraint measurements_sample_count_positive check (sample_count > 0),
  constraint measurements_min_avg_max_order check (min_value <= avg_value and avg_value <= max_value)
);

comment on table public.measurements is
  'Periodic summaries (min/max/avg/sample_count per period), not raw samples. See docs/mide/base-de-datos.md.';

create index if not exists idx_measurements_device_metric_period
  on public.measurements (device_id, metric, period_start desc);

-- ---------------------------------------------------------------------------
-- events
--
-- device_id + event_uid is unique on purpose: it lets a device retry
-- reporting the same event (e.g. after losing the HTTP response) without
-- creating duplicate rows or duplicate future notifications.
-- ---------------------------------------------------------------------------

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices (id) on delete cascade,
  event_uid text not null,
  event_type text not null,
  severity text not null default 'info',
  started_at timestamptz not null,
  ended_at timestamptz,
  value_at_start numeric,
  peak_value numeric,
  status text not null default 'open',
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_device_event_uid_unique unique (device_id, event_uid),
  constraint events_severity_valid check (severity in ('info', 'warning', 'critical')),
  constraint events_status_valid check (status in ('open', 'resolved')),
  constraint events_ended_after_started check (ended_at is null or ended_at >= started_at)
);

comment on table public.events is
  'Alarms/events for any device type (TEMP_HIGH, POWER_LOSS, SENSOR_FAILURE, ...), not limited to temperature.';

create index if not exists idx_events_device_started
  on public.events (device_id, started_at desc);

create index if not exists idx_events_open_status
  on public.events (device_id, status)
  where status = 'open';

-- ---------------------------------------------------------------------------
-- device_config
--
-- One row per device (1:1). config_version lets a device compare the
-- version it already applied (returned by /api/mide/report) against the
-- server's current version and only call /api/mide/config when they differ.
-- ---------------------------------------------------------------------------

create table if not exists public.device_config (
  device_id uuid primary key references public.devices (id) on delete cascade,
  sample_interval_seconds integer not null,
  report_interval_seconds integer not null,
  min_threshold numeric,
  max_threshold numeric,
  alarm_delay_seconds integer,
  recovery_delay_seconds integer,
  hysteresis numeric,
  config_version integer not null default 1,
  updated_at timestamptz not null default now()
);

comment on table public.device_config is
  'Per-device operating configuration (thresholds, intervals, alarm timing). One row per device.';

-- ---------------------------------------------------------------------------
-- updated_at triggers
--
-- Function name is prefixed with mide_ to avoid colliding with any
-- generic-named trigger function that may already exist in the shared
-- `public` schema for unrelated tables.
-- ---------------------------------------------------------------------------

create or replace function public.mide_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists mide_set_updated_at on public.devices;
create trigger mide_set_updated_at
  before update on public.devices
  for each row execute function public.mide_set_updated_at();

drop trigger if exists mide_set_updated_at on public.events;
create trigger mide_set_updated_at
  before update on public.events
  for each row execute function public.mide_set_updated_at();

drop trigger if exists mide_set_updated_at on public.device_config;
create trigger mide_set_updated_at
  before update on public.device_config
  for each row execute function public.mide_set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- RLS is enabled with NO policies: only the service role (used exclusively
-- by the server-side /api/mide/* route handlers) can read/write, since it
-- bypasses RLS entirely. There is intentionally no anon/authenticated
-- access yet — that will only be added once MIDE has real user accounts and
-- a client/device ownership model (see docs/mide/arquitectura.md).
-- ---------------------------------------------------------------------------

alter table public.devices enable row level security;
alter table public.measurements enable row level security;
alter table public.events enable row level security;
alter table public.device_config enable row level security;

-- ---------------------------------------------------------------------------
-- mide_ingest_report: atomically insert one measurement row per reported
-- metric and update the device's last_seen_at/firmware_version, returning
-- the device's current config_version. Runs as SECURITY INVOKER (default),
-- so it only ever has the privileges of the calling role (the server's
-- service-role key) — it does not grant elevated access on its own.
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
  from jsonb_array_elements(p_metrics) as m;

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
