# Dashboard de Turnos

> **MIGRADO Y CÓDIGO RETIRADO (sesiones 2026-08-28)**: ver la nota en
> `docs/turnos/arquitectura.md`. El dashboard descrito acá ahora vive en
> `turnos-web` (`turnos.nexosurdigital.com.ar/login` y `/dashboard`), con
> una mejora de UX (secciones Hoy/Próximas/Pasadas/Canceladas en vez de una
> lista única, y su propio ajuste responsive para mobile) — ver
> `turnos-web/docs/arquitectura.md`, "Dashboard". El código descrito en
> este documento ya no existe en este repo.

**Estado: mayormente lectura, con una acción de escritura (cancelar
reserva) agregada — ver `docs/turnos/cancelacion.md`.** A diferencia de
`/mide/dashboard` (interno pero sin login), este dashboard **requiere
autenticación siempre** porque muestra datos personales de clientes (nombre,
teléfono).

## Ruta

```text
/turnos/login       → formulario de acceso (email + contraseña)
/turnos/dashboard    → panel de reservas, requiere sesión
```

Ambas viven en `src/app/turnos/` con su propio `layout.tsx` (`TurnosTopBar`
+ footer que aclara "acceso restringido... contiene datos personales de
clientes"), igual de simple que `/mide` pero **sin reutilizar** `MideTopBar`
ni ningún componente de `src/components/mide/`.

## Origen de datos

Sin API HTTP nueva: `/turnos/dashboard` es un **Server Component** que llama
directamente a `getTurnosDashboardData(comercioId)`
(`src/lib/turnos/dashboard-data.ts`), que usa el cliente privilegiado
`getTurnosSupabaseClient()` (service role, server-only). El dispositivo (acá:
el navegador del usuario) nunca toca Supabase directamente — mismo criterio
que MIDE, documentado en `docs/mide/dashboard.md`.

`getTurnosDashboardData` hace, en una sola pasada:

1. Lee `comercios` (nombre + `timezone`) por `id`.
2. Calcula "hoy" con `Intl.DateTimeFormat("en-CA", { timeZone: comercio.timezone })`
   — **en el timezone del comercio**, nunca en el del servidor (mismo
   criterio que usa el bot de WhatsApp, ver `docs/base-de-datos.md` de
   `whatsapp-demo`).
3. Lee `turnos` con `fecha >= hoy`, embebiendo `servicios(nombre)` y
   `recursos(nombre)`, ordenado por `fecha` y `hora_inicio` ascendente,
   hasta 200 filas.
4. Calcula el resumen (`hoyCount`, `proximasCount`) contando solo turnos con
   `estado = 'confirmado'` — una reserva cancelada sigue apareciendo en el
   listado (con su badge), pero no infla los contadores operativos.

Si la consulta a `comercios` o a `turnos` falla, la sección se degrada a un
estado vacío/"no disponible" en vez de romper la página completa — mismo
patrón de degradación por sección que ya usa `/mide/dashboard`. El error real
de Supabase se loguea con `console.error` en el servidor, nunca se muestra
crudo al usuario.

## Campos mostrados

Por cada reserva (`src/components/turnos/ReservationsList.tsx`):

| Campo pedido | Fuente | Componente |
|---|---|---|
| Nombre del cliente | `turnos.nombre_cliente` | texto principal |
| Teléfono de contacto | `turnos.telefono` | texto secundario (monoespaciado) |
| Servicio | `turnos.servicio_id` → `servicios.nombre` | `Field` |
| Recurso asignado (mesa/profesional) | `turnos.recurso_id` → `recursos.nombre` | `Field` |
| Cantidad de personas | `turnos.cantidad_personas` (puede ser `null`) | `Field`, muestra "—" si no aplica |
| Fecha | `turnos.fecha` | `Field`, formateada en `es-AR` |
| Hora | `turnos.hora_inicio` | `Field` |
| Estado | `turnos.estado` | `ReservationStatusBadge` (confirmado = verde, cancelado = rojo) |
| Canal | `turnos.canal` | `ChannelBadge` (whatsapp/web) |

Resumen (`ReservationsSummary`): "Reservas de hoy" y "Próximas reservas"
(conteo), ambos como tiles simples — sin gráficos, sin series temporales
(pedido explícitamente fuera de alcance de esta versión).

El listado completo está ordenado cronológicamente (`fecha`, `hora_inicio`
ascendente) — no hay una lista separada "hoy" vs. "próximas": el resumen
son solo contadores, el listado de abajo es uno solo, desde hoy en adelante.

## Flujo de autenticación

1. El usuario carga `/turnos/login`. Si ya tiene sesión válida, se lo
   redirige a `/turnos/dashboard` (chequeo hecho en el propio Server
   Component de la página, con `getTurnosAuthServerClient().auth.getUser()`).
2. Envía el formulario → `signInAction` (Server Action,
   `src/app/turnos/login/actions.ts`) → `supabase.auth.signInWithPassword`.
   Sin JavaScript de Supabase en el navegador: es un `<form action={...}>`
   nativo de Next.js.
3. Si falla, redirige a `/turnos/login?error=1` (mensaje genérico, sin
   distinguir "usuario no existe" de "contraseña incorrecta" — evita dar
   pistas a quien intente adivinar credenciales).
4. Si tiene éxito, redirige a `/turnos/dashboard`.
5. En cada request a `/turnos/*`, `src/proxy.ts` refresca la cookie de sesión
   y redirige a `/turnos/login` si no hay usuario (primera capa).
6. `/turnos/dashboard` llama a `requireTurnosUser()`
   (`src/lib/turnos/auth.ts`), que vuelve a preguntarle a Supabase Auth si
   hay sesión válida (segunda capa, independiente de la primera) antes de
   tocar cualquier dato de negocio.
7. Con sesión confirmada, `getComerciosForUser(user.id)` resuelve qué
   comercio(s) puede administrar — si la lista viene vacía, se muestra
   "Sin comercios asignados" en vez de datos de ningún comercio.

Cerrar sesión: `SignOutButton` (Server Component, `<form action={signOutAction}>`)
visible en el encabezado del dashboard.

## Manejo de errores y estados

- **No configurado** (`TURNOS_SUPABASE_URL`/`TURNOS_SUPABASE_ANON_KEY`
  ausentes): `/turnos/login` muestra un aviso explícito en vez de crashear;
  `src/proxy.ts` redirige `/turnos/dashboard` a `/turnos/login` (fail
  closed) en vez de dejar pasar el request.
- **Login inválido:** mensaje genérico en `/turnos/login?error=1`.
- **Sin comercios asignados:** mensaje explícito en el dashboard + botón de
  cerrar sesión (no es un error, es un estado de autorización vacío).
- **Comercio no encontrado** (el `comercio_id` de `usuario_comercios` ya no
  existe en `comercios`): mensaje explícito, no un 500.
- **Sin reservas próximas:** `ReservationsList` muestra "Sin reservas
  próximas registradas." en vez de una tabla vacía sin contexto.
- **Falla la consulta a Supabase** (por ejemplo, permisos insuficientes de
  `service_role` sobre `turnos` — ver `docs/turnos/base-de-datos.md`):
  `ReservationsList` muestra "No pudimos cargar las reservas en este
  momento.", el resumen muestra "No disponible" en vez de un número, y
  `src/app/turnos/dashboard/error.tsx` cubre cualquier excepción no
  capturada más arriba.
- **Loading:** `src/app/turnos/dashboard/loading.tsx`, esqueletos
  (`animate-pulse`) mientras se resuelve el Server Component — mismo patrón
  visual que `/mide/dashboard`.

## Seguridad

- `TURNOS_SUPABASE_SECRET_KEY` solo se lee en
  `src/lib/turnos/supabase.ts`, server-only. Verificado que no aparece en
  ningún archivo de `.next/static` tras `npm run build` (bundle de cliente).
- Ningún componente cliente (`"use client"`) importa
  `getTurnosSupabaseClient` ni `getTurnosAuthServerClient` — ambos dependen
  de módulos server-only (`next/headers`, la service role key) que rompen el
  build si se importan desde un Client Component.
- `/turnos/dashboard` está protegido en dos capas independientes (ver
  "Flujo de autenticación" arriba) — nunca se depende solo de que la ruta
  no esté linkeada desde ningún lado.
- Sesión manejada enteramente por Supabase Auth vía `@supabase/ssr`
  (cookies httpOnly gestionadas por la librería) — no hay ningún token o
  sesión hecha a mano.
- No se loguea ninguna contraseña ni credencial: `signInAction` no llama a
  `console.log`/`console.error` con el contenido del formulario en ningún
  caso, ni siquiera en el camino de error.
- El dashboard no devuelve más datos personales de los pedidos: no se
  selecciona `datos` (jsonb, que en `sesiones_whatsapp` incluye el nombre de
  perfil de WhatsApp) ni ninguna columna de `sesiones_whatsapp` — esa tabla
  ni se toca.
- **Primera acción de escritura: cancelar un turno.** Implementada como
  Server Action (`src/app/turnos/dashboard/actions.ts`), no como un botón que
  llame a Supabase desde el cliente. Repite `requireTurnosUser()` y verifica
  que el `comercio_id` real del turno (leído server-side, nunca confiado del
  cliente) esté en `getComerciosForUser(user.id)` **antes** de llamar al
  backend. La cancelación real no se reimplementó acá: se consume
  `POST /api/turnos/cancelar` del backend separado `nexosur-turnos`
  (`cancelarTurno()`), autenticado backend-to-backend con `TURNOS_API_TOKEN`.
  Ver `docs/turnos/cancelacion.md` para el flujo completo, las 10
  validaciones cubiertas, y por qué `TURNOS_API_TOKEN` no sustituye la
  autorización por usuario.
- **Pendiente:** log de auditoría explícito (tabla propia con quién canceló
  qué turno y cuándo) — hoy solo queda el registro implícito que ya hace
  `nexosur-turnos` al actualizar `turnos.estado`, sin un log adicional en
  `nexosur-web`.
