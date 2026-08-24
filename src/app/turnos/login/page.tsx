import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTurnosAuthServerClient } from "@/lib/turnos/supabase-auth";
import { signInAction } from "./actions";

export const metadata: Metadata = { title: "Turnos — Ingresar | Nexo Sur" };

export default async function TurnosLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const configured = Boolean(process.env.TURNOS_SUPABASE_URL) && Boolean(process.env.TURNOS_SUPABASE_ANON_KEY);

  if (!configured) {
    return (
      <section className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-6 py-16 text-center">
        <h1 className="font-display text-3xl mb-3">Turnos no está configurado todavía</h1>
        <p className="text-text-secondary text-sm">
          Faltan las variables de entorno <code className="font-mono text-text-primary">TURNOS_SUPABASE_URL</code>{" "}
          y/o <code className="font-mono text-text-primary">TURNOS_SUPABASE_ANON_KEY</code> en este entorno. Ver{" "}
          <code className="font-mono text-text-primary">docs/turnos/configuracion.md</code>.
        </p>
      </section>
    );
  }

  const supabase = await getTurnosAuthServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/turnos/dashboard");
  }

  const { error } = await searchParams;

  return (
    <section className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center px-6 py-16">
      <h1 className="font-display text-3xl mb-2">Turnos</h1>
      <p className="text-text-secondary text-sm mb-8">Acceso privado para el equipo de Nexo Sur.</p>

      <form action={signInAction} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1 block text-xs uppercase tracking-wide text-text-dim">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="w-full rounded-lg border border-white/10 bg-card px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-blue"
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-xs uppercase tracking-wide text-text-dim">
            Contraseña
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded-lg border border-white/10 bg-card px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-blue"
          />
        </div>

        {error && <p className="text-xs text-turnos-danger">Email o contraseña incorrectos.</p>}

        <button
          type="submit"
          className="w-full rounded-lg bg-accent-blue px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          Ingresar
        </button>
      </form>
    </section>
  );
}
