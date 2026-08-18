import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only client using the Supabase service role key. Never import this
// module from client components — MIDE_DEVICE_API_KEY / SUPABASE_SECRET_KEY
// must stay on the server.
let cachedClient: SupabaseClient | null = null;

export function getMideSupabaseClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    throw new Error("mide: missing SUPABASE_URL or SUPABASE_SECRET_KEY");
  }

  cachedClient = createClient(url, key, {
    auth: { persistSession: false },
  });

  return cachedClient;
}
