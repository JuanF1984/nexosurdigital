import type { TurnosResumen } from "@/lib/turnos/dashboard-data";

export function ReservationsSummary({ resumen }: { resumen: TurnosResumen | null }) {
  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <StatTile label="Reservas de hoy" value={resumen?.hoyCount ?? null} />
      <StatTile label="Próximas reservas" value={resumen?.proximasCount ?? null} />
    </section>
  );
}

function StatTile({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-card px-6 py-6">
      <p className="mb-2 text-xs uppercase tracking-[0.2em] text-text-dim">{label}</p>
      {value === null ? (
        <p className="font-display text-xl text-text-dim">No disponible</p>
      ) : (
        <p className="font-mono text-4xl text-text-primary">{value}</p>
      )}
    </div>
  );
}
