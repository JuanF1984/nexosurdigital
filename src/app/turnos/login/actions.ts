"use server";

import { redirect } from "next/navigation";
import { getTurnosAuthServerClient } from "@/lib/turnos/supabase-auth";

// Server Action: runs exclusively on the server, so no Supabase client, key,
// or credential ever reaches the browser bundle for this login flow — the
// login form posts directly to this function, there is no client-side
// fetch/JS involved.
export async function signInAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect("/turnos/login?error=1");
  }

  const supabase = await getTurnosAuthServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Never log the submitted password. Supabase's own error is generic
    // ("Invalid login credentials") and not logged here at all — this path
    // only ever receives user-typed credentials, so it stays silent.
    redirect("/turnos/login?error=1");
  }

  redirect("/turnos/dashboard");
}

export async function signOutAction() {
  const supabase = await getTurnosAuthServerClient();
  await supabase.auth.signOut();
  redirect("/turnos/login");
}
