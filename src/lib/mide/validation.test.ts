import { describe, it, expect } from "vitest";
import { validateReportPayload, validateEventPayload } from "@/lib/mide/validation";

const validMetric = (o: Record<string, unknown> = {}) => ({
  metric: "temperature",
  unit: "C",
  min: -18,
  max: -14,
  avg: -16,
  samples: 60,
  ...o,
});

const validReport = (o: Record<string, unknown> = {}) => ({
  deviceId: "mide-frio-001",
  firmwareVersion: "0.2.1-dev",
  periodStart: "2026-09-05T08:00:00-03:00",
  periodEnd: "2026-09-05T08:05:00-03:00",
  metrics: [validMetric()],
  ...o,
});

const validEvent = (o: Record<string, unknown> = {}) => ({
  deviceId: "mide-frio-001",
  eventId: "mide-frio-001-h812345678",
  type: "TEMP_HIGH",
  severity: "critical",
  startedAt: "2026-09-05T08:17:32-03:00",
  value: -9.8,
  ...o,
});

describe("validateReportPayload", () => {
  it("accepts a well-formed report", () => {
    const r = validateReportPayload(validReport());
    expect(r.ok).toBe(true);
  });

  it("rejects unknown top-level fields", () => {
    const r = validateReportPayload(validReport({ extra: 1 }));
    expect(r.ok).toBe(false);
  });

  it("rejects an inverted period", () => {
    const r = validateReportPayload(
      validReport({ periodStart: "2026-09-05T08:05:00-03:00", periodEnd: "2026-09-05T08:00:00-03:00" })
    );
    expect(r.ok).toBe(false);
  });

  it("rejects min > avg", () => {
    const r = validateReportPayload(validReport({ metrics: [validMetric({ min: -10, avg: -16 })] }));
    expect(r.ok).toBe(false);
  });

  it("rejects samples <= 0", () => {
    const r = validateReportPayload(validReport({ metrics: [validMetric({ samples: 0 })] }));
    expect(r.ok).toBe(false);
  });

  it("rejects the same metric name twice in one report", () => {
    const r = validateReportPayload(
      validReport({ metrics: [validMetric(), validMetric({ min: -19, avg: -17 })] })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/repetido/);
  });

  it("still accepts two different metrics in one report", () => {
    const r = validateReportPayload(
      validReport({
        metrics: [validMetric(), validMetric({ metric: "humidity", unit: "%", min: 40, max: 55, avg: 47 })],
      })
    );
    expect(r.ok).toBe(true);
  });
});

describe("validateEventPayload", () => {
  it("accepts the legacy 6-field open event unchanged", () => {
    const r = validateEventPayload(validEvent());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.endedAt).toBeNull();
      expect(r.value.peakValue).toBeNull();
      expect(r.value.metadata).toBeNull();
    }
  });

  it("rejects unknown fields (strict contract preserved)", () => {
    const r = validateEventPayload(validEvent({ foo: "bar" }));
    expect(r.ok).toBe(false);
  });

  it("accepts a close event with endedAt + peakValue", () => {
    const r = validateEventPayload(
      validEvent({ endedAt: "2026-09-05T08:42:00-03:00", peakValue: -8.1 })
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.endedAt).toBe("2026-09-05T08:42:00-03:00");
      expect(r.value.peakValue).toBe(-8.1);
    }
  });

  it("rejects endedAt earlier than startedAt", () => {
    const r = validateEventPayload(validEvent({ endedAt: "2026-09-05T08:00:00-03:00" }));
    expect(r.ok).toBe(false);
  });

  it("rejects a non-ISO endedAt", () => {
    const r = validateEventPayload(validEvent({ endedAt: "2026-09-05 08:42:00" }));
    expect(r.ok).toBe(false);
  });

  it("accepts flat scalar metadata", () => {
    const r = validateEventPayload(
      validEvent({
        metadata: {
          band: 2,
          maxDeviationC: 6.9,
          trend: "ASCENDIENDO",
          reason: "GRAVEDAD",
          timeOutOfRangeMs: 120000,
        },
      })
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.metadata?.reason).toBe("GRAVEDAD");
  });

  it("rejects nested metadata", () => {
    const r = validateEventPayload(validEvent({ metadata: { nested: { a: 1 } } }));
    expect(r.ok).toBe(false);
  });

  it("rejects an array as metadata", () => {
    const r = validateEventPayload(validEvent({ metadata: [1, 2, 3] }));
    expect(r.ok).toBe(false);
  });

  it("rejects an invalid severity", () => {
    const r = validateEventPayload(validEvent({ severity: "urgent" }));
    expect(r.ok).toBe(false);
  });

  it("rejects a lowercase type", () => {
    const r = validateEventPayload(validEvent({ type: "temp_high" }));
    expect(r.ok).toBe(false);
  });
});
