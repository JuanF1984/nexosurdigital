import type { DeviceStatus } from "@/lib/mide/status";
import { STATUS_LABEL } from "@/lib/mide/status";

// Each status is carried by icon + label + color together — never color
// alone — so it stays legible for colorblind users and in quick glances.

const STATUS_STYLES: Record<DeviceStatus, { bg: string; text: string; border: string }> = {
  normal: {
    bg: "bg-accent-green/10",
    text: "text-accent-green",
    border: "border-accent-green/25",
  },
  alerta: {
    bg: "bg-mide-alert/10",
    text: "text-mide-alert",
    border: "border-mide-alert/30",
  },
  sin_datos: {
    bg: "bg-white/5",
    text: "text-text-dim",
    border: "border-white/10",
  },
  sin_conexion: {
    bg: "bg-mide-offline/10",
    text: "text-mide-offline",
    border: "border-mide-offline/30",
  },
};

function StatusIcon({ status }: { status: DeviceStatus }) {
  const common = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none" as const };

  switch (status) {
    case "normal":
      return (
        <svg {...common} stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12.5l5 5L20 6.5" />
        </svg>
      );
    case "alerta":
      return (
        <svg {...common} stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3.5l9.5 16.5H2.5L12 3.5z" />
          <path d="M12 10v4.5" />
          <circle cx="12" cy="17.3" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );
    case "sin_conexion":
      return (
        <svg {...common} stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3l18 18" />
          <path d="M8.5 8.8C5.8 9.9 3.8 11.6 2.5 13.2" />
          <path d="M21.5 13.2c-1-1.2-2.3-2.4-3.9-3.4" />
          <path d="M6.2 16.3a10.6 10.6 0 013.2-2.4" />
          <path d="M17.8 16.3a10.6 10.6 0 00-2.4-2" />
          <circle cx="12" cy="19.5" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "sin_datos":
    default:
      return (
        <svg {...common} stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeDasharray="3 3">
          <circle cx="12" cy="12" r="8.5" />
        </svg>
      );
  }
}

export function StatusBadge({ status, className = "" }: { status: DeviceStatus; className?: string }) {
  const style = STATUS_STYLES[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide uppercase ${style.bg} ${style.text} ${style.border} ${className}`}
    >
      <StatusIcon status={status} />
      {STATUS_LABEL[status]}
    </span>
  );
}
