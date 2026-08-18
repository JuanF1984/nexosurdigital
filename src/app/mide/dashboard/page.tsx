import type { Metadata } from "next";
import Link from "next/link";
import { getDeviceDashboardData } from "@/lib/mide/dashboard-data";
import { computeSummaryStats } from "@/lib/mide/measurements";
import { getConnectivityTier, computeDeviceStatus } from "@/lib/mide/status";
import { TemperatureReading } from "@/components/mide/TemperatureReading";
import { RangeGauge } from "@/components/mide/RangeGauge";
import { MetricsRow } from "@/components/mide/MetricsRow";
import { TemperatureChart } from "@/components/mide/TemperatureChart";
import { EventsList } from "@/components/mide/EventsList";

// This first version targets the single development device directly rather
// than a dynamic [deviceId] route — MIDE Frío has exactly one device today.
// The data layer (getDeviceDashboardData) already takes a deviceCode, so
// adding a device switcher or `/mide/dashboard/[deviceId]` later is a
// routing change, not a rewrite. See docs/mide/dashboard.md.
const DEVICE_CODE = "mide-frio-001";

// Always read fresh data — this dashboard shows live device state, it must
// never serve a cached snapshot.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "MIDE Frío — Dashboard | Nexo Sur",
};

export default async function MideDashboardPage() {
  const dashboard = await getDeviceDashboardData(DEVICE_CODE);

  if (!dashboard.device) {
    return (
      <section className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="font-display text-3xl mb-3">Dispositivo no encontrado</h1>
        <p className="text-text-secondary text-sm mb-8">
          No encontramos el dispositivo <span className="font-mono">{DEVICE_CODE}</span>. Puede
          que todavía no esté registrado en la base.
        </p>
        <Link
          href="/mide"
          className="text-sm font-semibold text-accent-blue no-underline hover:underline"
        >
          ← Volver a MIDE
        </Link>
      </section>
    );
  }

  const { device, config } = dashboard;
  const stats = dashboard.measurements.ok ? computeSummaryStats(dashboard.measurements.data) : null;

  const connectivity = getConnectivityTier(device.lastSeenAt, config?.reportIntervalSeconds ?? null);
  const status = computeDeviceStatus({
    hasEverReported: stats !== null,
    connectivity,
    latestAvg: stats?.latest.avg ?? null,
    minThreshold: config?.minThreshold ?? null,
    maxThreshold: config?.maxThreshold ?? null,
  });

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 space-y-8">
      {!device.active && (
        <div className="rounded-xl border border-mide-alert/25 bg-mide-alert/10 px-4 py-3 text-sm text-mide-alert">
          Este dispositivo está marcado como inactivo en la base.
        </div>
      )}

      <TemperatureReading
        deviceName={device.name}
        deviceCode={device.deviceCode}
        location={device.location}
        firmwareVersion={device.firmwareVersion}
        status={status}
        latestAvg={stats?.latest.avg ?? null}
        lastSeenAt={device.lastSeenAt}
      />

      <section className="rounded-2xl border border-white/5 bg-card px-6 py-6 sm:px-8 sm:py-7">
        <RangeGauge
          minThreshold={config?.minThreshold ?? null}
          maxThreshold={config?.maxThreshold ?? null}
          currentValue={stats?.latest.avg ?? null}
        />
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-[0.2em] text-text-dim mb-4">Últimas 24 horas</h2>
        <MetricsRow stats={stats} />
      </section>

      <section className="rounded-2xl border border-white/5 bg-card px-6 py-6 sm:px-8 sm:py-7">
        <h2 className="text-xs uppercase tracking-[0.2em] text-text-dim mb-5">
          Temperatura · últimas 24 horas
        </h2>
        <TemperatureChart
          measurements={dashboard.measurements.ok ? dashboard.measurements.data : []}
          minThreshold={config?.minThreshold ?? null}
          maxThreshold={config?.maxThreshold ?? null}
          reportIntervalSeconds={config?.reportIntervalSeconds ?? 300}
        />
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-[0.2em] text-text-dim mb-4">Eventos recientes</h2>
        <EventsList
          events={dashboard.events.ok ? dashboard.events.data : []}
          unavailable={!dashboard.events.ok}
        />
      </section>
    </div>
  );
}
