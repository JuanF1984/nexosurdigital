import Link from "next/link";
import type { ReactNode } from "react";

export function ProductCard({
  title,
  tag,
  tagTone = "neutral",
  description,
  meta,
  href,
}: {
  title: string;
  tag: string;
  tagTone?: "active" | "neutral";
  description: string;
  meta?: string;
  href?: string;
}) {
  const tagClass =
    tagTone === "active"
      ? "border-accent-green/25 bg-accent-green/10 text-accent-green"
      : "border-white/10 bg-white/5 text-text-dim";

  const body: ReactNode = (
    <div
      className={`h-full rounded-2xl border border-white/5 bg-card p-6 transition-all ${
        href ? "hover:border-accent-blue/20 hover:-translate-y-1" : "opacity-80"
      }`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-display text-2xl leading-none">{title}</h3>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-0.5 font-mono text-[0.65rem] uppercase tracking-[0.15em] ${tagClass}`}
        >
          {tag}
        </span>
      </div>
      <p className="text-sm font-light text-text-secondary">{description}</p>
      {meta && <p className="mt-3 font-mono text-xs text-text-dim">{meta}</p>}
      {href && (
        <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-accent-blue">
          Ver dashboard
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </span>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block h-full no-underline">
        {body}
      </Link>
    );
  }

  return body;
}
