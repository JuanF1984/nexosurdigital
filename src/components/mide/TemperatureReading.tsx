import { StatusBadge } from "@/components/mide/StatusBadge";
import { LiveRelativeTime } from "@/components/mide/LiveRelativeTime";
import { STATUS_DESCRIPTION, type DeviceStatus } from "@/lib/mide/status";

export function TemperatureReading({
  deviceName,
  deviceCode,
  location,
  firmwareVersion,
  status,
  latestAvg,
  lastSeenAt,
}: {
  deviceName: string;
  deviceCode: string;
  location: string | null;
  firmwareVersion: string | null;
  status: DeviceStatus;
  latestAvg: number | null;
  lastSeenAt: string | null;
}) {
  const tempDisplay = latestAvg !== null ? latestAvg.toFixed(1) : "—";

  return (
    <section className="rounded-3xl border border-white/5 bg-card px-6 py-8 sm:px-10 sm:py-10">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
        <div>
          <p className="font-body text-xs uppercase tracking-[0.2em] text-text-dim mb-1.5">
            MIDE Frío &middot; Prototipo
          </p>
          <h1 className="font-display text-3xl sm:text-4xl leading-tight">{deviceName}</h1>
          <p className="text-text-secondary text-sm mt-1 font-mono">
            {deviceCode}
            {location ? ` · ${location}` : ""}
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="flex items-end gap-2">
        <span className="font-mono text-[clamp(3.5rem,12vw,6rem)] leading-none font-semibold text-text-primary tabular-nums">
          {tempDisplay}
        </span>
        <span className="font-mono text-2xl text-text-secondary mb-2 sm:mb-3">°C</span>
      </div>

      <p className="text-text-secondary text-sm mt-3 max-w-md">{STATUS_DESCRIPTION[status]}</p>

      <div className="mt-6 pt-6 border-t border-white/6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-text-secondary">
        {lastSeenAt ? (
          <span>
            Última conexión:{" "}
            <LiveRelativeTime
              iso={lastSeenAt}
              className="text-text-primary font-medium font-mono"
            />
          </span>
        ) : (
          <span>El dispositivo todavía no reportó ninguna conexión.</span>
        )}
        {firmwareVersion && <span className="font-mono text-text-dim">firmware {firmwareVersion}</span>}
      </div>
    </section>
  );
}
