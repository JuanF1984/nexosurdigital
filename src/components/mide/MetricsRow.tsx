import type { SummaryStats } from "@/lib/mide/measurements";

export function MetricsRow({ stats }: { stats: SummaryStats | null }) {
  if (!stats) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 px-5 py-6 text-center">
        <p className="text-sm text-text-dim">
          Todavía no hay mediciones en las últimas 24 horas para calcular estos valores.
        </p>
      </div>
    );
  }

  const items = [
    { label: "Mínima", value: `${stats.min.toFixed(1)}°C` },
    { label: "Promedio", value: `${stats.avg.toFixed(1)}°C` },
    { label: "Máxima", value: `${stats.max.toFixed(1)}°C` },
    { label: "Muestras", value: stats.totalSamples.toLocaleString("es-AR") },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-2xl overflow-hidden border border-white/5 bg-white/5">
      {items.map((item) => (
        <div key={item.label} className="bg-card px-5 py-4">
          <p className="text-xs uppercase tracking-[0.15em] text-text-dim mb-1.5">{item.label}</p>
          <p className="font-mono text-xl sm:text-2xl text-text-primary tabular-nums">{item.value}</p>
        </div>
      ))}
    </div>
  );
}
