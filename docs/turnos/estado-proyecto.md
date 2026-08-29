# Estado del proyecto — Turnos (dashboard en `nexosur-web`)

_Última actualización: 2026-08-28_

> **MIGRADO Y CÓDIGO LEGACY RETIRADO (sesiones 2026-08-28)**: el
> dashboard/login descrito en este documento se movió a `turnos-web`
> (`turnos.nexosurdigital.com.ar/login` y `/dashboard`) — ver
> `turnos-web/docs/arquitectura.md` ("Dashboard") y ADR-002 en
> `turnos-web/docs/decisiones.md` (**RESUELTO Y CERRADO**). Confirmado el
> funcionamiento en producción, el código de este repo
> (`src/app/turnos/*`, `src/lib/turnos/*`, `src/components/turnos/*`,
> `src/proxy.ts`) **ya se borró** — ver la sesión de retiro del código
> legacy más abajo para el detalle completo. Los redirects
> (`next.config.ts`: `/turnos/login` y `/turnos/dashboard` →
> `turnos.nexosurdigital.com.ar`) siguen activos y ahora son permanentes
> (308). El resto de este documento describe el estado **previo a la
> migración**, como referencia histórica — no se reescribió
> retroactivamente.

## Sesión 2026-08-28 (3) — Conectar la landing institucional con el producto Turnos real

**Contexto**: hasta esta sesión, `nexosur-web` mencionaba Turnos únicamente
como una maqueta de presentación (`src/components/landing/Tools.tsx`, un
mini-calendario ficticio sin ningún link) — el producto real ya vive del
todo en `turnos-web` (login/dashboard migrados y cerrados, ver sesión (2)
arriba; dos comercios demo reales, restaurante y peluquería; dashboard
demo público sin backend en `/demo/dashboard`). Objetivo: conectar la
landing con el producto real mediante CTAs, sin rediseñar la landing ni
tocar lógica/Supabase/auth de ningún lado. Detalle completo de la
implementación (Part 1, corrección de cancelación de turnos pasados) en
`turnos-web/docs/decisiones.md`, ADR-011.

**Análisis previo** (sin tocar código): revisada la landing completa
(`Hero`, `Services`, `Tools`, `VideoDemo`, `WebShowcase`, `Trust`, `FAQ`,
`CTA`, `Navbar`, `Footer`) y `globals.css`. Hallazgos relevantes:

- `Tools.tsx` ya muestra un mockup de "Turnos" (calendario + horarios +
  botón "Reservar") — rubro-neutral, sin ningún texto ni imagen
  gastronómica — pero **sin ningún link real**, es pura ilustración.
- `Trust.tsx` ya lista explícitamente "Barberías, Salud, Gastronomía,
  Comercios, Oficios" como los rubros atendidos — la landing YA se
  presenta como multi-rubro a nivel de mensaje, independientemente de
  Turnos.
- El video existente (`VideoDemo.tsx`, `/videos/auto_wp.mp4`) demuestra un
  **bot de WhatsApp para un rubro "auto"** (taller/afín) — no es sobre
  Turnos ni sobre reservas online, y no es gastronómico tampoco. Es un
  video de un producto/canal distinto (WhatsApp), ubicado cerca de las
  secciones de Turnos en el orden de la página. No se tocó (pedido
  explícito: no hacía falta rehacerlo en esta sesión) — documentado como
  inconsistencia de asociación de producto, no de rubro.
- Paleta y componentes ya comparten tokens con `turnos-web`
  (`--color-accent-blue`, `--color-accent-green`, `--color-deep`, etc.) —
  mismo sistema de diseño, dos repos.
- Patrón de botón ya establecido: pill (`rounded-full`), semibold, hover
  con `-translate-y-0.5` + sombra de color, dos "sabores" existentes
  (`gradient-bg` para "contacto", `bg-whatsapp` para WhatsApp) — ningún
  "sabor" propio para "ir al producto".

