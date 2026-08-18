// Friendly date/time formatting shared by server-rendered markup and the
// client-side ticking components. Internally we always keep the real ISO
// timestamp; these only affect what's displayed.

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

const timeFormatter = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" });
const fullDateFormatter = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "Hoy, 14:32" / "Ayer, 09:10" / full date+time otherwise. */
export function formatFriendlyDateTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (isSameDay(date, now)) return `Hoy, ${timeFormatter.format(date)}`;
  if (isSameDay(date, yesterday)) return `Ayer, ${timeFormatter.format(date)}`;
  return fullDateFormatter.format(date);
}
