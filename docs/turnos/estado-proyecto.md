# Estado del proyecto — Turnos (dashboard en `nexosur-web`)

_Última actualización: 2026-08-24_

## Sesión 2026-08-24: cancelar reserva desde el dashboard

Primera acción de escritura del dashboard. Documentación completa en
`docs/turnos/cancelacion.md` — este apartado resume solo lo esencial para
quien retome el proyecto.

**Qué se implementó:**

- `src/lib/turnos/cancellation.ts` (`getTurnoOwnership`, `cancelTurnoRemote`),
  `src/app/turnos/dashboard/actions.ts` (`cancelReservationAction`, Server
  Action), `src/components/turnos/CancelReservationButton.tsx` (Client
  Component con confirmación y feedback).
- `src/components/turnos/ReservationsList.tsx` modificado para mostrar el
  botón solo en reservas `confirmado`.
- Variables nuevas `TURNOS_API_URL` / `TURNOS_API_TOKEN` en `.env.example` y
  `.env.local` (placeholders vacíos en ambos — sin valores reales cargados
  en esta sesión).
- Vitest agregado (`pnpm add -D vitest`, script `test`, `vitest.config.ts`
  con el alias `@/*` de `tsconfig.json`) — el proyecto no tenía test runner
  antes de esta sesión. 23 tests nuevos en
  `src/lib/turnos/cancellation.test.ts` y
  `src/app/turnos/dashboard/actions.test.ts`.

**No se implementó (fuera de alcance explícito de esta sesión):** IA,
reprogramación, reserva web/QR, recordatorios, selector de comercio,
cualquier cambio en MIDE o en `nexosur-turnos`.

**Verificado:** `pnpm test` (23/23), `pnpm exec tsc --noEmit` (limpio),
`pnpm run lint` (0 errores), `pnpm run build` (compila; `/mide` y
`/mide/dashboard` sin cambios en el listado de rutas). Se confirmó que
`TURNOS_API_TOKEN` y la lógica de `cancellation.ts` no aparecen en
`.next/static/*` tras el build.

**Pendiente (bloqueante para probar en real):**

1. Cargar `TURNOS_API_URL` y `TURNOS_API_TOKEN` reales en `.env.local` — el
   valor de `TURNOS_API_TOKEN` debe ser **exactamente el mismo** que el
   configurado en el proyecto `nexosur-turnos` (`Proyectos/whatsapp-demo` en
   disco), o el backend rechazará todas las llamadas con `401`.
2. Confirmar que `nexosur-turnos` tiene `TURNOS_API_TOKEN` cargado en su
   propio entorno (según su `docs/estado-proyecto.md`, a la fecha de esa
   documentación todavía no estaba cargado en Vercel).
3. Probar el flujo real: cancelar una reserva de prueba desde
   `/turnos/dashboard` y confirmar en la Supabase de Turnos que
   `turnos.estado` pasó a `cancelado`.
4. No se probó ningún escenario contra un backend real (todo lo cubierto por
   los 23 tests usa mocks) — antes de considerar esto "probado en
   producción", repetir al menos el caso de cancelación válida y el de
   "backend no disponible" contra el deployment real de `nexosur-turnos`.

**Próximo paso recomendado:** cargar las dos variables (local y en Vercel,
ver `docs/turnos/configuracion.md`) y hacer la primera prueba end-to-end
real antes de dar por cerrada esta funcionalidad.

## Incidente resuelto: 404 en `/turnos/login` bajo `pnpm dev`

**Síntoma:** con `pnpm dev` corriendo, `http://localhost:3000/turnos/login`
devolvía `404 - This page could not be found`, mientras que
`/turnos/dashboard` sí redirigía correctamente a `/turnos/login` (`307`) y
`/mide`, `/mide/dashboard`, `/` y `/privacidad` seguían respondiendo `200`
sin cambios.

**Diagnóstico realizado (todo confirmado antes de tocar nada):**

- `src/app/turnos/login/page.tsx`, `dashboard/page.tsx`, `layout.tsx` y
  `login/actions.ts` existen, están completos y bien ubicados — no hay
  route groups, nombres de carpeta ni archivos fuera de lugar (`find
  src/app/turnos` listó los 6 archivos esperados).
- `src/proxy.ts` está donde debe estar, exporta `proxy` (no `middleware`,
  correcto para Next.js 16), y su `matcher: ["/turnos/:path*"]` **sí**
  estaba funcionando: el `307` de `/turnos/dashboard` lo prueba, porque esa
  redirección la emite `src/proxy.ts`, no la página.
