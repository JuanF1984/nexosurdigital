import type { Metadata } from "next";
import { requireTurnosUser } from "@/lib/turnos/auth";
import { getComerciosForUser } from "@/lib/turnos/authorization";
import { getTurnosDashboardData } from "@/lib/turnos/dashboard-data";
import { ReservationsSummary } from "@/components/turnos/ReservationsSummary";
import { ReservationsList } from "@/components/turnos/ReservationsList";
import { SignOutButton } from "@/components/turnos/SignOutButton";

// Siempre datos frescos: un dashboard operativo de reservas nunca debe
// servir una foto vieja de `turnos` (mismo criterio que /mide/dashboard).
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = { title: "Turnos — Dashboard | Nexo Sur" };

export default async function TurnosDashboardPage() {
  // 1) Autenticación: quién es el usuario. Redirige a /turnos/login si no
  // hay sesión válida — independiente de lo que ya haya hecho el middleware.
  const user = await requireTurnosUser();

  // 2) Autorización: qué comercio(s) puede administrar ese usuario. Tabla
  // usuario_comercios, separada de la autenticación (ver
  // docs/turnos/arquitectura.md).
  const comercios = await getComerciosForUser(user.id);

  if (comercios.length === 0) {
    return (
      <section className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="font-display text-3xl mb-3">Sin comercios asignados</h1>
        <p className="text-text-secondary text-sm mb-8">
          Tu usuario ({user.email}) no tiene ningún comercio asignado todavía en{" "}
          <span className="font-mono">usuario_comercios</span>. Pedile a quien administra Turnos que te asigne uno.
        </p>
        <SignOutButton />
      </section>
    );
  }

  // MVP de un solo comercio real (demo): si el usuario tuviera varios, se
  // toma el primero. Un selector de comercio es la extensión natural cuando
  // haga falta (ver docs/turnos/arquitectura.md), no una reescritura.
  const comercioAccess = comercios[0];
  const dashboard = await getTurnosDashboardData(comercioAccess.comercioId);

  if (!dashboard.comercio) {
    return (
      <section className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="font-display text-3xl mb-3">Comercio no encontrado</h1>
        <p className="text-text-secondary text-sm mb-8">
          No encontramos el comercio <span className="font-mono">{comercioAccess.comercioId}</span> en la base.
        </p>
        <SignOutButton />
      </section>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">{dashboard.comercio.nombre}</h1>
          <p className="text-text-secondary text-sm">{user.email}</p>
        </div>
        <SignOutButton />
      </div>

      <ReservationsSummary resumen={dashboard.resumen} />

      <section>
        <h2 className="mb-4 text-xs uppercase tracking-[0.2em] text-text-dim">Próximas reservas</h2>
        <ReservationsList result={dashboard.turnos} />
      </section>
    </div>
  );
}
