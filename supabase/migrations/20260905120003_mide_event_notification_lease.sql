-- MIDE: make the e-mail notification idempotency of POST /api/mide/event
-- crash-safe. Incremental — builds on the schema left by
-- 20260905120002_mide_event_notifications.sql, which is ALREADY APPLIED to the
-- live Supabase project. Nothing here recreates a column or changes a
-- function signature, so it is safe to run once on the current database.
--
-- ---------------------------------------------------------------------------
-- Why
-- ---------------------------------------------------------------------------
-- In 20260905120002, mide_claim_event_notification does
--   UPDATE events SET <kind>_notified_at = now() WHERE <kind>_notified_at IS NULL
-- i.e. the SAME column means both "a worker is trying to send" and "the
-- e-mail was sent". If the worker crashes between that UPDATE and the e-mail
-- provider confirming, the row stays marked forever and the notification is
-- silently lost.
--
-- This migration splits the two facts:
--   * <kind>_notify_claimed_at  -- short-lived CLAIM / lease. Set on claim.
--                                  Reclaimable once older than the lease
--                                  (2 min) -> a crashed worker's claim heals.
--   * <kind>_notified_at        -- permanent CONFIRMED-SENT marker. Now written
--                                  ONLY after the provider accepts the e-mail,
--                                  by the new mide_confirm_event_notification.
--
-- Route flow becomes:
--   claim -> build+send -> confirm            [happy path]
--   claim -> send fails  -> release           [drop lease, retry immediately]
--   claim -> process dies -> (nothing)        [lease expires, next retry resends]
--
-- At-least-once: if a worker sent the e-mail and then died before confirming,
-- a later retry (after the lease) sends it again. Accepted on purpose.
--
-- ---------------------------------------------------------------------------
-- Effect on rows that already exist in the live table
-- ---------------------------------------------------------------------------
-- Rows whose alert_notified_at / recovery_notified_at is already NOT NULL keep
-- counting as "confirmed sent" and are never re-sent — same as before this
-- migration. The new *_notify_claimed_at columns start NULL for every row,
-- which is correct: no claim is in flight. No data backfill is needed.
--
-- IMPORTANT: apply MANUALLY to the live Supabase project, AFTER 20260905120002
-- and BEFORE deploying the route code that calls
-- mide_confirm_event_notification. Idempotent / safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Add the per-kind claim/lease columns (the confirmed-sent columns from
--    20260905120002 stay as they are).
-- ---------------------------------------------------------------------------

alter table public.events
  add column if not exists alert_notify_claimed_at timestamptz;
alter table public.events
  add column if not exists recovery_notify_claimed_at timestamptz;

comment on column public.events.alert_notify_claimed_at is
  'CLAIM / lease: a worker is currently trying to send the ALERT e-mail. '
  'Reclaimable once older than the lease in mide_claim_event_notification '
  '(models a worker that crashed before confirming). NULL when idle.';
comment on column public.events.recovery_notify_claimed_at is
  'CLAIM / lease for the RECOVERY e-mail. Same semantics as the ALERT one.';

comment on column public.events.alert_notified_at is
  'CONFIRMED: the ALERT e-mail for this episode was accepted by the provider. '
  'Written only by mide_confirm_event_notification. Once set, never re-sent.';
comment on column public.events.recovery_notified_at is
  'CONFIRMED: the RECOVERY e-mail for this episode was accepted by the provider.';

-- ---------------------------------------------------------------------------
-- 2. mide_claim_event_notification: same signature (uuid, text) -> boolean,
--    new body. Now stamps the CLAIM column, and only if the kind is not
--    already confirmed AND there is no live lease.
--    CREATE OR REPLACE keeps the existing grants.
-- ---------------------------------------------------------------------------

create or replace function public.mide_claim_event_notification(
  p_event_id uuid,
  p_kind     text
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  -- Longer than any single send attempt (Vercel function timeout + a Resend
  -- round-trip), shorter than a few firmware retry cycles so a crashed
  -- worker's notification is picked up again quickly.
  v_lease constant interval := interval '2 minutes';
begin
  if p_kind = 'alert' then
    update public.events
      set alert_notify_claimed_at = now()
      where id = p_event_id
        and alert_notified_at is null
        and (alert_notify_claimed_at is null
             or alert_notify_claimed_at < now() - v_lease);
  elsif p_kind = 'recovery' then
    update public.events
      set recovery_notify_claimed_at = now()
      where id = p_event_id
        and recovery_notified_at is null
        and (recovery_notify_claimed_at is null
             or recovery_notify_claimed_at < now() - v_lease);
  else
    raise exception 'mide_claim_event_notification: kind invalido %', p_kind;
  end if;

  -- FOUND is true iff the UPDATE matched, i.e. this call won the claim.
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. mide_confirm_event_notification: NEW. Marks the kind permanently sent,
--    clears the claim. Called only after the provider accepts. Idempotent.
-- ---------------------------------------------------------------------------

create or replace function public.mide_confirm_event_notification(
  p_event_id uuid,
  p_kind     text
)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_kind = 'alert' then
    update public.events
      set alert_notified_at = now(), alert_notify_claimed_at = null
      where id = p_event_id and alert_notified_at is null;
  elsif p_kind = 'recovery' then
    update public.events
      set recovery_notified_at = now(), recovery_notify_claimed_at = null
      where id = p_event_id and recovery_notified_at is null;
  else
    raise exception 'mide_confirm_event_notification: kind invalido %', p_kind;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. mide_release_event_notification: same signature (uuid, text) -> void,
--    new body. Now drops the CLAIM (not the confirmed-sent marker), so a send
--    that failed while the process is alive can be retried without waiting out
--    the lease. Never touches an already-confirmed kind.
-- ---------------------------------------------------------------------------

create or replace function public.mide_release_event_notification(
  p_event_id uuid,
  p_kind     text
)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_kind = 'alert' then
    update public.events set alert_notify_claimed_at = null
      where id = p_event_id and alert_notified_at is null;
  elsif p_kind = 'recovery' then
    update public.events set recovery_notify_claimed_at = null
      where id = p_event_id and recovery_notified_at is null;
  else
    raise exception 'mide_release_event_notification: kind invalido %', p_kind;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants. claim/release already had them from 20260905120002 (re-issued
--    here, harmless); confirm is new.
-- ---------------------------------------------------------------------------

revoke all on function public.mide_claim_event_notification(uuid, text) from public;
grant execute on function public.mide_claim_event_notification(uuid, text) to service_role;

revoke all on function public.mide_confirm_event_notification(uuid, text) from public;
grant execute on function public.mide_confirm_event_notification(uuid, text) to service_role;

revoke all on function public.mide_release_event_notification(uuid, text) from public;
grant execute on function public.mide_release_event_notification(uuid, text) to service_role;

-- service_role already has update, select on public.events (granted by
-- 20260905120001); nothing more is needed.

-- Tell PostgREST (supabase-js .rpc) to pick up the new function immediately.
notify pgrst, 'reload schema';
