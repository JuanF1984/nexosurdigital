"use client";

import { useEffect, useRef, type ReactNode } from "react";

interface ScrollRevealProps {
    children: ReactNode;
    className?: string;
}

export function ScrollReveal({ children, className = "" }: ScrollRevealProps) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    el.style.opacity = "1";
                    el.style.transform = "translateY(0)";
                    observer.unobserve(el);
                }
            },
            { threshold: 0.15 }
        );

        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    return (
        <div
            ref={ref}
            className={className}
            style={{
                opacity: 0,
                transform: "translateY(20px)",
                transition: "opacity 0.6s ease, transform 0.6s ease",
                willChange: "opacity, transform",
            }}
        >
            {children}
        </div>
    );
}