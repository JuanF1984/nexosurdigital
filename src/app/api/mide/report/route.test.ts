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

function post(body: unknown) {
  const req = new Request("http://localhost/api/mide/report", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return POST(req as never);
}

const metric = (o: Record<string, unknown> = {}) => ({
  metric: "temperature",
  unit: "C",
  min: -18,
  max: -14,
  avg: -16,
  samples: 60,
  ...o,
});

const report = (o: Record<string, unknown> = {}) => ({
  deviceId: "mide-frio-001",
  firmwareVersion: "0.2.1-dev",
  periodStart: "2026-09-05T08:00:00-03:00",
  periodEnd: "2026-09-05T08:05:00-03:00",
  metrics: [metric()],
  ...o,
});

describe("POST /api/mide/report idempotency", () => {
  it("inserts one row for a fresh period", async () => {
    const res = await post(report());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, configVersion: 1 });
    expect(fake.measurements.size).toBe(1);
  });

  it("an identical retry of the same period does NOT add a second row", async () => {
    await post(report());
    await post(report());
    await post(report());
    expect(fake.measurements.size).toBe(1);
    const row = [...fake.measurements.values()][0];
    expect(row.sample_count).toBe(60);
  });

  it("a retry that merged a wider window replaces the row with the more complete one", async () => {
    await post(report());
    await post(
      report({
        periodEnd: "2026-09-05T08:10:00-03:00",
        metrics: [metric({ samples: 118, min: -19, max: -12, avg: -15.5 })],
      })
    );
    expect(fake.measurements.size).toBe(1);
    const row = [...fake.measurements.values()][0];
    expect(row.sample_count).toBe(118);
    expect(row.period_end).toBe("2026-09-05T08:10:00-03:00");
  });

  it("a stale narrower retry after the wide one is ignored (no data lost)", async () => {
    await post(
      report({
        periodEnd: "2026-09-05T08:10:00-03:00",
        metrics: [metric({ samples: 118 })],
      })
    );
    await post(report()); // narrower, samples 60
    expect(fake.measurements.size).toBe(1);
    expect([...fake.measurements.values()][0].sample_count).toBe(118);
  });

  it("different periods each get their own row", async () => {
    await post(report());
    await post(
      report({
        periodStart: "2026-09-05T08:05:00-03:00",
        periodEnd: "2026-09-05T08:10:00-03:00",
      })
    );
    expect(fake.measurements.size).toBe(2);
  });

  it("rejects the same metric twice in one report with 400", async () => {
    const res = await post(report({ metrics: [metric(), metric({ min: -19, avg: -17 })] }));
    expect(res.status).toBe(400);
  });

  it("rejects an unknown device with 404", async () => {
    const res = await post(report({ deviceId: "mide-frio-999" }));
    expect(res.status).toBe(404);
  });
});
