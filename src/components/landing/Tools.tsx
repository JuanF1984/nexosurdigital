const days = ["Lun", "Mar", "Mié", "Jue", "Vi", "Sá", "Dom"];
const dates = [15, 16, 17, 18, 19, 20, 21];
const activeDate = 18;

const clients = [
  { name: "Ana González", status: "Confirmado", style: "bg-accent-green/15 text-[#1a8a4a]" },
  { name: "Juan Alvarez", status: "Pendiente", style: "bg-accent-blue/12 text-accent-blue" },
  { name: "María López", status: "Confirmado", style: "bg-accent-green/15 text-[#1a8a4a]" },
  { name: "Carlos Pérez", status: "Inactivo", style: "bg-black/6 text-[#999]" },
];

export function Tools() {
  return (
    <section id="herramientas" className="py-24 px-6 text-center">
      <h2 className="font-display text-[clamp(2rem,4.5vw,3.2rem)] font-normal italic mb-12">
        Herramientas hechas para vos
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-[900px] mx-auto">
        {/* Turnos */}
        <div className="bg-card rounded-2xl border border-white/5 overflow-hidden transition-all hover:border-accent-blue/20 hover:-translate-y-1">
          <div className="bg-card-light m-4 rounded-xl p-5 text-[#1a1a2e]">
            <div className="flex justify-between items-center mb-4">
              <h4 className="font-semibold text-base">Turnos</h4>
              <div className="flex gap-2">
                <span className="w-7 h-7 rounded-md bg-black/5 flex items-center justify-center text-xs text-[#666]">☰</span>
                <span className="w-7 h-7 rounded-md bg-black/5 flex items-center justify-center text-xs text-[#666]">⌕</span>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-1 mb-4 text-center">
              {days.map((d) => (
                <span key={d} className="text-[0.7rem] text-[#999] font-semibold mb-1">
                  {d}
                </span>
              ))}
              {dates.map((n) => (
                <span
                  key={n}
                  className={`text-[0.95rem] font-semibold p-1.5 ${
                    n === activeDate
                      ? "bg-accent-green text-white rounded-full"
                      : "text-[#333] rounded-lg"
                  }`}
                >
                  {n}
                </span>
              ))}
            </div>

            <div className="flex gap-2 flex-wrap">
              {["09:00", "11:00", "15:00"].map((t) => (
                <span
                  key={t}
                  className="px-3.5 py-1.5 rounded-lg border border-black/10 text-sm font-semibold text-[#333]"
                >
                  {t}
                </span>
              ))}
              <span className="px-3.5 py-1.5 rounded-lg bg-accent-green text-white text-sm font-semibold">
                Reservar
              </span>
            </div>
          </div>
          <p className="px-5 pb-4 text-sm text-text-secondary font-light">
            Reservas sin mensajes. Sin desorden.
          </p>
        </div>

        {/* Clientes */}
        <div className="bg-card rounded-2xl border border-white/5 overflow-hidden transition-all hover:border-accent-blue/20 hover:-translate-y-1">
          <div className="bg-card-light m-4 rounded-xl p-5 text-[#1a1a2e]">
            <div className="flex justify-between items-center mb-4">
              <h4 className="font-semibold text-base">Clientes</h4>
              <div className="flex items-center gap-1.5 bg-black/5 rounded-lg px-3 py-1.5 text-sm text-[#888]">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#999" strokeWidth="2">
                  <circle cx="7" cy="7" r="5" />
                  <path d="M11 11l3.5 3.5" />
                </svg>
                Buscar
              </div>
            </div>

            {clients.map((c, i) => (
              <div
                key={c.name}
                className={`flex justify-between items-center py-2.5 ${
                  i < clients.length - 1 ? "border-b border-black/6" : ""
                }`}
              >
                <span className="font-semibold text-sm">{c.name}</span>
                <span className={`text-[0.7rem] font-semibold px-2.5 py-0.5 rounded-full ${c.style}`}>
                  {c.status}
                </span>
              </div>
            ))}
          </div>
          <p className="px-5 pb-4 text-sm text-text-secondary font-light">
            Solo lo que necesitás para trabajar mejor.
          </p>
        </div>
      </div>
    </section>
  );
}
