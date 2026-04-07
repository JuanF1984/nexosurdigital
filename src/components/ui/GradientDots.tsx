"use client";

import { useEffect, useRef } from "react";

interface GradientDotsProps {
  count?: number;
  centered?: boolean;
  className?: string;
}

export function GradientDots({
  count = 25,
  centered = false,
  className = "",
}: GradientDotsProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || container.children.length > 0) return;

    for (let i = 0; i < count; i++) {
      const dot = document.createElement("span");
      const t = i / (count - 1);

      const r = Math.round(30 + (46 - 30) * t);
      const g = Math.round(45 + (204 - 45) * t);
      const b = Math.round(120 + (113 - 120) * t);

      dot.className = "w-[5px] h-[5px] rounded-full shrink-0";
      dot.style.backgroundColor = `rgb(${r},${g},${b})`;
      dot.style.opacity = String(0.15 + 0.85 * t);

      if (i === count - 1) {
        dot.style.boxShadow = "0 0 6px 2px rgba(46,204,113,0.5)";
      }

      container.appendChild(dot);
    }
  }, [count]);

  return (
    <div
      ref={containerRef}
      className={`flex items-center gap-[7px] mt-3 ${centered ? "justify-center" : ""} ${className}`}
    />
  );
}