**`frontend-design`**: cargado para decidir jerarquía/ubicación/cantidad de
texto — no se corrió el ritual completo de ideación de marca (paleta,
tipografía, "elemento firma"), porque `nexosur-web` ya tiene una identidad
visual asentada y el pedido era integrar, no rediseñar (mismo criterio ya
aplicado en las sesiones de pulido de `turnos-web`). Se aplicó el "piso de
calidad" (jerarquía real, foco visible, restricción, mobile) y la guía de
escritura (voz activa, nombrar lo que la persona va a hacer/ver, sin
copy de más).

**Decisión de ubicación**: en vez de un bloque nuevo, se extendió
`Tools.tsx` (justo debajo de las dos cards existentes, dentro de la misma
`<section id="herramientas">`) con una línea corta + dos CTAs + una
aclaración de rubro — la maqueta de Turnos ahora termina en "esto es de
verdad, probalo". El acceso de cliente existente ("Ingresar al panel") se
agregó al `Footer.tsx`, como un cuarto link en la fila que ya existe
(WhatsApp | Email | Instagram) — misma jerarquía visual que ya usa esa
fila para accesos secundarios, evitando "tres botones sueltos con el mismo
peso".

**Jerarquía final**:

1. **"Probar como cliente"** (`bg-accent-blue`, pill sólido) →
   `https://turnos.nexosurdigital.com.ar/demo-reservas-nexo-sur` — CTA
   principal, mismo peso visual que el resto de los CTA pill del sitio,
   color propio (accent-blue, no gradient-bg/whatsapp) para leerse como
   "vas hacia el producto Turnos", distinto de "contactanos".
2. **"Ver panel del comercio"** (borde, sin relleno) →
   `https://turnos.nexosurdigital.com.ar/demo/dashboard` — secundaria,
   mismo pill pero sin fondo.
3. **"Ingresar al panel"** (link de texto en el Footer) →
   `https://turnos.nexosurdigital.com.ar/login` — la menos prominente,
   pensada para quien YA es cliente, no para convencer a alguien nuevo.

