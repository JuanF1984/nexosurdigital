const rubros = [
  {
    name: "Barberías",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
        <path d="M5.5 16l-1.5 5h16l-1.5-5" />
        <path d="M6 8c0-3.3 2.7-6 6-6s6 2.7 6 6c0 2-1 3.5-2 4.5L12 16l-4-3.5C7 11.5 6 10 6 8z" />
        <circle cx="12" cy="8" r="2" />
      </svg>
    ),
  },
  {
    name: "Salud",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
  },
  {
    name: "Gastronomía",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
        <path d="M18 8h1a4 4 0 010 8h-1" />
        <path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" />
        <line x1="6" y1="1" x2="6" y2="4" />
        <line x1="10" y1="1" x2="10" y2="4" />
        <line x1="14" y1="1" x2="14" y2="4" />
      </svg>
    ),
  },
  {
    name: "Comercios",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
        <path d="M16 7V5a4 4 0 00-8 0v2" />
        <line x1="12" y1="12" x2="12" y2="16" />
      </svg>
    ),
  },
  {
    name: "Oficios",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
        <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
      </svg>
    ),
  },
];

export function Trust() {
  return (
    <section className="py-16 px-6 text-center">
      <h2 className="font-display text-[clamp(1.4rem,3vw,2rem)] font-normal italic mb-2.5">
        Trabajamos con comercios y profesionales de la zona
      </h2>
      <p className="text-text-secondary text-sm font-light mb-12">
        San Andrés de Giles y alrededores
      </p>

      <div className="flex justify-center gap-12 flex-wrap max-w-[700px] mx-auto">
        {rubros.map((r) => (
          <div key={r.name} className="flex flex-col items-center gap-3 group">
            <div className="w-[52px] h-[52px] rounded-[14px] bg-white/4 border border-white/8 flex items-center justify-center text-text-secondary transition-all group-hover:border-accent-blue/30 group-hover:bg-accent-blue/6">
              {r.icon}
            </div>
            <span className="text-sm text-text-secondary font-medium">{r.name}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
