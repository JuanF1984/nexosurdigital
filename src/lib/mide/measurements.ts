import type { MeasurementPoint } from "@/lib/mide/dashboard-data";

// Pure helpers over the periodic min/max/avg summaries `measurements`
// actually stores — no individual samples exist, so nothing here recomputes
// or claims a precision the data doesn't have. See docs/mide/dashboard.md.

export type SummaryStats = {
  min: number;
  max: number;
  /** Weighted by sample_count per period, not a plain mean of averages. */
  avg: number;
  totalSamples: number;
  latest: MeasurementPoint;
};

export function computeSummaryStats(measurements: MeasurementPoint[]): SummaryStats | null {
  if (measurements.length === 0) return null;

  let min = Infinity;
  let max = -Infinity;
  let weightedSum = 0;
  let totalSamples = 0;
  let latest = measurements[0];

  for (const point of measurements) {
    if (point.min < min) min = point.min;
    if (point.max > max) max = point.max;
    weightedSum += point.avg * point.samples;
    totalSamples += point.samples;
    if (new Date(point.periodStart) > new Date(latest.periodStart)) latest = point;
  }

  return {
    min,
    max,
    avg: totalSamples > 0 ? weightedSum / totalSamples : NaN,
    totalSamples,
    latest,
  };
}

/**
 * Splits a time-ordered measurement list into contiguous segments, breaking
 * whenever the gap between one period's end and the next period's start
 * exceeds a multiple of the device's report interval. Chart lines are drawn
 * per-segment so a long outage renders as a visible gap instead of a
 * straight line pretending data existed the whole time.
 */
export function buildChartSegments(
  measurements: MeasurementPoint[],
  reportIntervalSeconds: number
): MeasurementPoint[][] {
  if (measurements.length === 0) return [];

  const gapThresholdMs = Math.max(reportIntervalSeconds, 1) * 3 * 1000;
  const segments: MeasurementPoint[][] = [[measurements[0]]];

  for (let i = 1; i < measurements.length; i++) {
    const prev = measurements[i - 1];
    const curr = measurements[i];
    const gapMs = new Date(curr.periodStart).getTime() - new Date(prev.periodEnd).getTime();

    if (gapMs > gapThresholdMs) {
      segments.push([curr]);
    } else {
      segments[segments.length - 1].push(curr);
    }
  }

  return segments;
}
