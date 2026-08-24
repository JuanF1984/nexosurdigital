"use server";

import { revalidatePath } from "next/cache";
import { requireTurnosUser } from "@/lib/turnos/auth";
import { getComerciosForUser } from "@/lib/turnos/authorization";
import { getTurnoOwnership, cancelTurnoRemote } from "@/lib/turnos/cancellation";

export type CancelReservationResult = { ok: true; alreadyCancelled: boolean } | { ok: false; message: string };

const GENERIC_ERROR = "No pudimos cancelar la reserva. Intentá de nuevo en unos minutos.";
const NOT_FOUND_MESSAGE = "No encontramos esa reserva.";

// Server Action invocada desde CancelReservationButton (Client Component).
// Es el único camino para cancelar un turno desde este dashboard — nunca se
// llama a nexosur-turnos desde el navegador, y TURNOS_API_TOKEN nunca sale
// de este archivo/módulo server-only.
//
// Orden de validación (ver docs/turnos/cancelacion.md para el detalle):
// 1) Autenticación: requireTurnosUser() vuelve a confirmar la sesión contra
//    Supabase Auth en cada llamada — nunca se asume que, porque el usuario
//    llegó a ver el botón, sigue autenticado en este request.
// 2) Autorización: qué comercio(s) puede administrar ese usuario
//    (usuario_comercios vía getComerciosForUser).
// 3) Pertenencia: a qué comercio pertenece el turnoId recibido
//    (getTurnoOwnership, lectura propia — nunca se confía en un comercioId
//    mandado por el cliente ni implícito en el turnoId).
// 4) Recién con (2) y (3) verificados, la llamada backend-to-backend a
//    nexosur-turnos con el comercioId ya autorizado.
export async function cancelReservationAction(turnoId: string): Promise<CancelReservationResult> {
  if (!turnoId || typeof turnoId !== "string") {
    return { ok: false, message: GENERIC_ERROR };
  }

  const user = await requireTurnosUser();

  const comercios = await getComerciosForUser(user.id);
  if (comercios.length === 0) {
    return { ok: false, message: GENERIC_ERROR };
  }
  const authorizedComercioIds = new Set(comercios.map((comercio) => comercio.comercioId));

  const turno = await getTurnoOwnership(turnoId);

  // Mismo criterio que el backend (docs/turnos/cancelacion.md): nunca se
  // distingue "no existe" de "es de otro comercio" en el mensaje, para no
  // filtrar información sobre turnos ajenos a quien manipule el turnoId.
  if (!turno || !authorizedComercioIds.has(turno.comercioId)) {
    return { ok: false, message: NOT_FOUND_MESSAGE };
  }

  const result = await cancelTurnoRemote({ comercioId: turno.comercioId, turnoId: turno.id });

  if (!result.ok) {
    if (result.reason === "not_found") {
      return { ok: false, message: NOT_FOUND_MESSAGE };
    }
    if (result.reason === "conflict") {
      return { ok: false, message: "Esa reserva ya no se puede cancelar." };
    }
    // "config" | "unavailable" | "unexpected": nunca se expone el detalle
    // interno (falta configuración, timeout, respuesta rara del backend) al
    // usuario — el detalle ya quedó en console.error dentro de
    // cancelTurnoRemote.
    return { ok: false, message: GENERIC_ERROR };
  }

  // Refresca /turnos/dashboard para que el próximo render del Server
  // Component traiga el turno ya cancelado (misma ruta ya es
  // force-dynamic/revalidate 0, esto además invalida el router cache del
  // cliente que disparó la acción).
  revalidatePath("/turnos/dashboard");

  return { ok: true, alreadyCancelled: result.alreadyCancelled };
}
