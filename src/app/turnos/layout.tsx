import type { Metadata } from "next";
import Link from "next/link";
import { TurnosTopBar } from "@/components/turnos/TurnosTopBar";

export const metadata: Metadata = {
  title: "Turnos — Panel privado | Nexo Sur",
  description: "Panel operativo de reservas de Turnos. Acceso interno restringido.",
  robots: { index: false, follow: false },
};

export default function TurnosLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative z-1 flex min-h-svh flex-col">
      <TurnosTopBar />
      <main className="flex-1">{children}</main>
      <footer className="border-t border-white/5 px-6 py-6 text-center">
        <p className="text-xs text-text-dim">
          Turnos es un panel interno de{" "}
          <Link href="/" className="text-text-secondary no-underline transition-colors hover:text-text-primary">
            Nexo Sur
          </Link>
          . Acceso restringido al equipo autorizado — contiene datos personales de clientes.
        </p>
      </footer>
    </div>
  );
}