- El archivo compilado `.next/dev/server/app/turnos/login/page.js` existía,
  con fecha de modificación **posterior** a la del código fuente — es decir,
  el servidor de desarrollo que estaba corriendo **ya había compilado
  correctamente** esa ruta en algún momento — y
  `.next/dev/server/app-paths-manifest.json` la listaba correctamente
  (`"/turnos/login/page": "app/turnos/login/page.js"`).
- Conclusión: el código y la estructura de rutas eran correctos. La causa
  era un **estado interno desincronizado del proceso de `next dev`
  (Turbopack) que estaba corriendo** — el archivo en disco y el manifiesto
  estaban bien, pero el proceso vivo servía `404` para esa ruta puntual de
  todos modos. Es consistente con la sucesión de arranques/reinicios del
  dev server durante la migración a pnpm de la sesión anterior (build de
  producción y dev mezclados en la misma carpeta `.next`, más el hecho de
  que el proyecto vive dentro de una carpeta sincronizada por OneDrive, lo
  que puede introducir demoras/eventos de archivo perdidos para el watcher
  de Turbopack). No fue un problema de código, de estructura de carpetas,
  ni de `src/proxy.ts`.

**Corrección aplicada:**

1. Se detuvo el proceso de `next dev` que estaba corriendo (`taskkill` sobre
   el PID que escuchaba en el puerto 3000).
2. Se borró por completo la carpeta `.next` (cache de Turbopack, tanto la
   de `next build` como la de `next dev` anteriores).
3. Se volvió a levantar con `pnpm dev` desde cero.

**No se modificó ningún archivo de código fuente** — ni `page.tsx`, ni
`layout.tsx`, ni `src/proxy.ts`, ni ningún archivo de `src/lib/turnos/*`.
La corrección fue puramente operativa (reinicio limpio del dev server).

**Verificado después de la corrección, con `pnpm dev` recién iniciado:**

```text
GET /turnos/login              -> 200 (muestra el formulario, título correcto)
GET /turnos/dashboard           -> 307 -> Location: /turnos/login
GET /                            -> 200
GET /mide                        -> 200
GET /mide/dashboard               -> 200
GET /privacidad                   -> 200
```

Repetido una segunda vez (rutas ya compiladas): `/turnos/login` en ~1.5s,
`/turnos/dashboard` en ~0.08s — estable, no es un problema intermitente.

**Nota para quien vuelva a ver un 404 similar:** si `pnpm dev` empieza a
servir `404` en una ruta que sabés que existe (mientras otras rutas
funcionan), antes de sospechar del código probá primero: detener el
proceso, borrar `.next`, y volver a correr `pnpm dev`. Es más rápido que
revisar la estructura de archivos, que en este incidente resultó estar bien
desde el principio.

## Qué funciona

- Estructura completa del módulo: `src/lib/turnos/*`, `src/app/turnos/*`,
  `src/components/turnos/*`, siguiendo el patrón ya validado por MIDE
  (cliente Supabase propio, server-only, env vars con prefijo propio) pero
  con un proyecto de Supabase completamente separado.
- Autenticación real con Supabase Auth (email + contraseña) vía
  `@supabase/ssr`, sin ningún JavaScript de Supabase en el navegador (login
  por Server Action).
- Protección de `/turnos/dashboard` en dos capas independientes (`src/proxy.ts`
  + `requireTurnosUser()`) — ver `docs/turnos/dashboard.md`.
- Autorización por comercio separada de la autenticación
  (`usuario_comercios` + `getComerciosForUser`), preparada para que un
  usuario tenga acceso a más de un comercio sin cambios de esquema.
- Dashboard operativo: resumen (hoy / próximas) + listado cronológico de
  reservas con los 9 campos pedidos (cliente, teléfono, servicio, recurso,
  personas, fecha, hora, estado, canal).
- Manejo de estados vacíos, loading y error en todos los puntos pedidos (ver
  `docs/turnos/dashboard.md#manejo-de-errores-y-estados`).
- `npx tsc --noEmit`, `npm run lint` y `npm run build` corren limpio con el
  código nuevo (ver "Pruebas realizadas" más abajo).
- Verificado que MIDE sigue funcionando sin cambios: `/mide` y
  `/mide/dashboard` responden `200` igual que antes, y `.env.local`/`.env.example`
  de MIDE no se tocaron (solo se **agregaron** líneas nuevas al final para
  Turnos).
- Verificado que ninguna de las tres variables de Turnos, ni el cliente
  privilegiado (`getTurnosSupabaseClient`), aparecen en el bundle de cliente
  tras `npm run build` (`.next/static/*`).

