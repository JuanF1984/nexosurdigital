import type { Metadata } from "next";
import Link from "next/link";
import { MideTopBar } from "@/components/mide/MideTopBar";

export const metadata: Metadata = {
  title: "MIDE — Monitoreo inteligente | Nexo Sur",
  description:
    "MIDE es la plataforma de monitoreo IoT de Nexo Sur: temperatura, energía y futuros dispositivos en un mismo lugar.",
};

export default function MideLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative z-1 flex min-h-svh flex-col">
      <MideTopBar />
      <main className="flex-1">{children}</main>
      <footer className="border-t border-white/5 px-6 py-6 text-center">
        <p className="text-xs text-text-dim">
          MIDE es una plataforma en desarrollo de{" "}
          <Link href="/" className="text-text-secondary no-underline transition-colors hover:text-text-primary">
            Nexo Sur
          </Link>
          . Este dashboard es una primera versión interna, no un portal de clientes.
        </p>
      </footer>
    </div>
  );
}
