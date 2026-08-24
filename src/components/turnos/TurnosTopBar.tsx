import Link from "next/link";

export function TurnosTopBar() {
  return (
    <header className="border-b border-white/5">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link href="/turnos/dashboard" className="flex items-center gap-2.5 text-text-primary no-underline">
          <span className="font-display text-xl tracking-tight">Turnos</span>
          <span className="rounded-full border border-white/10 px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.15em] text-text-dim">
            Privado
          </span>
        </Link>
        <Link
          href="/"
          className="text-xs font-medium text-text-secondary no-underline transition-colors hover:text-text-primary"
        >
          ← Nexo Sur
        </Link>
      </div>
    </header>
  );
}