## Qué se implementó en esta sesión

- Relevamiento de la arquitectura real de MIDE (ya documentado en
  `docs/turnos/arquitectura.md`, que reemplaza a la versión "propuesta"
  anterior).
- Relevamiento del esquema real de Turnos leyendo la documentación **del
  proyecto separado `Proyectos/whatsapp-demo`** (`docs/base-de-datos.md`,
  `docs/arquitectura.md`, `docs/estado-proyecto.md`, `docs/configuracion.md`)
  y confirmando contra su código (`lib/reservas/*.js`,
  `lib/supabaseClient.js`) — sin modificar ese proyecto.
- `src/lib/turnos/supabase.ts` — `getTurnosSupabaseClient()`, cliente
  privilegiado (service role), espejo exacto del patrón de
  `src/lib/mide/supabase.ts`.
- `src/lib/turnos/supabase-auth.ts` — `getTurnosAuthServerClient()`, cliente
  de sesión con `@supabase/ssr` (anon key + cookies), exclusivo para
  autenticación.
- `src/lib/turnos/auth.ts` — `requireTurnosUser()`, guardia server-side
  independiente del middleware.
- `src/lib/turnos/authorization.ts` — `getComerciosForUser()`, capa de
  autorización por comercio.
- `src/lib/turnos/dashboard-data.ts` — `getTurnosDashboardData()`, lectura
  de `turnos` + `servicios`/`recursos` embebidos, cálculo de "hoy" en el
  timezone del comercio, resumen hoy/próximas.
- `src/lib/turnos/format.ts` — formateo de fecha/hora/estado/canal.
- `src/proxy.ts` — protección de rutas y refresco de sesión, con el nombre
  de archivo y export (`export function proxy`) que exige Next.js 16 (la
  convención `middleware.ts` está deprecada — ver "Decisiones tomadas").
- `src/app/turnos/layout.tsx`, `login/page.tsx`, `login/actions.ts`,
  `dashboard/page.tsx`, `dashboard/loading.tsx`, `dashboard/error.tsx`.
- `src/components/turnos/TurnosTopBar.tsx`, `SignOutButton.tsx`,
  `ReservationsSummary.tsx`, `ReservationsList.tsx`,
  `ReservationStatusBadge.tsx`, `ChannelBadge.tsx`.
- Token de color `--color-turnos-danger` agregado a `src/app/globals.css`
  (additive, scoped a `/turnos`, mismo criterio que los tokens `mide-*`).
- Dependencia nueva: `@supabase/ssr` (`^0.12.4`).
- `.env.example`: sección nueva para Turnos, sin tocar las variables de MIDE
  ni de `/api/energy-event` existentes.
- `.env.local`: se agregaron (al final, con valores vacíos) los tres nombres
  de variable de Turnos, sin tocar ninguna línea existente.
- Documentación nueva: este archivo, `docs/turnos/arquitectura.md`,
  `docs/turnos/dashboard.md`, `docs/turnos/base-de-datos.md`,
  `docs/turnos/configuracion.md`. Se retiró `docs/turnos/arquitectura-propuesta.md`
  (su contenido quedó absorbido en `arquitectura.md`, evitando duplicar
  documentación — mismo criterio que aplicó `whatsapp-demo` al retirar sus
  docs previos).

## Decisiones tomadas (y por qué)

- **Dos clientes Supabase de Turnos, no uno:** `getTurnosSupabaseClient()`
  (service role, datos de negocio) y `getTurnosAuthServerClient()` (anon key,
  sesión). Alternativa descartada: un único cliente service-role también
  para `signInWithPassword`. Se separaron para que un bug en el flujo de
  login nunca pueda tocar datos de negocio con privilegios elevados, y para
  que la superficie de lo que necesita la service role key quede acotada a
  lectura de tablas conocidas.
- **Login 100% server-side (Server Action), sin `createBrowserClient`:**
  alternativa descartada, un formulario que llama a Supabase desde el
  cliente con la anon key (patrón también válido y soportado por Supabase).
  Se eligió la variante sin JS de auth en el navegador para minimizar
  superficie: ni siquiera la anon key necesita, en este diseño, un nombre de
  variable `NEXT_PUBLIC_*`.
