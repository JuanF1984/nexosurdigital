// Friendly date/time formatting shared by server-rendered markup and the
// client-side ticking components. Internally we always keep the real ISO
// timestamp; these only affect what's displayed.
//
// Every wall-clock value is rendered in Argentina time, no matter where the
// code runs. The dashboard is server-rendered on Vercel, whose runtime zone
// is UTC: without an explicit `timeZone` the Intl formatters below would
// print timestamps ~3 h ahead of local time, and the "Hoy"/"Ayer" split
// would flip at UTC midnight instead of Buenos Aires midnight. The e-mail
// notifications (src/lib/mide/notifications.ts) already pin this same zone
// on their own formatter; that path is deliberately kept separate and is
// not touched here.

/** IANA zone for every wall-clock value shown in the MIDE dashboard. */
export const MIDE_TIME_ZONE = "America/Argentina/Buenos_Aires";

/** Wraps Date.now() so callers don't call it inline in component bodies. */
export function nowMs(): number {
  return Date.now();
}

const RELATIVE_DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, unit: "seconds" },
  { amount: 60, unit: "minutes" },
  { amount: 24, unit: "hours" },
  { amount: 7, unit: "days" },
];

const relativeFormatter = new Intl.RelativeTimeFormat("es-AR", { numeric: "auto" });

// Relative distance ("hace 5 minutos") is a pure difference of instants, so
// it needs no time zone — leaving it untouched.
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  let diffSeconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);

  if (Math.abs(diffSeconds) < 10) return "justo ahora";

  let unit: Intl.RelativeTimeFormatUnit = "seconds";
  for (const division of RELATIVE_DIVISIONS) {
    if (Math.abs(diffSeconds) < division.amount) {
      unit = division.unit;
      break;
    }
    diffSeconds = Math.round(diffSeconds / division.amount);
    unit = "days";
  }

  return relativeFormatter.format(diffSeconds, unit);
}

const timeFormatter = new Intl.DateTimeFormat("es-AR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: MIDE_TIME_ZONE,
});
const fullDateFormatter = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: MIDE_TIME_ZONE,
});

// "YYYY-MM-DD" for an instant as it falls in Argentina time. Comparing these
// keys is what makes "Hoy"/"Ayer" respect the Buenos Aires calendar day
// rather than the runtime's (UTC on the server).
const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: MIDE_TIME_ZONE,
});

function dayKeyInZone(date: Date): string {
  return dayKeyFormatter.format(date);
}

/** "Hoy, 14:32" / "Ayer, 09:10" / full date+time otherwise, all in AR time. */
export function formatFriendlyDateTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  // Argentina has no DST, so 24 h before `now` is always the previous
  // calendar day in this zone.
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const dayKey = dayKeyInZone(date);
  if (dayKey === dayKeyInZone(now)) return `Hoy, ${timeFormatter.format(date)}`;
  if (dayKey === dayKeyInZone(yesterday)) return `Ayer, ${timeFormatter.format(date)}`;
  return fullDateFormatter.format(date);
}
