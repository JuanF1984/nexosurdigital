import type { MeasurementPoint } from "@/lib/mide/dashboard-data";
import { buildChartSegments } from "@/lib/mide/measurements";
import { nowMs } from "@/lib/mide/format";

// Server-rendered SVG (no client JS): `measurements` stores periodic
// min/max/avg summaries, not individual samples, so this draws exactly that
// — an avg line with a shaded min/max band per period — instead of implying
// per-second precision the data doesn't have. Segments break on report-sized
// gaps (see buildChartSegments) so an outage shows as a gap, not a
// straight line across missing time. See docs/mide/dashboard.md.

const SVG_W = 640;
const SVG_H = 220;
const PAD_TOP = 18;
const PAD_BOTTOM = 30;
const PAD_X = 4;

export function TemperatureChart({
  measurements,
  minThreshold,
  maxThreshold,
  reportIntervalSeconds,
  windowHours = 24,
}: {
  measurements: MeasurementPoint[];
  minThreshold: number | null;
  maxThreshold: number | null;
  reportIntervalSeconds: number;
  windowHours?: number;
}) {
  if (measurements.length === 0) {
    return (
      <div className="flex h-[220px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10 text-center px-6">
        <p className="text-sm text-text-secondary">Sin datos suficientes en las últimas 24 horas.</p>
        <p className="text-xs text-text-dim">
          El gráfico se completa automáticamente a medida que el dispositivo reporta.
        </p>
      </div>
    );
  }

  const now = nowMs();
  const xMin = now - windowHours * 60 * 60 * 1000;
  const xMax = now;

  const segments = buildChartSegments(measurements, reportIntervalSeconds);

  const values = measurements.flatMap((m) => [m.min, m.max]);
  if (minThreshold !== null) values.push(minThreshold);
  if (maxThreshold !== null) values.push(maxThreshold);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const valuePadding = Math.max((rawMax - rawMin) * 0.15, 0.5);
  const yMin = rawMin - valuePadding;
  const yMax = rawMax + valuePadding;

  const plotW = SVG_W - PAD_X * 2;
  const plotH = SVG_H - PAD_TOP - PAD_BOTTOM;

  const xScale = (t: number) => PAD_X + ((t - xMin) / (xMax - xMin)) * plotW;
  const yScale = (v: number) => PAD_TOP + (1 - (v - yMin) / (yMax - yMin)) * plotH;
  const midTime = (m: MeasurementPoint) =>
    (new Date(m.periodStart).getTime() + new Date(m.periodEnd).getTime()) / 2;

  const linePaths = segments.map((segment) =>
    segment.map((m) => `${xScale(midTime(m))},${yScale(m.avg)}`).join(" L ")
  );

  const bandPaths = segments.map((segment) => {
    const top = segment.map((m) => `${xScale(midTime(m))},${yScale(m.max)}`);
    const bottom = [...segment].reverse().map((m) => `${xScale(midTime(m))},${yScale(m.min)}`);
    return [...top, ...bottom].join(" L ");
  });

  return (
    <div>
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        className="w-full h-auto"
        role="img"
        aria-label={`Temperatura de las últimas ${windowHours} horas, mostrando promedio y rango min-máx por período reportado`}
      >
        {maxThreshold !== null && (
          <line
            x1={PAD_X}
            x2={SVG_W - PAD_X}
            y1={yScale(maxThreshold)}
            y2={yScale(maxThreshold)}
            stroke="var(--color-text-dim)"
            strokeOpacity={0.4}
            strokeDasharray="4 4"
            strokeWidth={1}
          />
        )}
        {minThreshold !== null && (
          <line
            x1={PAD_X}
            x2={SVG_W - PAD_X}
            y1={yScale(minThreshold)}
            y2={yScale(minThreshold)}
            stroke="var(--color-text-dim)"
            strokeOpacity={0.4}
            strokeDasharray="4 4"
            strokeWidth={1}
          />
        )}

        {bandPaths.map((d, i) => (
          <path key={`band-${i}`} d={`M ${d} Z`} fill="var(--color-accent-blue)" fillOpacity={0.12} />
        ))}

        {linePaths.map((d, i) => (
          <path
            key={`line-${i}`}
            d={`M ${d}`}
            fill="none"
            stroke="var(--color-accent-blue)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        <text x={PAD_X} y={SVG_H - 8} className="fill-text-dim" fontSize={11} fontFamily="var(--font-mono)">
          -{windowHours}h
        </text>
        <text
          x={SVG_W / 2}
          y={SVG_H - 8}
          textAnchor="middle"
          className="fill-text-dim"
          fontSize={11}
          fontFamily="var(--font-mono)"
        >
          -{Math.round(windowHours / 2)}h
        </text>
        <text
          x={SVG_W - PAD_X}
          y={SVG_H - 8}
          textAnchor="end"
          className="fill-text-dim"
          fontSize={11}
          fontFamily="var(--font-mono)"
        >
          ahora
        </text>
      </svg>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-text-dim">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3.5 rounded-full bg-accent-blue" aria-hidden />
          Promedio por período
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-3.5 rounded-sm bg-accent-blue/25" aria-hidden />
          Rango mín–máx del período
        </span>
        {(minThreshold !== null || maxThreshold !== null) && (
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-0 w-3.5 border-t border-dashed border-text-dim"
              aria-hidden
            />
            Límite configurado
          </span>
        )}
      </div>
    </div>
  );
}
