import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { FakeSupabase } from "@/test/fake-supabase";

vi.mock("@/lib/mide/supabase", () => ({
  getMideSupabaseClient: vi.fn(),
}));

// Mock the Resend SDK so no real e-mail is ever sent. The send fn is
// reconfigurable per test (see the "provider failure" case). `vi.hoisted`
// makes it available inside the hoisted `vi.mock` factory.
const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock("resend", () => ({
  // Route does `new Resend(key)`, so the mock must be constructible.
  Resend: class {
    emails = { send: sendMock };
  },
}));

import { getMideSupabaseClient } from "@/lib/mide/supabase";
import { POST } from "./route";

const API_KEY = "test-mide-key-0001";
let fake: FakeSupabase;

const EMAIL_ENV = {
  MIDE_RESEND_API_KEY: "re_fake_key",
  MIDE_ALERT_EMAIL_FROM: "alertas@mide.test",
  MIDE_ALERT_EMAIL_TO: "uno@dest.test, dos@dest.test",
};

beforeAll(() => {
  process.env.SUPABASE_URL = "http://fake.local";
  process.env.SUPABASE_SECRET_KEY = "fake-secret";
  process.env.MIDE_DEVICE_API_KEY = API_KEY;
  Object.assign(process.env, EMAIL_ENV);
});

afterAll(() => {
  for (const key of Object.keys(EMAIL_ENV)) delete process.env[key];
});

