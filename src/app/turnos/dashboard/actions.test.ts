import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/turnos/auth", () => ({ requireTurnosUser: vi.fn() }));
vi.mock("@/lib/turnos/authorization", () => ({ getComerciosForUser: vi.fn() }));
vi.mock("@/lib/turnos/cancellation", () => ({
  getTurnoOwnership: vi.fn(),
  cancelTurnoRemote: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { requireTurnosUser } from "@/lib/turnos/auth";
import { getComerciosForUser } from "@/lib/turnos/authorization";
import { getTurnoOwnership, cancelTurnoRemote } from "@/lib/turnos/cancellation";
import { cancelReservationAction } from "./actions";

const mockUser = { id: "user-1", email: "equipo@nexosur.test" };
const comercioA = { comercioId: "comercio-a", comercioNombre: "Demo A" };
const comercioB = { comercioId: "comercio-b", comercioNombre: "Demo B" };

function asMock<T extends (...args: never[]) => unknown>(fn: T) {
  return fn as unknown as ReturnType<typeof vi.fn>;
}

describe("cancelReservationAction", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rechaza un turnoId vacío sin llamar a ninguna dependencia", async () => {
    const result = await cancelReservationAction("");

    expect(result).toEqual({ ok: false, message: "No pudimos cancelar la reserva. Intentá de nuevo en unos minutos." });
    expect(requireTurnosUser).not.toHaveBeenCalled();
  });

  it("propaga el fallo de autenticación sin capturarlo (usuario no autenticado)", async () => {
    class Redirect extends Error {}
    asMock(requireTurnosUser).mockRejectedValue(new Redirect("NEXT_REDIRECT"));

    await expect(cancelReservationAction("turno-1")).rejects.toThrow("NEXT_REDIRECT");
    expect(getComerciosForUser).not.toHaveBeenCalled();
  });

  it("usuario autenticado sin comercio autorizado devuelve error genérico", async () => {
    asMock(requireTurnosUser).mockResolvedValue(mockUser);
    asMock(getComerciosForUser).mockResolvedValue([]);

    const result = await cancelReservationAction("turno-1");

    expect(result.ok).toBe(false);
    expect(getTurnoOwnership).not.toHaveBeenCalled();
  });

  it("turno inexistente devuelve 'no encontramos esa reserva'", async () => {
    asMock(requireTurnosUser).mockResolvedValue(mockUser);
    asMock(getComerciosForUser).mockResolvedValue([comercioA]);
    asMock(getTurnoOwnership).mockResolvedValue(null);

    const result = await cancelReservationAction("no-existe");

    expect(result).toEqual({ ok: false, message: "No encontramos esa reserva." });
    expect(cancelTurnoRemote).not.toHaveBeenCalled();
  });

  it("turno de un comercio ajeno al usuario nunca llega al backend, y el mensaje no distingue el motivo", async () => {
    asMock(requireTurnosUser).mockResolvedValue(mockUser);
    asMock(getComerciosForUser).mockResolvedValue([comercioA]); // el usuario solo tiene A
    asMock(getTurnoOwnership).mockResolvedValue({ id: "turno-1", comercioId: "comercio-b", estado: "confirmado" }); // el turno es de B

    const result = await cancelReservationAction("turno-1");

    expect(result).toEqual({ ok: false, message: "No encontramos esa reserva." });
    expect(cancelTurnoRemote).not.toHaveBeenCalled();
  });

  it("cancelación válida: llama al backend con el comercioId resuelto server-side y revalida la ruta", async () => {
    asMock(requireTurnosUser).mockResolvedValue(mockUser);
    asMock(getComerciosForUser).mockResolvedValue([comercioA, comercioB]);
    asMock(getTurnoOwnership).mockResolvedValue({ id: "turno-1", comercioId: "comercio-b", estado: "confirmado" });
    asMock(cancelTurnoRemote).mockResolvedValue({ ok: true, alreadyCancelled: false });

    const result = await cancelReservationAction("turno-1");

    expect(result).toEqual({ ok: true, alreadyCancelled: false });
    expect(cancelTurnoRemote).toHaveBeenCalledWith({ comercioId: "comercio-b", turnoId: "turno-1" });
    expect(revalidatePath).toHaveBeenCalledWith("/turnos/dashboard");
  });

  it("turno ya cancelado (respuesta idempotente del backend) no es un error", async () => {
    asMock(requireTurnosUser).mockResolvedValue(mockUser);
    asMock(getComerciosForUser).mockResolvedValue([comercioA]);
    asMock(getTurnoOwnership).mockResolvedValue({ id: "turno-1", comercioId: "comercio-a", estado: "cancelado" });
    asMock(cancelTurnoRemote).mockResolvedValue({ ok: true, alreadyCancelled: true });

    const result = await cancelReservationAction("turno-1");

    expect(result).toEqual({ ok: true, alreadyCancelled: true });
  });

  it("doble intento de cancelación: la segunda llamada sigue siendo ok (idempotente), no rompe", async () => {
    asMock(requireTurnosUser).mockResolvedValue(mockUser);
    asMock(getComerciosForUser).mockResolvedValue([comercioA]);
    asMock(getTurnoOwnership).mockResolvedValue({ id: "turno-1", comercioId: "comercio-a", estado: "confirmado" });
    asMock(cancelTurnoRemote)
      .mockResolvedValueOnce({ ok: true, alreadyCancelled: false })
      .mockResolvedValueOnce({ ok: true, alreadyCancelled: true });

    const first = await cancelReservationAction("turno-1");
    const second = await cancelReservationAction("turno-1");

    expect(first).toEqual({ ok: true, alreadyCancelled: false });
    expect(second).toEqual({ ok: true, alreadyCancelled: true });
  });

  it("backend de Turnos no disponible devuelve error genérico, sin exponer el detalle", async () => {
    asMock(requireTurnosUser).mockResolvedValue(mockUser);
    asMock(getComerciosForUser).mockResolvedValue([comercioA]);
    asMock(getTurnoOwnership).mockResolvedValue({ id: "turno-1", comercioId: "comercio-a", estado: "confirmado" });
    asMock(cancelTurnoRemote).mockResolvedValue({ ok: false, reason: "unavailable" });

    const result = await cancelReservationAction("turno-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toMatch(/token|bearer|stack|TURNOS_API/i);
    }
  });

  it("respuesta inesperada del backend devuelve error genérico", async () => {
    asMock(requireTurnosUser).mockResolvedValue(mockUser);
    asMock(getComerciosForUser).mockResolvedValue([comercioA]);
    asMock(getTurnoOwnership).mockResolvedValue({ id: "turno-1", comercioId: "comercio-a", estado: "confirmado" });
    asMock(cancelTurnoRemote).mockResolvedValue({ ok: false, reason: "unexpected" });

    const result = await cancelReservationAction("turno-1");

    expect(result.ok).toBe(false);
  });

  it("configuración faltante (TURNOS_API_URL/TOKEN) devuelve error genérico, no un 500 crudo", async () => {
    asMock(requireTurnosUser).mockResolvedValue(mockUser);
    asMock(getComerciosForUser).mockResolvedValue([comercioA]);
    asMock(getTurnoOwnership).mockResolvedValue({ id: "turno-1", comercioId: "comercio-a", estado: "confirmado" });
    asMock(cancelTurnoRemote).mockResolvedValue({ ok: false, reason: "config" });

    const result = await cancelReservationAction("turno-1");

    expect(result).toEqual({ ok: false, message: "No pudimos cancelar la reserva. Intentá de nuevo en unos minutos." });
  });

  it("conflicto de estado en el backend se informa sin ser un error genérico", async () => {
    asMock(requireTurnosUser).mockResolvedValue(mockUser);
    asMock(getComerciosForUser).mockResolvedValue([comercioA]);
    asMock(getTurnoOwnership).mockResolvedValue({ id: "turno-1", comercioId: "comercio-a", estado: "confirmado" });
    asMock(cancelTurnoRemote).mockResolvedValue({ ok: false, reason: "conflict" });

    const result = await cancelReservationAction("turno-1");

    expect(result).toEqual({ ok: false, message: "Esa reserva ya no se puede cancelar." });
  });
});
