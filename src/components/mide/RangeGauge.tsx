export function RangeGauge({
  minThreshold,
  maxThreshold,
  currentValue,
}: {
  minThreshold: number | null;
  maxThreshold: number | null;
  currentValue: number | null;
}) {
  if (minThreshold === null || maxThreshold === null) {
    return (
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-text-dim mb-3">Rango configurado</p>
        <p className="text-sm text-text-dim">Este dispositivo todavía no tiene un rango configurado.</p>
      </div>
    );
  }

  const span = Math.max(maxThreshold - minThreshold, 0.1);
  const padding = span * 0.3;
  const domainMin = minThreshold - padding;
  const domainMax = maxThreshold + padding;

  const toPct = (value: number) =>
    Math.min(100, Math.max(0, ((value - domainMin) / (domainMax - domainMin)) * 100));

  const minPct = toPct(minThreshold);
  const maxPct = toPct(maxThreshold);
  const valuePct = currentValue !== null ? toPct(currentValue) : null;
  const outOfRange =
    currentValue !== null && (currentValue < minThreshold || currentValue > maxThreshold);

  return (
    <div>
      <p className="text-xs uppercase tracking-[0.2em] text-text-dim mb-4">Rango configurado</p>

      <div className="relative h-2 rounded-full bg-white/8">
        <div
          className="absolute h-2 rounded-full bg-accent-green/30"
          style={{ left: `${minPct}%`, width: `${Math.max(maxPct - minPct, 1)}%` }}
        />
        {valuePct !== null && (
          <div
            className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-card ${
              outOfRange ? "bg-mide-alert" : "bg-accent-green"
            }`}
            style={{ left: `${valuePct}%` }}
            aria-hidden
          />
        )}
      </div>

      <div className="mt-2.5 flex justify-between font-mono text-sm text-text-secondary">
        <span>{minThreshold}°C</span>
        <span>{maxThreshold}°C</span>
      </div>

      {outOfRange && currentValue !== null && (
        <p className="mt-2 text-xs text-mide-alert">
          La última lectura ({currentValue.toFixed(1)}°C) está fuera de este rango.
        </p>
      )}
    </div>
  );
}
