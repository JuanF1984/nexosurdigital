import { getTurnosSupabaseClient } from "@/lib/turnos/supabase";

// Consumidor server-only de la cancelación real, que vive en el backend
// separado `nexosur-turnos` (POST /api/turnos/cancelar, que a su vez llama
// a cancelarTurno() en src/domain/cancellation/cancelarTurno.js de ese
// proyecto). Este módulo NUNCA reimplementa esa lógica de negocio: solo (a)
// resuelve a qué comercio pertenece un turno para que el llamador pueda
// autorizarlo contra usuario_comercios, y (b) hace la llamada
// backend-to-backend una vez que esa autorización ya se verificó. Ver
// docs/turnos/cancelacion.md.

export type TurnoOwnership = { id: string; comercioId: string; estado: string };

// Lectura mínima para autorización: a qué comercio pertenece este turno y en
// qué estado está. Nunca se usa un comercioId recibido del cliente — el
// llamador (cancelReservationAction) resuelve el comercio acá y lo compara
// contra los comercios autorizados del usuario antes de seguir.
export async function getTurnoOwnership(turnoId: string): Promise<TurnoOwnership | null> {
  const supabase = getTurnosSupabaseClient();

  const { data, error } = await supabase
    .from("turnos")
    .select("id, comercio_id, estado")
    .eq("id", turnoId)
    .maybeSingle();

  if (error) {
    console.error("turnos/cancellation: error consultando turno:", error.message);
    return null;
  }

  if (!data) return null;

  return {
    id: data.id as string,
    comercioId: data.comercio_id as string,
    estado: data.estado as string,
  };
}

export type CancelBackendResult =
  | { ok: true; alreadyCancelled: boolean }
  | { ok: false; reason: "not_found" | "conflict" | "config" | "unavailable" | "unexpected" };

const CANCEL_TIMEOUT_MS = 10_000;

// Llamada backend-to-backend a nexosur-turnos, autenticada con el secreto
// compartido TURNOS_API_TOKEN (Authorization: Bearer). Esto autentica QUIÉN
// LLAMA (nexosur-web es un backend de confianza) — no representa por sí
// solo la autorización del usuario del dashboard. Esa autorización (usuario
// -> usuario_comercios -> comercio del turno) debe estar resuelta por el
// llamador ANTES de invocar esta función; acá no se vuelve a validar nada
// de eso, solo se confía en el comercioId que ya llegó verificado.
export async function cancelTurnoRemote({
  comercioId,
  turnoId,
}: {
  comercioId: string;
  turnoId: string;
}): Promise<CancelBackendResult> {
  const baseUrl = process.env.TURNOS_API_URL;
  const token = process.env.TURNOS_API_TOKEN;

  if (!baseUrl || !token) {
    console.error("turnos/cancellation: falta TURNOS_API_URL o TURNOS_API_TOKEN");
    return { ok: false, reason: "config" };
  }

  let response: Response;
  try {
    response = await fetch(new URL("/api/turnos/cancelar", baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ comercioId, turnoId }),
      signal: AbortSignal.timeout(CANCEL_TIMEOUT_MS),
    });
  } catch (error) {
    console.error("turnos/cancellation: backend de Turnos no disponible:", (error as Error).message);
    return { ok: false, reason: "unavailable" };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    console.error("turnos/cancellation: respuesta no-JSON del backend de Turnos, status", response.status);
    return { ok: false, reason: "unexpected" };
  }

  if (
    response.ok &&
    typeof body === "object" &&
    body !== null &&
    "ok" in body &&
    (body as { ok: unknown }).ok === true
  ) {
    const alreadyCancelled = (body as { alreadyCancelled?: unknown }).alreadyCancelled === true;
    return { ok: true, alreadyCancelled };
  }

  const errorCode =
    typeof body === "object" && body !== null && "error" in body ? String((body as { error: unknown }).error) : null;

  if (response.status === 404 || errorCode === "not_found") {
    return { ok: false, reason: "not_found" };
  }
  if (response.status === 409 || errorCode === "invalid_state" || errorCode === "conflict") {
    return { ok: false, reason: "conflict" };
  }

  console.error("turnos/cancellation: respuesta inesperada del backend de Turnos", {
    status: response.status,
    body,
  });
  return { ok: false, reason: "unexpected" };
}
