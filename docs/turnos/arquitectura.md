# Arquitectura de Turnos

> Este documento reemplaza a `arquitectura-propuesta.md` (mismo relevamiento
> de MIDE, mismo criterio de separación) ahora que la primera versión del
> dashboard está implementada. Describe lo que existe hoy en el código, no
> una propuesta.

## Qué es Turnos dentro de `nexosur-web`

Turnos, como bot de WhatsApp, vive en un proyecto totalmente aparte
(`Proyectos/whatsapp-demo`, fuera de este repositorio) — **no se tocó** como
parte de este trabajo. Lo que este repositorio (`nexosur-web`) agrega es un
**dashboard privado de solo lectura** (`/turnos/dashboard`) para que el
equipo de Nexo Sur vea las reservas que ese bot ya generó, leyendo la misma
base de datos de Supabase que usa el bot — sin exponer ninguna API HTTP
nueva, sin modificar el bot, y sin tocar el webhook de WhatsApp/Meta.

```text
Turnos
├── Bot de WhatsApp (Proyectos/whatsapp-demo) — proyecto aparte, no tocado
│     └── escribe/lee su propio Supabase (comercios, servicios, recursos,
│         servicios_recursos, disponibilidad, excepciones_disponibilidad,
│         turnos, sesiones_whatsapp)
└── Dashboard privado (nexosur-web, este cambio)
      └── /turnos/dashboard — lee (nunca escribe) esa misma Supabase,
          agregando solo una tabla nueva de autorización (usuario_comercios)
```

## Separación respecto de MIDE

Exactamente el patrón documentado en `docs/mide/arquitectura.md` y en el
relevamiento previo, replicado con su propio prefijo — nunca compartido:

