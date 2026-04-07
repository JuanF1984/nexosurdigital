import { GradientDots } from "@/components/ui/GradientDots";

export function Hero() {
  return (
    <section className="h-dvh flex flex-col justify-center items-center text-center px-6 pt-32 relative overflow-hidden">
      {/* Glow */}
      <div className="absolute -top-[150px] left-1/2 -translate-x-1/2 w-[700px] h-[500px] bg-[radial-gradient(ellipse,rgba(74,108,247,0.07)_0%,transparent_70%)] pointer-events-none" />

      <h1 className="font-display text-[clamp(3rem,7vw,5.5rem)] font-normal leading-[1.05] mb-6 -tracking-wide">
        Menos caos.<br />
        Más <em className="italic gradient-text">orden.</em>
      </h1>

      <p className="font-body text-lg text-text-secondary mb-10 font-light">
        Organizá tu trabajo sin complicarte.
      </p>

      <a
        href="#contacto"
        className="gradient-bg inline-flex items-center gap-2.5 text-white py-3.5 px-9 rounded-full text-base font-semibold no-underline transition-all hover:-translate-y-0.5 shadow-[0_4px_30px_rgba(46,204,113,0.2)] hover:shadow-[0_8px_40px_rgba(46,204,113,0.3)]"
      >
        Contanos tu caso
      </a>

      <GradientDots count={25} centered className="mt-10" />
    </section>
  );
}
