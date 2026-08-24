import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only privileged client for Turnos business data (comercios,
// servicios, recursos, turnos, usuario_comercios), using the service role
// key of Turnos' OWN Supabase project — a different project than MIDE's.
// Never import this module from a client component, and never reuse
// getMideSupabaseClient() here or vice versa: the two platforms intentionally
// don't share a client, env vars, or Supabase project. See
// docs/turnos/arquitectura.md.
let cachedClient: SupabaseClient | null = null;

export function getTurnosSupabaseClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const url = process.env.TURNOS_SUPABASE_URL;
  const key = process.env.TURNOS_SUPABASE_SECRET_KEY;

  if (!url || !key) {
    throw new Error("turnos: missing TURNOS_SUPABASE_URL or TURNOS_SUPABASE_SECRET_KEY");
  }

  cachedClient = createClient(url, key, {
    auth: { persistSession: false },
  });

  return cachedClient;
}