- **`src/proxy.ts`, no `src/middleware.ts`:** Next.js 16.2.2 (la versión ya
  instalada en este proyecto) deprecó la convención `middleware.ts` a favor
  de `proxy.ts` (aviso de build: "The middleware file convention is
  deprecated. Please use proxy instead"). Se confirmó leyendo
  `node_modules/next/dist/build/templates/middleware.js`: un archivo
  `proxy.ts` debe exportar una función llamada `proxy` (no `middleware`).
  Implementado así desde el principio en vez de dejar deuda técnica.
- **`usuario_comercios` como tabla nueva, no una columna en `comercios` ni
  un rol hardcodeado:** permite que un usuario tenga cero, uno o varios
  comercios sin cambiar el esquema — confirmado con el usuario antes de
  implementar (ver historial de la conversación). Se documenta con SQL
  aparte (`docs/turnos/base-de-datos.md`) para aplicar a mano en el proyecto
  de Turnos, igual que MIDE documentó sus propios permisos sin aplicarlos
  automáticamente.
- **Resumen cuenta solo `estado = 'confirmado'`, el listado muestra todo:**
  un turno cancelado sigue siendo información operativa útil (el equipo
  puede querer verlo), pero no debe inflar el conteo de "próximas reservas".
- **Sin selector de comercio todavía:** un solo comercio demo real hoy;
  agregarlo sería sobreingeniería prematura. `getComerciosForUser` ya
  devuelve una lista (no un único valor), así que sumarlo después es un
  cambio de UI sobre una función que no cambia.
- **Ningún endpoint `/api/turnos/*`:** mismo criterio que MIDE — el
  dashboard lee Supabase directo desde el Server Component, evitando
  diseñar autenticación para una API HTTP que no hace falta.

## Qué falta

- **Validar contra la Supabase real de Turnos.** Actualización: las tres
  variables (`TURNOS_SUPABASE_URL` / `_ANON_KEY` / `_SECRET_KEY`) ya están
  cargadas en `.env.local` (confirmado que no están vacías, sin leer sus
  valores). Falta todavía: aplicar el SQL de `usuario_comercios`
  (`docs/turnos/base-de-datos.md`), dar de alta el primer usuario, y probar
  el flujo real de login → dashboard → reservas reales — no se hizo como
  parte del diagnóstico del 404 (fuera del alcance puntual de ese pedido).
  Todo lo probado hasta ahora fue: comportamiento sin configurar (antes de
  que se cargaran las variables), protección de rutas (redirect real),
  build/tsc/lint, ausencia de secretos en el bundle, y — en el incidente de
  404 documentado arriba — que `/turnos/login` y `/turnos/dashboard`
  responden correctamente con un `pnpm dev` recién iniciado.
- **Crear la tabla `usuario_comercios`** en el proyecto de Supabase de
  Turnos (SQL en `docs/turnos/base-de-datos.md`) y dar de alta el primer
  usuario — sin esto, nadie puede entrar al dashboard todavía.
- Selector de comercio para usuarios con más de uno asignado.
- Cancelar reserva ya está implementado (sesión 2026-08-24, ver arriba y
  `docs/turnos/cancelacion.md`). Sigue pendiente cualquier otra acción de
  escritura (reprogramar turnos, editar servicios/recursos, configurar
  disponibilidad).
- Roles diferenciados dentro de un mismo comercio (columna
  `usuario_comercios.rol` sin uso todavía más allá del valor por defecto).
- Recuperación de contraseña / alta de usuarios por UI (hoy es 100% manual
  vía el panel de Supabase Auth de Turnos).
- Gráficos y estadísticas — pedido explícitamente fuera de alcance.

## Próximos pasos sugeridos

1. Completar `TURNOS_SUPABASE_URL` / `TURNOS_SUPABASE_ANON_KEY` /
   `TURNOS_SUPABASE_SECRET_KEY` en `.env.local` (local) y en Vercel
   (`vercel env add ...`, ver `docs/turnos/configuracion.md`) antes de
   cualquier prueba real o despliegue.
2. Aplicar el SQL de `usuario_comercios` en el proyecto de Supabase de
   Turnos y dar de alta el primer usuario (`docs/turnos/base-de-datos.md`).
3. Repetir en ese momento las pruebas que quedaron pendientes en esta
   sesión: login válido/ inválido reales, reservas reales visibles, estado
   sin reservas, y confirmar que los datos vienen de la Supabase de Turnos
   y no de la de MIDE (comparando manualmente un `id` de reserva contra el
   proyecto real).
4. Decidir si vale la pena, en una próxima etapa, un selector de comercio y
   la primera acción de escritura (probablemente "cancelar turno" — ya hay
   una guía de qué se necesita en `docs/turnos/dashboard.md#seguridad`).
5. No desplegar a producción hasta completar el paso 1 y 3 — pedido
   explícito de no subir automáticamente a producción en esta sesión.
