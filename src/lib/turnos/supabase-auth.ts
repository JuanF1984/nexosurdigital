import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Session-bound Supabase client used ONLY for Turnos authentication
// (sign in / sign out / read the current user) — never for business data.
// Uses the anon/publishable key of Turnos' own Supabase project, bound to
// this request's cookies via @supabase/ssr. Reading business tables
// (turnos, comercios, servicios, recursos, usuario_comercios) always goes
// through getTurnosSupabaseClient() instead, which uses the service role
// key. Keeping these two clients separate means a bug in the auth flow can
// never accidentally read/write business data with elevated privileges.
//
// Server-only: depends on next/headers cookies(), so it can never be
// imported from a Client Component (Next.js would fail the build).
export async function getTurnosAuthServerClient() {
  const cookieStore = await cookies();

  const url = process.env.TURNOS_SUPABASE_URL;
  const anonKey = process.env.TURNOS_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("turnos: missing TURNOS_SUPABASE_URL or TURNOS_SUPABASE_ANON_KEY");
  }

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component render, which can't set cookies
          // (no mutable response in scope) — expected and harmless here.
          // src/middleware.ts refreshes the session cookie on every request
          // to /turnos/*, and Server Actions (src/app/turnos/login/actions.ts)
          // can set cookies directly, so the session still stays fresh.
        }
      },
    },
  });
}
