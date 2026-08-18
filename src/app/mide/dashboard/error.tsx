"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function DashboardError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("mide/dashboard: error de render:", error.message);
  }, [error]);

  return (
    <section className="mx-auto max-w-lg px-6 py-24 text-center">
      <h1 className="font-display text-3xl mb-3">No pudimos cargar el dashboard</h1>
      <p className="text-text-secondary text-sm mb-8">
        Hubo un problema al conectar con los datos de MIDE. Probá de nuevo en un momento.
      </p>
      <Link href="/mide" className="text-sm font-semibold text-accent-blue no-underline hover:underline">
        ← Volver a MIDE
      </Link>
    </section>
  );
}