**Copy**: no se copiaron los textos conceptuales del pedido tal cual. "Probar
como cliente" / "Ver panel del comercio" nombran explícitamente DESDE QUÉ
LADO se va a ver el producto (cliente vs. comercio) — más específico que
"Probar Turnos" / "Ver panel demo", y arma un par con estructura paralela
que por sí solo comunica "hay dos perspectivas para probar". Se agregó una
aclaración corta de una línea ("Sirve para cualquier rubro: en el panel
demo podés elegir entre restaurante y peluquería.") para no dejar la
sección leyéndose como exclusivamente gastronómica, atada al lugar
concreto donde eso es demostrable (el selector real del panel demo), no
como una afirmación abstracta.

**Multi-rubro — limitación reconocida, no resuelta**: el CTA principal
apunta al comercio demo de **restaurante** (dado así por el pedido). Como
`Trust.tsx` (que sí transmite "multi-rubro") aparece MÁS ABAJO en la
página que `Tools.tsx`, alguien que solo mire hasta ahí podría leer "Turnos
= reservas de restaurante". Mitigado parcialmente por la leyenda agregada
y por el CTA secundario (que sí muestra el selector real
Restaurante/Peluquería) — resolverlo del todo implicaría reordenar
secciones de la landing o agregar un selector de rubro al CTA, fuera de
alcance explícito ("no rediseñar la landing"). Documentado para una futura
sesión.

**Hallazgo de accesibilidad, documentado y no corregido**: `Hero.tsx` (CTA
"Contanos tu caso") y `CTA.tsx` (CTA "Escribir por WhatsApp") no tienen
ningún estilo de foco visible — `CTA.tsx` incluso usa `outline-none` sin
ningún reemplazo. `VideoDemo.tsx` sí lo hace bien
(`focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-2`).
Los dos CTAs nuevos de esta sesión siguen el patrón correcto de
`VideoDemo.tsx`. No se tocaron `Hero.tsx`/`CTA.tsx` — son botones
preexistentes, ninguno de los dos formaba parte del pedido de esta sesión
— queda como mejora futura.

**Archivos modificados**: `src/components/landing/Tools.tsx`,
`src/components/layout/Footer.tsx`. Nada más — ni lógica, ni Supabase, ni
auth, ni APIs, ni WhatsApp, ni el layout general de la landing.

**Verificación**: `pnpm lint` limpio (0 errores; 3 warnings preexistentes
en archivos no tocados). No hay tests en este repo (`pnpm test` sale con
"No test files found", esperable). `pnpm build` limpio (typecheck incluido
en el build de Next). Verificado con `curl` contra `pnpm dev`: los 3
destinos resuelven exactamente a las URLs pedidas, el copy renderiza
correcto. CSS compilado confirmado (`bg-accent-blue`, `min-h-11`,
`focus-visible:ring-2`, `rounded-full`) — sin navegador conectado en esta
sesión (mismo límite que todo el resto de esta conversación).

**Decisión de `target="_blank"`**: los 3 links nuevos abren en pestaña
nueva — mismo criterio que ya usan los links de WhatsApp/Instagram del
Footer para destinos externos (la landing institucional y Turnos son
apps/dominios distintos); mantiene la landing abierta para que la persona
pueda seguir leyendo o llegar al CTA de contacto de más abajo.

**Próximo paso**: ninguno pendiente de esta integración puntual — la
decisión de reordenar secciones de la landing o de rehacer el video queda
para una sesión futura, si se decide encararla.

## Sesión 2026-08-28 (2) — Retiro del código legacy, migración cerrada

**Contexto**: la migración (sesión anterior, más abajo) ya está desplegada
y confirmada en producción — login y dashboard funcionando correctamente
en `turnos.nexosurdigital.com.ar`. Esta sesión completa la migración
borrando el código viejo, que hasta ahora seguía existiendo en este repo
(solo inalcanzable por el redirect).

**Revisión previa a borrar** (sin asumir nada):

1. Se identificaron todos los archivos exclusivos del dashboard/login:
   `src/app/turnos/**` (8 archivos: layout, login/{page,actions}, dashboard/{page,actions,loading,error,actions.test}),
   `src/components/turnos/**` (7 componentes: TurnosTopBar, SignOutButton,
   ReservationsSummary, ReservationsList, ReservationStatusBadge,
   ChannelBadge, CancelReservationButton), `src/lib/turnos/**` (8 archivos:
   auth, authorization, cancellation+test, dashboard-data, format,
   supabase, supabase-auth), y `src/proxy.ts` (raíz).
2. Se verificó por `grep` que **ningún archivo fuera de esos tres
   directorios** importa nada de `@/lib/turnos/*`, `@/components/turnos/*`
   ni `@/app/turnos/*` — cero consumidores externos, seguro borrar los
   tres árboles completos.
3. Se distinguió específicamente código compartido de código exclusivo en
   dos casos que sí necesitaban revisión:
   - **`src/proxy.ts`**: su `matcher` (`["/turnos/:path*"]`) solo cubría
     rutas de Turnos; MIDE nunca tuvo login/middleware propio (documentado
     desde el diseño original). Sin otro consumidor — se borró entero.
   - **Tokens de `globals.css`**: `--color-turnos-danger` no tenía ningún
     uso fuera de los tres directorios de Turnos — se borró. `--color-whatsapp`,
     en cambio, **se conservó**: además de `ChannelBadge.tsx` (Turnos, ya
     borrado), lo usa `src/components/landing/CTA.tsx` — el botón real de
     "hablanos por WhatsApp" de la landing institucional. Borrarlo habría
     roto un elemento visual de la página principal del sitio, sin relación
     con Turnos.
   - **`@supabase/ssr`** (dependencia de npm): usada únicamente por
     `src/lib/turnos/supabase-auth.ts` y `src/proxy.ts` — ambos borrados, sin
     otro consumidor. Se removió con `pnpm remove @supabase/ssr`.

**Borrado** (`git rm`): `src/app/turnos/` (directorio completo),
`src/components/turnos/` (directorio completo), `src/lib/turnos/`
(directorio completo), `src/proxy.ts`.

**Modificado**: `src/app/globals.css` (quitado `--color-turnos-danger`,
conservado `--color-whatsapp`), `package.json`/`pnpm-lock.yaml` (quitado
`@supabase/ssr`), `next.config.ts` (redirects: `permanent: false` →
`permanent: true` — ver razonamiento en el archivo), `.env.example`
(comentario nuevo marcando las cinco variables de Turnos como sin código
que las lea, sin borrar las líneas).

**Verificado**:

- `pnpm test` → "No test files found" (**esperado, no un problema**: los
  únicos dos archivos de test que tenía este repo,
  `cancellation.test.ts` y `dashboard/actions.test.ts`, probaban
  exclusivamente el código que se acaba de borrar).
- `pnpm lint` → 0 errores (3 warnings preexistentes sin relación,
  `no-page-custom-font` y `no-img-element` en componentes de landing/MIDE).
- `pnpm build` → compila limpio. Tabla de rutas ya sin
  `/turnos/dashboard`/`/turnos/login` ni "Proxy (Middleware)" (confirma que
  `src/proxy.ts` era el único middleware del proyecto). `/`, `/mide`,
  `/mide/dashboard`, `/privacidad`, `/api/*` sin cambios.
- **Redirects reales** (`pnpm start` + `curl`): `/turnos/login` →
  `308` → `https://turnos.nexosurdigital.com.ar/login`;
  `/turnos/dashboard` → `308` → `.../dashboard`. Ambos funcionan sin que
  exista ningún archivo de página detrás — `redirects()` de Next.js actúa
  por path, no por la existencia de un archivo.
- **Token compartido preservado**: verificado que `bg-whatsapp` sigue
  presente en el HTML de `/` y que `--color-whatsapp` sigue compilado en el
  CSS final.

**Variables de entorno sin código que las lea** (no tocadas en Vercel, ni
borradas de `.env.example`/`.env.local` — decisión explícita del usuario,
pendiente de decidir en una limpieza posterior):
`TURNOS_SUPABASE_URL`, `TURNOS_SUPABASE_ANON_KEY`,
`TURNOS_SUPABASE_SECRET_KEY`, `TURNOS_API_URL`, `TURNOS_API_TOKEN`.
Confirmado con `grep -rn "TURNOS_" src/ next.config.ts` sin resultados.

**Pendiente**: ninguno bloqueante. Si en algún momento se decide retirar
las cinco variables de Vercel, es seguro hacerlo — no queda ningún código
en este repo que las use.

## Sesión 2026-08-28 — Migración a `turnos-web`

**Qué se hizo desde este lado**: se revisó todo este directorio
(`docs/turnos/*`) y el código real (`src/lib/turnos/*`,
`src/app/turnos/**`, `src/components/turnos/**`, `src/proxy.ts`) como
insumo para migrar a `turnos-web` — sin modificar ninguno de esos archivos.
Se confirmó por búsqueda en todo `src/` que ningún nav/menú/componente fuera
de `src/app/turnos/*`, `src/lib/turnos/*` y `src/components/turnos/*`
linkeaba a `/turnos/login` o `/turnos/dashboard` (el único archivo que las
mencionaba, fuera de esos tres directorios, era este mismo `src/proxy.ts`)
— no hizo falta actualizar ningún otro lugar del sitio institucional.

**Único cambio de código en este repo**: `next.config.ts` gana
`redirects()` — `/turnos/login` → `https://turnos.nexosurdigital.com.ar/login`,
`/turnos/dashboard` → `https://turnos.nexosurdigital.com.ar/dashboard`,
ambos `permanent: false` (307) mientras la migración no esté confirmada en
producción (un redirect permanente se cachearía agresivamente y sería más
difícil de revertir si hiciera falta). El código viejo sigue compilando
(`pnpm build` sigue listando `/turnos/dashboard` y `/turnos/login` en la
tabla de rutas) — el redirect actúa en la capa de ruteo, antes de que esas
páginas lleguen a renderizar, así que no hizo falta tocarlas ni borrarlas.

**Verificado**: `pnpm test` (23/23, sin cambios — los tests de
`cancellation.test.ts`/`actions.test.ts` siguen probando el código viejo,
que sigue intacto), `pnpm build` (compila limpio, `/turnos/dashboard` y
`/turnos/login` siguen en la tabla de rutas, `/mide`/`/mide/dashboard` sin
cambios).

**Pendiente (resuelto en la sesión de retiro del código legacy, arriba)**:
en su momento, esta sesión dejó pendiente confirmar producción antes de
borrar el código viejo y pasar los redirects a permanentes — ambas cosas
ya se hicieron, ver la sesión de arriba.

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
