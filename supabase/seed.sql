-- Development-only seed data for MIDE. Not part of the schema migration on
-- purpose (see supabase/README.md) — do not run this against production.
--
-- Registers the MIDE Frío prototype device and its initial operating
-- configuration. These threshold/interval values are the prototype's
-- starting point, not a final specification — see docs/mide/base-de-datos.md.

insert into public.devices (device_code, device_type, name, location, active)
values ('mide-frio-001', 'frio', 'MIDE Frío Prototipo', null, true)
on conflict (device_code) do nothing;

insert into public.device_config (
  device_id,
  sample_interval_seconds,
  report_interval_seconds,
  min_threshold,
  max_threshold,
  alarm_delay_seconds,
  recovery_delay_seconds,
  hysteresis,
  config_version
)
select
  d.id,
  5,
  300,
  2,
  8,
  180,
  120,
  0.5,
  1
from public.devices d
where d.device_code = 'mide-frio-001'
on conflict (device_id) do nothing;

-- Inactive device fixture, used only to exercise the "dispositivo inactivo"
-- (403) path in scripts/test-mide.mjs. Not a real product device.
insert into public.devices (device_code, device_type, name, location, active)
values ('mide-test-inactivo-001', 'frio', 'MIDE Fixture Inactivo (tests)', null, false)
on conflict (device_code) do nothing;
