import type { SectionResult, TurnoRecord } from "@/lib/turnos/dashboard-data";
import { formatFecha, formatHora } from "@/lib/turnos/format";
import { ReservationStatusBadge } from "./ReservationStatusBadge";
import { ChannelBadge } from "./ChannelBadge";
import { CancelReservationButton } from "./CancelReservationButton";

export function ReservationsList({ result }: { result: SectionResult<TurnoRecord[]> }) {
  if (!result.ok) {
    return (
      <p className="rounded-xl border border-white/5 bg-card px-4 py-6 text-sm text-text-dim">
        No pudimos cargar las reservas en este momento.
      </p>
    );
  }

  if (result.data.length === 0) {
    return (
      <p className="rounded-xl border border-white/5 bg-card px-4 py-6 text-sm text-text-dim">
        Sin reservas próximas registradas.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {result.data.map((turno) => (
        <li key={turno.id} className="rounded-xl border border-white/5 bg-card px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-text-primary">{turno.clienteNombre}</p>
              <p className="font-mono text-xs text-text-dim">{turno.telefono}</p>
            </div>
            <div className="flex items-center gap-2">
              <ReservationStatusBadge estado={turno.estado} />
              <ChannelBadge canal={turno.canal} />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-text-secondary sm:grid-cols-4">
            <Field label="Servicio" value={turno.servicioNombre ?? "—"} />
            <Field label="Recurso" value={turno.recursoNombre ?? "—"} />
            <Field
              label="Personas"
              value={turno.cantidadPersonas != null ? String(turno.cantidadPersonas) : "—"}
            />
            <Field label="Fecha y hora" value={`${formatFecha(turno.fecha)} · ${formatHora(turno.horaInicio)}`} />
          </div>

          {turno.estado === "confirmado" && (
            <div className="mt-3 flex justify-end border-t border-white/5 pt-3">
              <CancelReservationButton turnoId={turno.id} clienteNombre={turno.clienteNombre} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[0.65rem] uppercase tracking-wide text-text-dim">{label}</p>
      <p className="text-text-primary">{value}</p>
    </div>
  );
}
