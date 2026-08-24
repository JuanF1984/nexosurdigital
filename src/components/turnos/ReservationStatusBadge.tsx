import { formatEstado } from "@/lib/turnos/format";

export function ReservationStatusBadge({ estado }: { estado: string }) {
  const isCancelado = estado === "cancelado";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-wide ${
        isCancelado
          ? "border-turnos-danger/30 bg-turnos-danger/10 text-turnos-danger"
          : "border-accent-green/25 bg-accent-green/10 text-accent-green"
      }`}
    >
      {formatEstado(estado)}
    </span>
  );
}
