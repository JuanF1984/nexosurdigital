"use client";

import { useEffect, useState } from "react";
import { formatRelativeTime, formatFriendlyDateTime } from "@/lib/mide/format";

/**
 * Renders "hace 18 segundos" and keeps it ticking client-side. Server render
 * uses the same formatter with the request-time `now`, so there's no
 * hydration flash — the client effect just takes over afterwards.
 */
export function LiveRelativeTime({
  iso,
  className = "",
  prefix = "",
}: {
  iso: string;
  className?: string;
  prefix?: string;
}) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // `tick` only exists to force a re-render every second; the label itself
  // is always derived fresh from `iso` and the current time at render.
  void tick;

  return (
    <time dateTime={iso} title={formatFriendlyDateTime(iso)} className={className}>
      {prefix}
      {formatRelativeTime(iso)}
    </time>
  );
}
