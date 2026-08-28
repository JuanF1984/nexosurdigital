import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Migración del dashboard/login de Turnos a turnos-web — COMPLETA (sesión
  // de retiro del código legacy). Ver docs/turnos/estado-proyecto.md y
  // ADR-002 en turnos-web/docs/decisiones.md. El código de /turnos/login y
  // /turnos/dashboard (páginas, actions, componentes, libs, src/proxy.ts)
  // ya NO existe en este repo — se borró en esta sesión, después de
  // confirmar la nueva versión funcionando en producción
  // (turnos.nexosurdigital.com.ar). Estos redirects son ahora la única
  // referencia a esas rutas que queda en el código.
  //
  // `permanent: true` (308) — cambiado de `false` (307) ahora que la
  // migración está confirmada en producción y el código viejo ya no existe:
  // no hay ninguna razón técnica para seguir tratando esto como temporal
  // (no hay a qué "revertir" — el código de origen fue borrado), y un
  // redirect permanente es lo correcto para una URL que se movió
  // definitivamente (mejor cacheable por navegadores/CDNs/buscadores, sin
  // costo real porque no se espera volver a servir estas rutas desde acá).
  // Nota: estos `redirects()` funcionan por PATH, no por la existencia de
  // un archivo de página — siguen andando igual sin `src/app/turnos/*`.
  async redirects() {
    return [
      {
        source: "/turnos/login",
        destination: "https://turnos.nexosurdigital.com.ar/login",
        permanent: true,
      },
      {
        source: "/turnos/dashboard",
        destination: "https://turnos.nexosurdigital.com.ar/dashboard",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
