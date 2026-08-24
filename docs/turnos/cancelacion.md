# Cancelación de reservas desde el dashboard

**Estado:** implementado. Primera acción de escritura del dashboard de
Turnos (hasta ahora 100% de lectura, ver `docs/turnos/arquitectura.md`).

## Qué es y qué no es

`nexosur-web` **no reimplementa** la lógica de cancelación. Esa lógica ya
existe, está probada (35/35 tests) y vive en un proyecto separado,
`nexosur-turnos` (en disco: `Proyectos/whatsapp-demo`, el mismo proyecto que
corre el bot de WhatsApp — ver `docs/turnos/arquitectura.md` sobre esa
separación):

- `src/domain/cancellation/cancelarTurno.js` — operación de dominio pura,
  idempotente, sin DELETE (solo `estado -> 'cancelado'`).
- `api/turnos/cancelar.js` — endpoint HTTP que expone esa operación:
  `POST /api/turnos/cancelar`, protegido con
  `Authorization: Bearer <TURNOS_API_TOKEN>`.

`nexosur-web` actúa como **consumidor autorizado** de ese endpoint: resuelve
si el usuario del dashboard puede cancelar ese turno puntual, y si puede,
llama al endpoint. Nunca hace `UPDATE` sobre `turnos` directamente.

## Autenticación de usuario vs. autenticación backend-to-backend

Estos son dos mecanismos distintos, deliberadamente separados — confundirlos
sería el error de seguridad más probable en este flujo:

| | Qué autentica | Mecanismo | Dónde vive |
|---|---|---|---|
| **Autenticación del usuario del dashboard** | Que la persona que hace clic en "Cancelar reserva" es un usuario real de Turnos con sesión válida | Supabase Auth (`requireTurnosUser()`) | `nexosur-web`, en cada invocación de la Server Action |
| **Autorización del usuario sobre el comercio/turno** | Que ese usuario puede tocar *este* turno puntual | `usuario_comercios` + lectura del `comercio_id` real del turno | `nexosur-web`, en cada invocación de la Server Action |
| **Autenticación backend-to-backend** | Que quien llama a `POST /api/turnos/cancelar` es un backend de confianza (`nexosur-web`), no cualquiera en internet | Secreto compartido `TURNOS_API_TOKEN` (`Authorization: Bearer`) | `nexosur-turnos`, valida el header en cada request |

El punto crítico: `TURNOS_API_TOKEN` **no representa al usuario**. Es un
secreto fijo compartido entre los dos backends — cualquier llamada con ese
token es indistinguible de cualquier otra para `nexosur-turnos`. Si
`nexosur-web` llamara al endpoint con un `comercioId` que no verificó contra
el usuario real, cualquier usuario autenticado (de cualquier comercio)
podría cancelar turnos de cualquier otro comercio con solo cambiar un
parámetro. Por eso la autorización por usuario ocurre **siempre en
`nexosur-web`, antes de la llamada backend-to-backend** — nunca se delega en
`nexosur-turnos`, que no tiene forma de validar el JWT de Supabase Auth del
dashboard (son dos proyectos de Supabase distintos, con dos Auth distintos).

## Flujo completo

```text
Usuario dashboard (click "Cancelar reserva")
      │  confirmación explícita (window.confirm)
      ▼
CancelReservationButton ("use client")
      │  invoca la Server Action con solo el turnoId
      ▼
cancelReservationAction (src/app/turnos/dashboard/actions.ts, "use server")
      │
      ├─ 1) requireTurnosUser()          → ¿hay sesión válida? (Supabase Auth de Turnos)
      ├─ 2) getComerciosForUser(user.id) → ¿qué comercio(s) puede administrar?
      ├─ 3) getTurnoOwnership(turnoId)   → lectura propia: ¿a qué comercio pertenece
      │                                      este turno de verdad? (nunca se confía en
      │                                      un comercioId mandado por el cliente)
      ├─ 4) turno.comercioId ∈ comercios autorizados del usuario?
      │       no → "No encontramos esa reserva." (mismo mensaje que "no existe",
      │            para no filtrar qué turnos existen en otros comercios)
      │       sí → sigue
      ▼
cancelTurnoRemote (src/lib/turnos/cancellation.ts)
      │  POST /api/turnos/cancelar
      │  Authorization: Bearer TURNOS_API_TOKEN
      │  body: { comercioId, turnoId }   (comercioId resuelto en el paso 3, nunca el
      │                                    que mandó el cliente — el cliente nunca
      │                                    manda comercioId, ni siquiera lo conoce)
      ▼
nexosur-turnos: api/turnos/cancelar.js
      │  valida el token compartido
      ▼
cancelarTurno() → Supabase de Turnos → turnos.estado = 'cancelado'
```