| | MIDE | Turnos |
|---|---|---|
| Proyecto Supabase | propio | propio, **distinto** |
| Variables de entorno | `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | `TURNOS_SUPABASE_URL`, `TURNOS_SUPABASE_SECRET_KEY`, `TURNOS_SUPABASE_ANON_KEY` |
| Cliente Supabase privilegiado | `src/lib/mide/supabase.ts` → `getMideSupabaseClient()` | `src/lib/turnos/supabase.ts` → `getTurnosSupabaseClient()` |
| Rutas | `/mide`, `/mide/dashboard`, `/api/mide/*` | `/turnos/login`, `/turnos/dashboard` |
| Componentes | `src/components/mide/*` | `src/components/turnos/*` |
| Login | no tiene (dashboard interno sin datos personales) | **sí**, obligatorio (contiene nombres y teléfonos) |

Ningún archivo de `src/lib/turnos/*` importa nada de `src/lib/mide/*` ni
viceversa. No existe ninguna función que reciba "cuál proyecto" usar — son
dos clientes, dos módulos, dos árboles de rutas completamente independientes.
Ver el relevamiento original en el historial de este documento (o en el
control de versiones) para el detalle de por qué se descartó un cliente
genérico.

## Separación respecto del bot de WhatsApp (`Proyectos/whatsapp-demo`)

- El dashboard **solo lee** `comercios`, `servicios`, `recursos` y `turnos`
  con el cliente service-role — nunca escribe en ninguna de esas tablas
  (no hay cancelación, edición ni reprogramación en esta primera versión).
- La única tabla nueva que este trabajo agrega, `usuario_comercios`, es
  exclusiva del dashboard: el bot de WhatsApp no la lee ni la escribe, y no
  participa de su flujo de reservas en absoluto.
- No se modificó ningún archivo de `Proyectos/whatsapp-demo` (código, docs,
  migraciones). El esquema real de sus tablas se tomó leyendo su
  documentación (`docs/base-de-datos.md`, `docs/arquitectura.md`,
  `docs/estado-proyecto.md`, `docs/configuracion.md`) y confirmando contra su
  código (`lib/reservas/*.js`, `lib/supabaseClient.js`) — nunca se asumieron
  nombres de columna sin verificar.
- El webhook de WhatsApp / Meta no se tocó ni se referencia desde este
  dashboard de ninguna forma.

## Flujo end-to-end

```text
Usuario del equipo (browser)
      │  email + contraseña
      ▼
/turnos/login  ──(Server Action signInAction)──▶  Supabase Auth (Turnos)
      │                                                 │
      │  cookies de sesión (httpOnly, gestionadas         │ valida credenciales
      │  por @supabase/ssr)                               │
      ▼                                                 ▼
src/proxy.ts (antes middleware.ts)          auth.users (Supabase Auth propio de Turnos)
  refresca la sesión en cada request
  a /turnos/*, redirige si no hay sesión
      │
      ▼
/turnos/dashboard (Server Component)
      │
      ├─ requireTurnosUser()        → confirma sesión otra vez, server-side
      ├─ getComerciosForUser(id)    → autorización: usuario_comercios → comercios
      └─ getTurnosDashboardData()  → getTurnosSupabaseClient() (service role)
                                        → turnos + servicios + recursos
```

El dispositivo/bot nunca entra en este flujo: el dashboard es un consumidor
de solo lectura de datos que el bot ya escribió.

## Autenticación: quién es el usuario

A diferencia de MIDE (sin login, sin datos personales), Turnos maneja
nombres y teléfonos de clientes, así que el acceso es obligatorio desde el
primer request.

- **Mecanismo:** Supabase Auth (email + contraseña) del propio proyecto de
  Turnos, vía el paquete oficial `@supabase/ssr` — no un sistema propio
  improvisado. No existía ningún sistema de autenticación reutilizable en
  `nexosur-web` antes de este cambio (se verificó por búsqueda en todo el
  repo: sin next-auth, Clerk, Auth0, ni implementación propia previa).
- **Dos clientes Supabase de Turnos, con responsabilidades distintas:**
  - `getTurnosSupabaseClient()` (`src/lib/turnos/supabase.ts`): service role,
    privilegiado, **solo para datos de negocio** (turnos, comercios,
    servicios, recursos, usuario_comercios). Nunca se usa para autenticar.
  - `getTurnosAuthServerClient()` (`src/lib/turnos/supabase-auth.ts`): usa la
    clave anon/publishable, atada a las cookies del request vía
    `@supabase/ssr`, **solo para login/logout/sesión**. Nunca lee tablas de
    negocio.
  - Mantenerlos separados significa que un bug en el flujo de auth no puede
    terminar leyendo/escribiendo datos de negocio con privilegios elevados,
    y viceversa.
- **Sin JavaScript de Supabase en el navegador:** el login es un formulario
  HTML que hace `POST` a una Server Action (`src/app/turnos/login/actions.ts`,
  `"use server"`). No hay ningún `createBrowserClient` en este módulo — cero
  código de autenticación corre en el cliente, y ninguna clave (ni siquiera
  la anon, pensada por Supabase para ser pública) llega al bundle del
  navegador, porque ninguna de las dos variables de entorno usa el prefijo
  `NEXT_PUBLIC_` que Next.js necesita para inlinearla en el cliente.
- **Verificado en el bundle de producción:** tras `npm run build`, se buscó
  `TURNOS_SUPABASE_SECRET_KEY`, `TURNOS_SUPABASE_ANON_KEY` y
  `getTurnosSupabaseClient` en `.next/static/*` — ninguna aparece.

## Autorización: qué comercio puede administrar cada usuario

Separada explícitamente de la autenticación, mediante una tabla nueva:

```sql
usuario_comercios (user_id, comercio_id, rol, created_at)
```

- `user_id` referencia `auth.users(id)` (Supabase Auth de Turnos).
- `comercio_id` referencia `comercios(id)` (tabla real del bot).
- Un mismo `user_id` puede tener **varias filas** (varios comercios) sin
  ningún cambio de esquema — el diseño no asume "un usuario, un comercio".
- `getComerciosForUser(userId)` (`src/lib/turnos/authorization.ts`) devuelve
  todos los comercios activos autorizados para ese usuario. La página del
  dashboard (`src/app/turnos/dashboard/page.tsx`) hoy toma el primero de la
  lista — es una decisión de la página, no una limitación del modelo de
  datos: agregar un selector de comercio cuando haga falta es un cambio de
  UI sobre la misma consulta, no una migración.
- No se implementó un sistema multi-tenant completo (roles granulares,
  invitaciones, panel de administración de usuarios) — sería
  sobreingeniería para un solo comercio demo. La columna `rol` existe y
  tiene un valor por defecto (`'admin'`) pero no se usa todavía para
  restringir nada; es el punto de extensión natural si en el futuro hace
  falta distinguir, por ejemplo, un rol de solo lectura.
- SQL completo, permisos y cómo aplicarlo: `docs/turnos/base-de-datos.md`.

## Server Component, sin API HTTP intermedia

Igual que `/mide/dashboard`: `/turnos/dashboard` es un Server Component que
llama directamente a `getTurnosDashboardData()`, que a su vez usa
`getTurnosSupabaseClient()`. No se creó ningún endpoint `/api/turnos/*` —
hacerlo habría exigido diseñar autenticación para una API HTTP nueva sin
necesidad real, cuando el acceso ya está resuelto por correr en el servidor
con sesión verificada.

`export const dynamic = "force-dynamic"` y `revalidate = 0` en la página,
igual que en MIDE: un panel operativo de reservas no debe servir una foto
vieja.

## Protección de rutas: dos capas, ninguna es "ocultar la ruta"

1. **`src/proxy.ts`** (el archivo que reemplaza a `middleware.ts` desde
   Next.js 16 — ver [aviso de deprecación](https://nextjs.org/docs/messages/middleware-to-proxy)):
   refresca la cookie de sesión de Supabase en cada request a `/turnos/*` y
   redirige a `/turnos/login` si no hay usuario. Con `matcher: ["/turnos/:path*"]`,
   **nunca** se ejecuta para `/mide/*`, `/api/mide/*`, `/api/energy-event` ni
   ninguna ruta pública.
2. **`requireTurnosUser()`** (`src/lib/turnos/auth.ts`), llamado al principio
   de `src/app/turnos/dashboard/page.tsx`: vuelve a preguntarle a Supabase
   Auth (`getUser()`, que valida el token contra el servidor, no solo decodifica
   la cookie) si hay una sesión válida, **independientemente** de lo que ya
   haya hecho `proxy.ts`. Si no hay sesión, redirige.

Ninguna de las dos capas es "la ruta no está linkeada" ni ningún mecanismo
solo visual — ambas verifican contra Supabase Auth real.

## Qué falta (documentado a propósito, no implementado ahora)

- Selector de comercio para un usuario con más de uno (hoy se toma el
  primero).
- Cualquier acción de escritura (cancelar, reprogramar, editar servicios o
  recursos): el dashboard es 100% de lectura en esta primera versión. Ver
  `docs/turnos/dashboard.md#seguridad` para qué haría falta antes de agregar
  la primera acción de escritura.
- Roles diferenciados dentro de un mismo comercio (columna `rol` sin uso
  todavía).
- Recuperación de contraseña / invitación de usuarios nuevos por UI (hoy se
  gestiona a mano desde el panel de Supabase Auth del proyecto de Turnos).
- Gráficos, estadísticas, notificaciones — explícitamente fuera de alcance
  de esta primera versión (pedido así).

Ver `docs/turnos/estado-proyecto.md` para el estado completo y los próximos
pasos sugeridos.
