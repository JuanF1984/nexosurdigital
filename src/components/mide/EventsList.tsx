import type { EventRecord } from "@/lib/mide/dashboard-data";
import { formatEventType, EVENT_SEVERITY_LABEL } from "@/lib/mide/status";
import { formatFriendlyDateTime } from "@/lib/mide/format";

const SEVERITY_DOT: Record<string, string> = {
  info: "bg-accent-blue",
  warning: "bg-mide-alert",
  critical: "bg-mide-offline",
};

export function EventsList({ events, unavailable }: { events: EventRecord[]; unavailable?: boolean }) {
  if (unavailable) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 px-5 py-6 text-center">
        <p className="text-sm text-text-dim">No se pudieron cargar los eventos en este momento.</p>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 px-5 py-8 text-center">
        <p className="text-sm text-text-secondary">Sin eventos registrados</p>
        <p className="mt-1 text-xs text-text-dim">
          Acá van a aparecer alarmas y avisos cuando el dispositivo empiece a reportarlos.
        </p>
      </div>
    );
  }

  return (
    <ul className="list-none">
      {events.map((event, i) => {
        const isOpen = event.status === "open";
        return (
          <li
            key={event.id}
            className={`flex items-start gap-3 py-3.5 ${i < events.length - 1 ? "border-b border-white/6" : ""}`}
          >
            <span
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[event.severity] ?? "bg-text-dim"}`}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium text-sm text-text-primary">
                  {formatEventType(event.type)}
                </span>
                <span className="text-xs text-text-dim">
                  {EVENT_SEVERITY_LABEL[event.severity] ?? event.severity}
                </span>
                <span
                  className={`text-[0.65rem] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                    isOpen ? "bg-mide-alert/10 text-mide-alert" : "bg-white/5 text-text-dim"
                  }`}
                >
                  {isOpen ? "Abierto" : "Cerrado"}
                </span>
              </div>
              <p className="text-xs text-text-dim mt-1 font-mono">
                {formatFriendlyDateTime(event.startedAt)}
                {event.endedAt ? ` → ${formatFriendlyDateTime(event.endedAt)}` : ""}
                {event.valueAtStart !== null ? ` · ${event.valueAtStart}°C` : ""}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
