export function WebShowcase() {
  return (
    <section id="web" className="py-24 px-6 text-center">
      <h2 className="font-display text-[clamp(2rem,4.5vw,3.2rem)] font-normal italic mb-4">
        Tu web, simple y clara
      </h2>
      <p className="text-base text-text-secondary font-light mb-14">
        Cada web se adapta a lo que necesitás.
      </p>

      <div className="flex justify-center gap-8 flex-wrap">
        {/* Barbería */}
        <img
          src="/images/barberia.png"
          alt="Barbería en San Andrés de Giles"
          className="w-70 rounded-[28px] shadow-[0_20px_60px_rgba(0,0,0,0.4)] transition-transform hover:-translate-y-2"
        />

        {/* Kinesiología */}
        <img
          src="/images/kinesiologia.png"
          alt="Kinesiología y rehabilitación"
          className="w-70 mt-8 md:mt-8 rounded-[28px] shadow-[0_20px_60px_rgba(0,0,0,0.4)] transition-transform hover:-translate-y-2"
        />
      </div>
    </section>
  );
}
