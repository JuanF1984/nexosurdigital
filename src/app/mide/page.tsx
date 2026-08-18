import { ProductCard } from "@/components/mide/ProductCard";
import { GradientDots } from "@/components/ui/GradientDots";

export default function MidePage() {
  return (
    <>
      <section className="px-6 pt-20 pb-16 text-center sm:pt-28 sm:pb-20">
        <h1 className="font-display text-[clamp(2.75rem,8vw,5rem)] font-normal leading-[1.05] -tracking-wide">
          MIDE
        </h1>
        <p className="font-display text-[clamp(1.5rem,4vw,2.25rem)] italic text-text-secondary mt-2">
          Monitoreo <span className="gradient-text not-italic">inteligente</span>
        </p>
        <p className="mx-auto mt-6 max-w-lg font-body text-base font-light text-text-secondary">
          Una plataforma de Nexo Sur para seguir en tiempo real lo que importa en frío, energía y
          futuros dispositivos — sin planillas, sin llamadas para preguntar &ldquo;¿está todo
          bien?&rdquo;
        </p>
        <GradientDots count={25} centered className="mt-8" />
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-20">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <ProductCard
            title="MIDE Frío"
            tag="Disponible"
            tagTone="active"
            description="Temperatura en tiempo real, rango configurado y última conexión de una cámara o equipo de frío."
            meta="Dispositivo de desarrollo: mide-frio-001"
            href="/mide/dashboard"
          />
          <ProductCard
            title="MIDE Energía"
            tag="Antecedente"
            description="Prototipo anterior de MIDE para avisos de corte de energía. Sigue funcionando de forma independiente, todavía fuera de esta plataforma."
          />
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-white/6 pt-8">
          <span className="text-xs uppercase tracking-[0.2em] text-text-dim">Próximamente</span>
          <span className="rounded-full border border-white/10 px-3 py-1 font-mono text-xs text-text-dim">
            MIDE Aire
          </span>
          <span className="rounded-full border border-white/10 px-3 py-1 font-mono text-xs text-text-dim">
            Otros dispositivos
          </span>
          <span className="rounded-full border border-white/10 px-3 py-1 font-mono text-xs text-text-dim">
            Acceso de clientes
          </span>
        </div>
      </section>
    </>
  );
}
