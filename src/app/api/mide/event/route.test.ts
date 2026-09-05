import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { FakeSupabase } from "@/test/fake-supabase";

vi.mock("@/lib/mide/supabase", () => ({
  getMideSupabaseClient: vi.fn(),
}));

import { getMideSupabaseClient } from "@/lib/mide/supabase";
import { POST } from "./route";

const API_KEY = "test-mide-key-0001";
let fake: FakeSupabase;

beforeAll(() => {
  process.env.SUPABASE_URL = "http://fake.local";
  process.env.SUPABASE_SECRET_KEY = "fake-secret";
  process.env.MIDE_DEVICE_API_KEY = API_KEY;
});

beforeEach(() => {
  fake = new FakeSupabase([{ id: "dev-uuid-1", device_code: "mide-frio-001", active: true }]);
  vi.mocked(getMideSupabaseClient).mockReturnValue(fake as never);
});

function post(body: unknown, { auth = true }: { auth?: boolean } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) headers.authorization = `Bearer ${API_KEY}`;
  const req = new Request("http://localhost/api/mide/event", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return POST(req as never);
}

const openEvent = (o: Record<string, unknown> = {}) => ({
  deviceId: "mide-frio-001",
  eventId: "mide-frio-001-h900000001",
  type: "TEMP_HIGH",
  severity: "critical",
  startedAt: "2026-09-05T08:17:32-03:00",
  value: -9.8,
  ...o,
});

describe("POST /api/mide/event", () => {
  it("creates a new open event -> duplicate:false, one row, status open", async () => {
    const res = await post(openEvent());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, duplicate: false });
    expect(fake.events.size).toBe(1);
    expect([...fake.events.values()][0].status).toBe("open");
  });

  it("is idempotent: the same open eventId again -> duplicate:true, still one row", async () => {
    await post(openEvent());
    const res = await post(openEvent());
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, duplicate: true });
    expect(fake.events.size).toBe(1);
  });

  it("close with the same eventId resolves the SAME row and sets ended_at/peak_value", async () => {
    await post(openEvent());
    const res = await post(
      openEvent({ endedAt: "2026-09-05T08:42:00-03:00", peakValue: -7.9 })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, resolved: true, created: false });
    expect(fake.events.size).toBe(1);
    const row = [...fake.events.values()][0];
    expect(row.status).toBe("resolved");
    expect(row.ended_at).toBe("2026-09-05T08:42:00-03:00");
    expect(row.peak_value).toBe(-7.9);
  });

  it("a repeated close is idempotent (still one resolved row)", async () => {
    await post(openEvent());
    await post(openEvent({ endedAt: "2026-09-05T08:42:00-03:00", peakValue: -7.9 }));
    const res = await post(openEvent({ endedAt: "2026-09-05T08:42:00-03:00", peakValue: -7.9 }));
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, resolved: true });
    expect(fake.events.size).toBe(1);
    expect([...fake.events.values()][0].status).toBe("resolved");
  });

  it("close arriving before open creates the row already resolved", async () => {
    const res = await post(
      openEvent({ endedAt: "2026-09-05T08:42:00-03:00", peakValue: -7.9 })
    );
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, resolved: true, created: true });
    expect(fake.events.size).toBe(1);
    expect([...fake.events.values()][0].status).toBe("resolved");
  });

  it("merges metadata across the open and close POSTs", async () => {
    await post(openEvent({ metadata: { reason: "GRAVEDAD", band: 2, trend: "ASCENDIENDO" } }));
    await post(
      openEvent({
        endedAt: "2026-09-05T08:42:00-03:00",
        peakValue: -7.9,
        metadata: { maxDeviationC: 7.1, durationMs: 1500000 },
      })
    );
    const row = [...fake.events.values()][0];
    expect(row.metadata).toMatchObject({
      reason: "GRAVEDAD",
      band: 2,
      trend: "ASCENDIENDO",
      maxDeviationC: 7.1,
      durationMs: 1500000,
    });
  });

  it("rejects an unknown field with 400 (strict contract preserved)", async () => {
    const res = await post(openEvent({ bogus: 1 }));
    expect(res.status).toBe(400);
  });

  it("rejects an unknown device with 404", async () => {
    const res = await post(openEvent({ deviceId: "mide-frio-999" }));
    expect(res.status).toBe(404);
    expect(fake.events.size).toBe(0);
  });

  it("rejects a missing Authorization header with 401", async () => {
    const res = await post(openEvent(), { auth: false });
    expect(res.status).toBe(401);
  });

  it("rejects a non-JSON content type with 415", async () => {
    const req = new Request("http://localhost/api/mide/event", {
      method: "POST",
      headers: { "content-type": "text/plain", authorization: `Bearer ${API_KEY}` },
      body: "hi",
    });
    const res = await POST(req as never);
    expect(res.status).toBe(415);
  });
});
