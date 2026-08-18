import Link from "next/link";

export function MideTopBar() {
  return (
    <header className="border-b border-white/5">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link href="/mide" className="flex items-center gap-2.5 no-underline text-text-primary">
          <span className="font-display text-xl tracking-tight">MIDE</span>
          <span className="rounded-full border border-white/10 px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.15em] text-text-dim">
            Interno
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