`turnoId` es el único dato que viaja desde el navegador hasta la Server
Action. Todo lo demás (usuario, comercio autorizado, comercio real del
turno) se resuelve server-side en cada invocación — no hay ningún paso que
confíe en un valor recibido del cliente para decidir autorización.

## Archivos nuevos

- `src/lib/turnos/cancellation.ts` — `getTurnoOwnership(turnoId)` (lectura
  propia para autorización) y `cancelTurnoRemote({ comercioId, turnoId })`
  (la llamada backend-to-backend con `TURNOS_API_TOKEN`). Server-only: usa
  `getTurnosSupabaseClient()` (service role) y `fetch` con `TURNOS_API_TOKEN`,
  ninguno de los dos disponible fuera del servidor.
- `src/app/turnos/dashboard/actions.ts` — `cancelReservationAction(turnoId)`,
  Server Action (`"use server"`) que orquesta los 4 pasos de arriba. Único
  punto de entrada para cancelar: no existe otro camino (ni API HTTP nueva en
  `nexosur-web`, ni escritura directa a Supabase desde ningún componente).
- `src/components/turnos/CancelReservationButton.tsx` — Client Component:
  confirmación (`window.confirm`), estado de carga (`useTransition`), y
  feedback inline (éxito/error) tras la respuesta de la Server Action.
  `router.refresh()` tras un éxito para reflejar el nuevo estado sin recargar
  la página completa.

## Archivos modificados

- `src/components/turnos/ReservationsList.tsx` — agrega
  `<CancelReservationButton>` por cada reserva con `estado === "confirmado"`
  (una reserva ya cancelada no ofrece la acción). El listado sigue mostrando
  reservas canceladas (con su badge rojo existente) — no se filtran, mismo
  criterio que ya documentaba `docs/turnos/dashboard.md`.
- `.env.example` / `.env.local` — variables nuevas, ver más abajo.

## Variables de entorno nuevas

```text
TURNOS_API_URL
TURNOS_API_TOKEN
```

No existían nombres equivalentes en `nexosur-web` (se confirmó antes de
implementar — el proyecto solo tenía `TURNOS_SUPABASE_*`, sin ninguna
variable relacionada con una API HTTP de Turnos). Estos nombres coinciden
exactamente con lo que ya usa `nexosur-turnos` internamente para su propia
variable `TURNOS_API_TOKEN` (ver `docs/configuracion.md` de ese proyecto) —
mismo secreto, cargado en ambos proyectos.

| Variable | Uso | Dónde se lee |
|---|---|---|
| `TURNOS_API_URL` | URL base del backend `nexosur-turnos` (su deployment de Vercel). Se le concatena `/api/turnos/cancelar` | `src/lib/turnos/cancellation.ts` |
| `TURNOS_API_TOKEN` | Secreto compartido enviado como `Authorization: Bearer <TURNOS_API_TOKEN>`. Autentica la llamada backend-to-backend — no representa al usuario (ver sección de arriba). Debe ser **el mismo valor** que `TURNOS_API_TOKEN` en `nexosur-turnos` | `src/lib/turnos/cancellation.ts` |

Sin estas dos variables, `cancelTurnoRemote` devuelve `{ ok: false, reason:
"config" }` sin llamar a `fetch` — el usuario ve el mensaje genérico de
error, nunca un 500 crudo ni un detalle de configuración.

**No se guardó ningún valor real en este documento ni en el repo** — solo
los nombres, en `.env.example`. Los valores reales van en `.env.local`
(gitignored, ya con placeholders vacíos) y en Vercel (ver recordatorio al
final).

## Validaciones cubiertas