beforeEach(() => {
  fake = new FakeSupabase(
    [{ id: "dev-uuid-1", device_code: "mide-frio-001", active: true }],
    [{ device_id: "dev-uuid-1", max_threshold: -15 }]
  );
  vi.mocked(getMideSupabaseClient).mockReturnValue(fake as never);
  sendMock.mockClear();
  sendMock.mockImplementation(async () => ({ data: { id: "email-fake-1" }, error: null }));
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

// An "open" as the firmware actually sends it once the alarm engine fires:
// severity + metadata.reason present.
const alertOpen = (o: Record<string, unknown> = {}) =>
  openEvent({
    metadata: { reason: "GRAVEDAD", band: 2, trend: "ASCENDIENDO" },
    ...o,
  });

const closeEvent = (o: Record<string, unknown> = {}) =>
  alertOpen({
    endedAt: "2026-09-05T08:42:00-03:00",
    peakValue: -7.9,
    metadata: { reason: "GRAVEDAD", durationMs: 1_480_000 },
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

describe("POST /api/mide/event — e-mail notifications", () => {
  it("1. a new alert persists the event and sends exactly one e-mail", async () => {
    const res = await post(alertOpen());
    expect(res.status).toBe(200);
    expect(fake.events.size).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(1);

    const sent = sendMock.mock.calls[0][0] as {
      subject: string;
      to: string[];
      text: string;
    };
    expect(sent.subject).toContain("Alerta de temperatura");
    expect(sent.to).toEqual(["uno@dest.test", "dos@dest.test"]);
    // threshold from device_config and the deviation are in the body
    expect(sent.text).toContain("-15.0 °C");
    expect([...fake.events.values()][0].alert_notified_at).not.toBeNull();
  });

  it("2. retrying the same alert does not send a second e-mail", async () => {
    await post(alertOpen());
    await post(alertOpen());
    await post(alertOpen());
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(fake.events.size).toBe(1);
  });

  it("3. a new recovery updates the row and sends a recovery e-mail", async () => {
    await post(alertOpen());
    sendMock.mockClear();

    const res = await post(closeEvent());
    expect(res.status).toBe(200);
    expect((await res.json())).toMatchObject({ ok: true, resolved: true });
    expect(sendMock).toHaveBeenCalledTimes(1);

    const sent = sendMock.mock.calls[0][0] as { subject: string; text: string };
    expect(sent.subject).toContain("Temperatura normalizada");
    expect(sent.text).toContain("-7.9 °C");
    const row = [...fake.events.values()][0];
    expect(row.recovery_notified_at).not.toBeNull();
  });

  it("4. retrying the same recovery does not send a second recovery e-mail", async () => {
    await post(alertOpen());
    await post(closeEvent());
    sendMock.mockClear();

    await post(closeEvent());
    await post(closeEvent());
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("5. an open with no alarm reason (observation only) sends no e-mail", async () => {
    const res = await post(openEvent()); // no metadata.reason
    expect(res.status).toBe(200);
    expect(fake.events.size).toBe(1);
    expect(sendMock).not.toHaveBeenCalled();

    // also: a reason the engine never escalates on
    await post(openEvent({ eventId: "mide-frio-001-h900000002", metadata: { reason: "NINGUNO" } }));
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("6. an e-mail provider failure still persists the event and is logged safely", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    sendMock.mockImplementation(async () => ({ data: null, error: { message: "boom" } }));

    const res = await post(alertOpen());
    expect(res.status).toBe(200);
    expect((await res.json())).toMatchObject({ ok: true, duplicate: false });
    expect(fake.events.size).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
    // send failed while alive -> the lease was released, nothing confirmed
    const row = [...fake.events.values()][0];
    expect(row.alert_notified_at).toBeNull();
    expect(row.alert_notify_claimed_at).toBeNull();

    sendMock.mockImplementation(async () => ({ data: { id: "email-fake-2" }, error: null }));
    await post(alertOpen());
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect([...fake.events.values()][0].alert_notified_at).not.toBeNull();

    errorSpy.mockRestore();
  });

  it("8. a claim abandoned by a crashed worker is retried after the lease, but a concurrent retry within the lease does not double-send", async () => {
    // First POST goes through: claim -> send -> confirm.
    await post(alertOpen());
    expect(sendMock).toHaveBeenCalledTimes(1);
    const row = [...fake.events.values()][0];

    // Model a hard crash: the worker had claimed the notification and the
    // provider *may or may not* have received it, but the process died before
    // mide_confirm_event_notification ran. So: lease held, nothing confirmed.
    row.alert_notified_at = null;
    row.alert_notify_claimed_at = new Date().toISOString();
    sendMock.mockClear();

    // Concurrency: a firmware retry arrives while the lease is still alive.
    // The claim must be refused so only the (dead) original worker "owns" it.
    await post(alertOpen());
    expect(sendMock).not.toHaveBeenCalled();
    expect(row.alert_notified_at).toBeNull();

    // The crashed worker never comes back; the lease expires.
    fake.abandonClaims();

    // Next retry reclaims and actually sends (at-least-once: we could not know
    // the crashed attempt reached the provider).
    await post(alertOpen());
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(row.alert_notified_at).not.toBeNull();
    expect(row.alert_notify_claimed_at).toBeNull();

    // And now it is permanently sent: further retries do nothing.
    sendMock.mockClear();
    await post(alertOpen());
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("7. with no e-mail config the event is persisted and nothing is sent", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const saved = {
      MIDE_RESEND_API_KEY: process.env.MIDE_RESEND_API_KEY,
      MIDE_ALERT_EMAIL_FROM: process.env.MIDE_ALERT_EMAIL_FROM,
      MIDE_ALERT_EMAIL_TO: process.env.MIDE_ALERT_EMAIL_TO,
    };
    delete process.env.MIDE_RESEND_API_KEY;
    delete process.env.MIDE_ALERT_EMAIL_FROM;
    delete process.env.MIDE_ALERT_EMAIL_TO;

    try {
      const res = await post(alertOpen());
      expect(res.status).toBe(200);
      expect(fake.events.size).toBe(1);
      expect(sendMock).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
      // no claim was attempted, so the column stays null
      expect([...fake.events.values()][0].alert_notified_at).toBeNull();
    } finally {
      Object.assign(process.env, saved);
      warnSpy.mockRestore();
    }
  });
});
