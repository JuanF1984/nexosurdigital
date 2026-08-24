"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelReservationAction } from "@/app/turnos/dashboard/actions";

// Único punto de UI para cancelar una reserva. Server Action, nunca un
// fetch desde el cliente: cancelReservationAction hace toda la
// autenticación/autorización/llamada backend-to-backend server-side (ver
// src/app/turnos/dashboard/actions.ts).
export function CancelReservationButton({ turnoId, clienteNombre }: { turnoId: string; clienteNombre: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  function handleClick() {
    // Confirmación explícita antes de cancelar (patrón más simple: confirm
    // nativo, consistente con el resto del proyecto que no usa ninguna
    // librería de modales/toasts).
    const confirmed = window.confirm(`¿Cancelar la reserva de ${clienteNombre}?`);
    if (!confirmed) return;

    setFeedback(null);
    startTransition(async () => {
      const result = await cancelReservationAction(turnoId);

      if (result.ok) {
        setFeedback({
          type: "success",
          text: result.alreadyCancelled ? "Esa reserva ya estaba cancelada." : "Reserva cancelada.",
        });
        router.refresh();
      } else {
        setFeedback({ type: "error", text: result.message });
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="text-xs font-medium text-turnos-danger transition-opacity hover:opacity-80 disabled:opacity-50"
      >
        {isPending ? "Cancelando…" : "Cancelar reserva"}
      </button>
      {feedback && (
        <p
          className={`text-[0.65rem] ${feedback.type === "error" ? "text-turnos-danger" : "text-accent-green"}`}
          role="status"
        >
          {feedback.text}
        </p>
      )}
    </div>
  );
}
