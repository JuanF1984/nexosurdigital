import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Migración del dashboard/login de Turnos a turnos-web (sesión de
  // migración — ver docs/turnos/estado-proyecto.md y ADR-002 en
  // turnos-web/docs/decisiones.md). El código de /turnos/login y
  // /turnos/dashboard sigue existiendo en este repo (deliberadamente, no se
  // borró todavía — ver esa misma documentación para el porqué), pero
  // queda inalcanzable mientras este redirect esté activo: Next.js aplica
  // `redirects()` en la capa de ruteo, antes de renderizar la página real.
  //
  // `permanent: false` (307) a propósito, no 308: mientras la migración no
  // esté confirmada en producción (login real + dashboard real verificados
  // contra turnos.nexosurdigital.com.ar), un redirect permanente quedaría
  // cacheado agresivamente por navegadores/CDNs y sería más difícil de
  // revertir si hiciera falta. Cambiar a `permanent: true` (y recién
  // entonces evaluar borrar /turnos/login, /turnos/dashboard y sus módulos
  // de src/lib/turnos/*) es el paso siguiente, no parte de esta sesión.
  async redirects() {
    return [
      {
        source: "/turnos/login",
        destination: "https://turnos.nexosurdigital.com.ar/login",
        permanent: false,
      },
      {
        source: "/turnos/dashboard",
        destination: "https://turnos.nexosurdigital.com.ar/dashboard",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
