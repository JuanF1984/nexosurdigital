import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/turnos/supabase", () => ({
  getTurnosSupabaseClient: vi.fn(),
}));

import { getTurnosSupabaseClient } from "@/lib/turnos/supabase";
import { cancelTurnoRemote, getTurnoOwnership } from "@/lib/turnos/cancellation";

const ORIGINAL_ENV = { ...process.env };

function mockSupabaseTurnoRow(row: unknown, error: { message: string } | null = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  (getTurnosSupabaseClient as ReturnType<typeof vi.fn>).mockReturnValue({ from });
  return { from, select, eq, maybeSingle };
}

describe("getTurnoOwnership", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("devuelve comercioId y estado cuando el turno existe", async () => {
    mockSupabaseTurnoRow({ id: "turno-1", comercio_id: "comercio-a", estado: "confirmado" });

    const result = await getTurnoOwnership("turno-1");

    expect(result).toEqual({ id: "turno-1", comercioId: "comercio-a", estado: "confirmado" });
  });

  it("devuelve null si el turno no existe", async () => {
    mockSupabaseTurnoRow(null);

    const result = await getTurnoOwnership("no-existe");

    expect(result).toBeNull();
  });

  it("devuelve null si la consulta falla, sin lanzar", async () => {
    mockSupabaseTurnoRow(null, { message: "permission denied" });

    const result = await getTurnoOwnership("turno-1");

    expect(result).toBeNull();
  });
});

describe("cancelTurnoRemote", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, TURNOS_API_URL: "https://turnos.example.com", TURNOS_API_TOKEN: "secret-token" };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("devuelve config si falta TURNOS_API_URL o TURNOS_API_TOKEN", async () => {
    process.env.TURNOS_API_URL = "";
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await cancelTurnoRemote({ comercioId: "c1", turnoId: "t1" });

    expect(result).toEqual({ ok: false, reason: "config" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("llama al backend con el token compartido y devuelve ok cuando cancela", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, turno: { id: "t1", estado: "cancelado" } }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await cancelTurnoRemote({ comercioId: "c1", turnoId: "t1" });

    expect(result).toEqual({ ok: true, alreadyCancelled: false });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("https://turnos.example.com/api/turnos/cancelar");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer secret-token");
    expect(JSON.parse(init.body)).toEqual({ comercioId: "c1", turnoId: "t1" });
  });

  it("propaga alreadyCancelled cuando el backend responde idempotente", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, alreadyCancelled: true, turno: { id: "t1", estado: "cancelado" } }),
    }) as unknown as typeof fetch;

    const result = await cancelTurnoRemote({ comercioId: "c1", turnoId: "t1" });

    expect(result).toEqual({ ok: true, alreadyCancelled: true });
  });

  it("mapea 404 / not_found a reason not_found", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ ok: false, error: "not_found" }),
    }) as unknown as typeof fetch;

    const result = await cancelTurnoRemote({ comercioId: "c1", turnoId: "ajeno" });

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("mapea 409 / conflict a reason conflict", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ ok: false, error: "conflict" }),
    }) as unknown as typeof fetch;

    const result = await cancelTurnoRemote({ comercioId: "c1", turnoId: "t1" });

    expect(result).toEqual({ ok: false, reason: "conflict" });
  });

  it("devuelve unavailable si el fetch rechaza (backend caído)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("fetch failed")) as unknown as typeof fetch;

    const result = await cancelTurnoRemote({ comercioId: "c1", turnoId: "t1" });

    expect(result).toEqual({ ok: false, reason: "unavailable" });
  });

  it("devuelve unexpected si la respuesta no es JSON válido", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    }) as unknown as typeof fetch;

    const result = await cancelTurnoRemote({ comercioId: "c1", turnoId: "t1" });

    expect(result).toEqual({ ok: false, reason: "unexpected" });
  });

  it("devuelve unexpected ante un status/código no contemplado", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ ok: false, error: "internal_error" }),
    }) as unknown as typeof fetch;

    const result = await cancelTurnoRemote({ comercioId: "c1", turnoId: "t1" });

    expect(result).toEqual({ ok: false, reason: "unexpected" });
  });
});
