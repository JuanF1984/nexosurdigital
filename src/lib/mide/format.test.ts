import { describe, it, expect } from "vitest";
import { formatFriendlyDateTime, formatRelativeTime } from "@/lib/mide/format";

// These assert the *displayed* wall clock is Argentina time regardless of
// the runtime zone. The previous bug was that the dashboard formatters had
// no explicit timeZone, so on Vercel (UTC) they printed timestamps ~3 h
// ahead of local time. Only the zone is under test here — the locale-driven
// clock format ("es-AR") is intentionally left exactly as it was and as the
// e-mail path renders it.

describe("formatFriendlyDateTime", () => {
  it("renders the time in America/Argentina/Buenos_Aires (UTC-3), not UTC", () => {
    // 2026-09-06T11:32:00Z === 08:32 in Buenos Aires (would be 11:32 in UTC).
    const now = new Date("2026-09-06T12:00:00Z");
    expect(formatFriendlyDateTime("2026-09-06T11:32:00Z", now)).toMatch(/^Hoy, 08:32/);
  });

  it("accepts an ISO string with an explicit offset and still shows AR time", () => {
    const now = new Date("2026-09-06T12:00:00Z");
    expect(formatFriendlyDateTime("2026-09-06T08:17:32-03:00", now)).toMatch(/^Hoy, 08:17/);
  });

  it("splits Hoy/Ayer on the Buenos Aires calendar day, not the UTC one", () => {
    // now: 2026-09-06 21:30 AR (2026-09-07 00:30 UTC).
    const now = new Date("2026-09-07T00:30:00Z");
    // instant: 2026-09-06 23:00 AR (2026-09-07 02:00 UTC) -> still the same AR day.
    expect(formatFriendlyDateTime("2026-09-07T02:00:00Z", now)).toMatch(/^Hoy,/);
    // instant: 2026-09-05 23:00 AR -> previous AR day (in UTC it is 2026-09-06, i.e. "today").
    expect(formatFriendlyDateTime("2026-09-06T02:00:00Z", now)).toMatch(/^Ayer,/);
  });

  it("falls back to a full AR date+time for older instants", () => {
    const now = new Date("2026-09-06T12:00:00Z");
    // 2026-09-01T00:30:00Z === 2026-08-31 21:30 in Buenos Aires.
    expect(formatFriendlyDateTime("2026-09-01T00:30:00Z", now)).toMatch(/^31\/08\/2026,/);
  });
});

describe("formatRelativeTime", () => {
  it("is a pure instant difference, unaffected by time zone", () => {
    const now = new Date("2026-09-06T12:00:00Z");
    expect(formatRelativeTime("2026-09-06T11:55:00Z", now)).toBe("hace 5 minutos");
  });
});