| # | Caso | Dónde se resuelve | Resultado |
|---|---|---|---|
| 1 | Usuario no autenticado | `requireTurnosUser()` | Redirige a `/turnos/login` (mismo comportamiento que el resto del dashboard) |
| 2 | Usuario autenticado sin comercio autorizado | `getComerciosForUser` devuelve `[]` | Mensaje genérico de error, no se llega a leer el turno |
| 3 | Turno inexistente | `getTurnoOwnership` devuelve `null` | "No encontramos esa reserva." |
| 4 | Turno de otro comercio | `turno.comercioId` no está en los comercios autorizados | "No encontramos esa reserva." (mismo mensaje que el caso 3, para no filtrar información) |
| 5 | Turno ya cancelado | El backend responde `{ ok: true, alreadyCancelled: true }` (idempotente) | Se trata como éxito: "Esa reserva ya estaba cancelada." — nunca un error |
| 6 | Cancelación válida | Backend responde `{ ok: true }` | "Reserva cancelada.", `revalidatePath("/turnos/dashboard")`, `router.refresh()` en el cliente |
| 7 | Backend de Turnos no disponible | `fetch` rechaza (red/timeout, 10s) | `reason: "unavailable"` → mensaje genérico |
| 8 | Respuesta inesperada del backend | JSON inválido o `status`/`error` no contemplado | `reason: "unexpected"` → mensaje genérico, detalle solo en `console.error` del servidor |
| 9 | Configuración faltante | Falta `TURNOS_API_URL` o `TURNOS_API_TOKEN` | `reason: "config"` → mensaje genérico, nunca un 500 crudo |
| 10 | Doble intento de cancelación | El backend es idempotente por diseño (`cancelarTurno`); además el botón se deshabilita mientras hay una cancelación en curso (`isPending`) | El segundo intento (dos clics rápidos, dos pestañas) devuelve `alreadyCancelled: true`, no un error |

Ningún mensaje de error expone el `TURNOS_API_TOKEN`, un stack trace, ni
detalles internos del backend — el detalle real solo se loguea server-side
con `console.error` (nunca se envía al cliente).

## Qué NO se tocó

- **MIDE**: ningún archivo de `src/lib/mide/*`, `src/app/mide/*`,
  `src/components/mide/*`, ni sus variables de entorno
  (`SUPABASE_URL`/`SUPABASE_SECRET_KEY`/`MIDE_DEVICE_API_KEY`). Turnos y MIDE
  siguen usando conexiones Supabase completamente separadas.
- **Lecturas del dashboard**: `getTurnosDashboardData` no cambió — el
  dashboard sigue leyendo `turnos` directo de Supabase, no se migró a la API
  de `nexosur-turnos`. Solo la cancelación (una escritura) pasa por esa API.
- **`nexosur-turnos`**: no se modificó ningún archivo de ese proyecto — ya
  tenía el endpoint listo y documentado para este consumo (ver
  `docs/arquitectura.md` de ese proyecto, que ya mencionaba "Dashboard Nexo
  Sur (futuro, otro proyecto)" como consumidor esperado).
- No se creó ningún endpoint `/api/turnos/*` nuevo **en `nexosur-web`** — la
  cancelación es una Server Action, consistente con que el resto del
  dashboard tampoco tiene una API HTTP intermedia propia (ver
  `docs/turnos/arquitectura.md`).
- No se implementó selector de comercio, reprogramación, IA, ni ningún ítem
  de "Fuera de alcance" — solo la acción de cancelar.

## Tests

Se agregó Vitest (`pnpm add -D vitest`, `pnpm test` → `vitest run`) — el
proyecto no tenía ningún test runner configurado antes de esta sesión.

- `src/lib/turnos/cancellation.test.ts` — `getTurnoOwnership` (turno
  existente, inexistente, error de Supabase) y `cancelTurnoRemote` (llamada
  con el header correcto, éxito, idempotencia, `not_found`, `conflict`,
  backend caído, respuesta no-JSON, status/código no contemplado,
  configuración faltante).
- `src/app/turnos/dashboard/actions.test.ts` — `cancelReservationAction` con
  todas las dependencias mockeadas: los 10 casos de la tabla de arriba,
  incluyendo explícitamente que un turno de un comercio ajeno nunca llega a
  `cancelTurnoRemote` y que el mensaje de error no expone el token ni
  detalles internos.

**Resultado:** `pnpm test` → 23/23 tests OK. También se corrió
`pnpm exec tsc --noEmit` (limpio), `pnpm run lint` (0 errores, solo 2
warnings preexistentes sin relación con este cambio) y `pnpm run build`
(compila y genera `/turnos/dashboard` y `/turnos/login` igual que antes,
`/mide` y `/mide/dashboard` sin cambios). Se verificó además que
`TURNOS_API_TOKEN`, `cancelTurnoRemote` y `getTurnoOwnership` no aparecen en
`.next/static/*` (bundle de cliente) tras el build.

No se probó contra el backend real de `nexosur-turnos` desplegado (no había
`TURNOS_API_URL`/`TURNOS_API_TOKEN` reales cargados en esta sesión) — ver
"Pendientes" en `docs/turnos/estado-proyecto.md`.
