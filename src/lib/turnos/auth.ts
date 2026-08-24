import { redirect } from "next/navigation";
import { getTurnosAuthServerClient } from "@/lib/turnos/supabase-auth";

export type TurnosUser = {
  id: string;
  email: string | null;
};

// Re-verifies the session on the server, independent of what
// src/middleware.ts already did. Never rely on the middleware redirect
// alone to protect a page — this call is the actual authentication check
// for /turnos/dashboard (and any future protected Turnos route): it always
// asks Supabase Auth directly (getUser() validates the token against the
// server, unlike reading a decoded session cookie), and redirects to
// /turnos/login if there is no valid user. See docs/turnos/dashboard.md.
export async function requireTurnosUser(): Promise<TurnosUser> {
  const supabase = await getTurnosAuthServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/turnos/login");
  }

  return { id: user.id, email: user.email ?? null };
}
