"use client";

import { useEffect, useRef, useState } from "react";

export function VideoDemo() {
  const [srcReady, setSrcReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSrcReady(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function handlePlay() {
    videoRef.current?.play();
    setIsPlaying(true);
  }

  return (
    <section className="py-24 px-6 text-center">
      <h2 className="font-display text-[clamp(2rem,4.5vw,3.2rem)] font-normal italic mb-4">
        Mirá cómo funciona
      </h2>
      <p className="text-base text-text-secondary font-light mb-14">
        Un ejemplo real de cómo un negocio atiende consultas sin tener que estar pendiente todo el día.
      </p>

      <div
        ref={containerRef}
        className="relative max-w-[360px] mx-auto rounded-2xl overflow-hidden bg-card border border-white/5 shadow-[0_20px_60px_rgba(0,0,0,0.4)] aspect-[9/16]"
      >
        {!isPlaying && (
          <button
            onClick={handlePlay}
            aria-label="Reproducir video"
            className="absolute inset-0 z-10 flex items-center justify-center bg-black/25 hover:bg-black/10 transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            <span
              className="w-16 h-16 rounded-full gradient-bg flex items-center justify-center shadow-[0_4px_30px_rgba(46,204,113,0.35)] transition-transform group-hover:scale-110"
              aria-hidden="true"
            >
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                className="w-7 h-7 text-white translate-x-0.5"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </button>
        )}

        <video
          ref={videoRef}
          src={srcReady ? "/videos/auto_wp.mp4" : undefined}
          preload="metadata"
          controls={isPlaying}
          playsInline
          onEnded={() => setIsPlaying(false)}
          className="absolute inset-0 w-full h-full object-contain block"
        />
      </div>
    </section>
  );
}
