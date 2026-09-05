# Base de datos de MIDE

Las cuatro tablas (`devices`, `measurements`, `events`, `device_config`) ya
existían, creadas **manualmente**, en el proyecto de Supabase real que usa
esta API — junto con constraints, índices, triggers de `updated_at` y RLS.

Sobre esa misma base real ya se aplicaron, fuera de este repositorio,
directamente en Supabase:

- los permisos (`GRANT`) mínimos necesarios para el rol `service_role`
  (ver [permisos reales](#permisos-reales-en-supabase) más abajo),
- la función `public.mide_ingest_report(...)` (ver
  [atomicidad](#atomicidad-de-apimidereport) más abajo).

`/api/mide/report`, `/api/mide/event` y `/api/mide/config` ya fueron
probados contra esa base real y funcionan — el detalle de esa validación
está en [`api.md`](./api.md#validación-contra-la-base-real).

## Normalización

El esquema es relacional y normalizado a propósito: dispositivos, métricas,
fechas, valores, estados y configuración usan columnas normales, no JSONB.
La única excepción es interna a la API: `mide_ingest_report` recibe el
array `metrics` del payload como `jsonb` (es la forma natural de pasar un
array variable a una función de Postgres desde `supabase-js`), pero lo
descompone (`jsonb_array_elements`) e inserta cada métrica como una fila
normal en `measurements`. JSONB como columna persistente solo se
contempla a futuro, y únicamente para extensiones puntuales que lo
justifiquen (p. ej. metadata específica de un producto nuevo) — no como
base del diseño.

## `devices`

```text
id                UUID PK
device_code       text UNIQUE NOT NULL   -- p.ej. "mide-frio-001"
device_type       text NOT NULL          -- p.ej. "frio", "energia", "aire"
name              text NOT NULL
location          text
active            boolean NOT NULL DEFAULT true
firmware_version  text
last_seen_at      timestamptz
created_at        timestamptz NOT NULL DEFAULT now()
updated_at        timestamptz NOT NULL DEFAULT now()  -- trigger mide_set_updated_at
```

`device_type` es texto libre, no un enum cerrado: la plataforma debe poder
registrar tipos de dispositivo nuevos sin migración. `mide-frio-001` ya
existía, registrado manualmente, en el proyecto de Supabase real antes de
que existiera esta API — es el primer dispositivo usado para validar la
arquitectura nueva, no el único posible. `supabase/seed.sql` reproduce ese
mismo dispositivo solo como referencia para levantar un entorno nuevo (no
fue lo que lo creó en la base real, y no se ejecutó contra ella).

## `measurements`

Guarda **resúmenes periódicos**, no cada lectura individual del sensor. El
dispositivo mide localmente cada pocos segundos pero reporta agregados cada
`report_interval_seconds`.

```text
id            UUID PK
device_id     UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE
metric        text NOT NULL     -- "temperature", "humidity", "co2", "voltage", ...
unit          text NOT NULL     -- "C", "%", "ppm", "V", ...
period_start  timestamptz NOT NULL
period_end    timestamptz NOT NULL
min_value     numeric NOT NULL
max_value     numeric NOT NULL
avg_value     numeric NOT NULL
sample_count  integer NOT NULL
created_at    timestamptz NOT NULL DEFAULT now()
```

Constraints:

- `period_end > period_start`
- `sample_count > 0`
- `min_value <= avg_value <= max_value`
- **`unique (device_id, metric, period_start)`** — clave natural de un período
  de reporte. Da **idempotencia** a `POST /api/mide/report`: un reintento del
  ESP32 hace un upsert sobre esta fila en vez de insertar otra. Agregado por
  `20260905120000_mide_report_idempotency.sql` (que primero deduplica las
  filas ya existentes). Ver [`api.md`](./api.md#idempotencia) y
  [`analisis-prueba-prolongada/informe.md`](./analisis-prueba-prolongada/informe.md)
  §2.3.

Estas mismas reglas se validan también en `/api/mide/report` antes de
llegar a la base (ver [`api.md`](./api.md)) — los constraints son la última
línea de defensa, no la única.

Índice: `(device_id, metric, period_start desc)` para consultas por
dispositivo/métrica ordenadas en el tiempo (el patrón de acceso esperado
del futuro dashboard). Se mantiene además del índice `all-asc` que crea el
constraint único (distinto orden de columnas).

`metric` es texto libre a propósito: el diseño no está atado a
`temperature`, permite `humidity`, `co2`, `voltage`, etc. sin cambiar el
esquema.

## `events`

```text
id               UUID PK
device_id        UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE
event_uid        text NOT NULL          -- generado por el dispositivo
event_type       text NOT NULL          -- "TEMP_HIGH", "POWER_LOSS", ...
severity         text NOT NULL DEFAULT 'info'   -- info | warning | critical
started_at       timestamptz NOT NULL
ended_at         timestamptz
value_at_start   numeric
peak_value       numeric
status           text NOT NULL DEFAULT 'open'   -- open | resolved
notified_at      timestamptz
metadata         jsonb NOT NULL DEFAULT '{}'    -- metadata experimental del motor (ver abajo)
created_at       timestamptz NOT NULL DEFAULT now()
updated_at       timestamptz NOT NULL DEFAULT now()  -- trigger mide_set_updated_at
```

Constraint único: `(device_id, event_uid)`. Es intencional — permite que el
ESP32 reintente enviar el mismo evento (si perdió la respuesta del
servidor) sin generar duplicados. `/api/mide/event` se apoya en este
constraint para su idempotencia (ver [`api.md`](./api.md)).

`event_type` es texto libre (validado con un patrón `MAYUSCULA_CON_GUIONES`
en la API, no un enum cerrado en la base) para no atar la arquitectura
exclusivamente a temperatura: `TEMP_HIGH`, `TEMP_LOW`, `SENSOR_FAILURE`,
`DEVICE_STARTED`, `POWER_LOSS`, `POWER_RESTORED`, `CONNECTION_RESTORED`,
etc., son ejemplos, no una lista cerrada.

### Modelo de fila única por episodio

`/api/mide/event` ahora usa la función `mide_upsert_event` (migración
`20260905120001_mide_event_close_and_metadata.sql`): **una fila por episodio
térmico**, identificada por `(device_id, event_uid)`.

- POST sin `endedAt` → `insert` con `status = 'open'`, o no-op si ya existía.
- POST con `endedAt` (mismo `event_uid`) → `update` de **esa** fila:
  `ended_at`, `peak_value`, `severity`, `status = 'resolved'`, y `metadata`
  fusionada (`metadata || excluded.metadata`).
- POST con `endedAt` sin apertura previa → `insert` ya `resolved`.

`status` lo deriva la base de la presencia de `ended_at`; el firmware nunca lo
envía. Todo es idempotente: un reintento no crea una segunda fila ni regresa
`ended_at` / `peak_value` / `status`.

Desde `20260905120002_mide_event_notifications.sql`, `mide_upsert_event`
además **devuelve** el `id` de la fila y `value_at_start` / `peak_value` /
`started_at` / `ended_at` (mismos argumentos), para que `/api/mide/event`
arme el e-mail sin un segundo `SELECT`.

### Idempotencia de las notificaciones por e-mail (dos fases, a prueba de caídas)

`/api/mide/event` manda dos e-mails a lo largo de un episodio (ALERTA en la
apertura, RECUPERACIÓN en el cierre). Cada tipo tiene **dos** columnas: separar
"lo estoy intentando" de "ya se envió" es lo que hace que una caída del proceso
entre ambas cosas sea recuperable en vez de una notificación perdida.

> Las columnas `*_notified_at` y la primera versión de las funciones vienen de
> `20260905120002` (**ya aplicada**). Las columnas `*_notify_claimed_at`, la
> función `mide_confirm_event_notification` y el cuerpo actual (con lease) de
> `claim` / `release` los agrega `20260905120003` (**incremental, falta
> aplicar**).

```text
alert_notify_claimed_at     timestamptz   -- ALERTA: reserva / lease (efímero)
recovery_notify_claimed_at  timestamptz   -- RECUPERACIÓN: reserva / lease
alert_notified_at           timestamptz   -- ALERTA: envío CONFIRMADO (permanente)
recovery_notified_at        timestamptz   -- RECUPERACIÓN: envío CONFIRMADO
```

- `mide_claim_event_notification(id, kind)` → `boolean`: `UPDATE events SET
  <kind>_notify_claimed_at = now() WHERE <kind>_notified_at IS NULL AND
  (<kind>_notify_claimed_at IS NULL OR < now() - interval '2 minutes')`,
  devuelve `FOUND`. Gana **un** llamador → un solo worker intenta enviar; los
  reintentos concurrentes obtienen `false`. La reserva vieja (> lease) se puede
  volver a tomar: modela un worker que reservó y se cayó sin confirmar.
- `mide_confirm_event_notification(id, kind)` → `void`: `SET
  <kind>_notified_at = now(), <kind>_notify_claimed_at = null WHERE
  <kind>_notified_at IS NULL`. **Sólo se llama tras el OK del proveedor.** Un
  tipo confirmado no se reserva nunca más. Idempotente.
- `mide_release_event_notification(id, kind)` → `void`: `SET
  <kind>_notify_claimed_at = null` (si no está confirmado). La ruta lo usa
  cuando el envío falla con el proceso vivo, para no esperar el lease.
- Comportamiento ante caída: el worker muere entre `claim` y `confirm` →
  `_notified_at` sigue `NULL`, la reserva expira, el siguiente reintento del
  firmware la retoma y envía. Entrega **at-least-once** (posible duplicado raro
  si el e-mail salió justo antes de la caída).
- `alert` y `recovery` son independientes. Un cierre sin apertura previa sólo
  reserva/confirma `recovery`; las columnas de `alert` quedan `NULL`.
- La columna original `events.notified_at` (del esquema inicial) sigue sin
  usarse; se dejó intacta.

`service_role` no necesita permisos nuevos: ya tenía `update, select` sobre
`events` (de `20260905120001`).

### `events.metadata` (jsonb, experimental)

Objeto plano opcional con la metadata del motor de alarmas del firmware
(`mide-frio`, `docs/alarmas.md`): `band`, `maxDeviationC`, `trend`,
`trendSlopeCPerMin`, `reason` (`GRAVEDAD` / `PERSISTENCIA_ASCENDENTE` /
`PERSISTENCIA_ESTABLE`), `timeOutOfRangeMs`, `durationMs`. Se guarda en jsonb
—y no en columnas individuales— **a propósito**: la forma todavía se está
afinando en el Ensayo 2. Permite analizar en SQL qué banda alcanzó un
episodio, por qué alertó, con qué pendiente y cuánto duró, sin depender de los
logs serie. No construir dependencias duras sobre su forma todavía.

## `device_config`

Una fila por dispositivo (1:1, `device_id` es PK y FK).

```text
device_id                 UUID PK REFERENCES devices(id) ON DELETE CASCADE
sample_interval_seconds   integer NOT NULL
report_interval_seconds   integer NOT NULL
min_threshold              numeric
max_threshold              numeric
alarm_delay_seconds        integer
recovery_delay_seconds     integer
hysteresis                 numeric
config_version              integer NOT NULL DEFAULT 1
updated_at                  timestamptz NOT NULL DEFAULT now()  -- trigger mide_set_updated_at
```

`config_version` es la base del flujo de sincronización: `/api/mide/report`
devuelve la versión actual en cada reporte; si el dispositivo ya tiene esa
versión, no hace nada; si el servidor tiene una versión superior, el
dispositivo llama a `/api/mide/config` para obtener los valores nuevos.

**Validado contra la base real:** `GET /api/mide/config?deviceId=mide-frio-001`
devolvió `version: 1, sampleIntervalSeconds: 5, reportIntervalSeconds: 300,
minThreshold: 2, maxThreshold: 8, alarmDelaySeconds: 180,
recoveryDelaySeconds: 120, hysteresis: 0.5`. Son la configuración actual del
prototipo MIDE Frío tal como está cargada hoy en la base real — **no** son
valores universales de MIDE ni una configuración definitiva; otro
dispositivo, u otro momento de este mismo prototipo, puede tener valores
distintos.

## Atomicidad de `/api/mide/report`

El flujo "insertar N mediciones + actualizar `last_seen_at`/
`firmware_version` del dispositivo" se resuelve en una única transacción
mediante la función `public.mide_ingest_report(...)`, que **ya existe y
está aplicada en el proyecto de Supabase real** (creada directamente ahí,
no a través de la migración de este repo — ver
[migraciones y seed](#migraciones-y-seed) más abajo).

Dentro de una misma transacción, la función:

1. hace un **upsert** de las métricas recibidas en `measurements`
   (`insert ... on conflict (device_id, metric, period_start) do update`,
   quedándose con la versión de mayor `sample_count`),
2. actualiza `devices.last_seen_at`,
3. actualiza `devices.firmware_version` si el reporte la incluyó,
4. lee el `config_version` actual del dispositivo,
5. devuelve esa versión a la API, que la reenvía en la respuesta.

Al ser una única función transaccional, si cualquiera de esos pasos internos
falla, la transacción completa se aborta — no puede quedar, por ejemplo,
una medición insertada sin que se haya actualizado `last_seen_at`, ni
viceversa. Se eligió esto en vez de dos llamadas separadas desde la API
porque es una función simple y acotada, no agrega infraestructura nueva, y
evita ese escenario de estado a medio camino.

**Validado contra la base real:** un reporte válido enviado a
`POST /api/mide/report` devolvió `200` con `configVersion`, y se confirmó
por `SELECT` directo que `devices.firmware_version` y `devices.last_seen_at`
quedaron actualizados con los valores del request. La inserción en
`measurements` no se confirmó con un `SELECT` directo (ver
[permisos reales](#permisos-reales-en-supabase) — `service_role` solo tiene
`INSERT` sobre esa tabla, no `SELECT`); la evidencia es que, al ser la
misma transacción, si el insert en `measurements` hubiera fallado la
función entera habría abortado y `devices` no se habría actualizado. Detalle
completo en [`api.md`](./api.md#validación-contra-la-base-real).

Riesgo conocido y aceptado para este MVP: existe una ventana entre la
verificación de "dispositivo activo" (hecha en la API antes de llamar al
RPC) y la ejecución del RPC en la que, en teoría, el dispositivo podría
desactivarse. Dado que cada dispositivo físico reporta secuencialmente (no
hay escritura concurrente real desde el mismo dispositivo), el riesgo es
bajo; no se agregó `SELECT ... FOR UPDATE` para no sobreingenierizar. Si se
vuelve un problema real, es la mejora natural a hacer sobre esta función.

## Permisos reales en Supabase

RLS está habilitado en las cuatro tablas, sin políticas públicas — el
acceso solo es posible vía el rol `service_role`, usado exclusivamente por
`/api/mide/*` en el servidor.

Sobre ese rol se aplicaron, directamente en el proyecto real, los permisos
**mínimos** que la API efectivamente necesita — ni más ni menos — con
criterio de mínimo privilegio:

```text
devices          → SELECT, UPDATE
measurements     → INSERT, UPDATE            (UPDATE: upsert idempotente de /report)
events           → INSERT, UPDATE, SELECT    (UPDATE + SELECT: upsert + RETURNING de /event)
device_config    → SELECT
```

`measurements.UPDATE` y `events.UPDATE, SELECT` los **agregan las migraciones
`20260905120000` / `20260905120001`** (van al final de cada archivo, junto a
la función); `20260905120002` / `20260905120003` no agregan grants sobre
tablas (reusan `events.UPDATE, SELECT`), sólo `grant execute` de sus
funciones a `service_role`. `mide_ingest_report` y `mide_upsert_event` corren
`SECURITY INVOKER` (con los privilegios de `service_role`, misma postura que
antes) y ahora hacen `INSERT ... ON CONFLICT DO UPDATE`; `mide_upsert_event`
además tiene `RETURNING`. Sin esos grants, los upserts fallan con
`permission denied`. Aplicar a mano sobre la base real junto con la migración.

El dashboard inicial (`/mide/dashboard`, ver [`dashboard.md`](./dashboard.md))
ya usa `SELECT` sobre `events` (que este cambio habilita) y todavía necesita
`SELECT` sobre `measurements` — ese documento tiene el SQL para aplicarlo a
mano cuando se decida.

No hay acceso `anon`/`authenticated` todavía — eso solo tiene sentido
cuando exista login de MIDE y un modelo de dueño (cliente/organización →
dispositivos asignados), que no se implementa en este cambio. Ver
[`seguridad.md`](./seguridad.md).

## Migraciones y seed

`supabase/migrations/20260818000000_mide_schema.sql` fue reconstruida a
partir del diseño definido durante el desarrollo de MIDE, **no** mediante
una introspección automática de la base real — la base real ya existía,
creada manualmente, antes de escribir esa migración. Por lo tanto:

- **no debe aplicarse ciegamente** sobre el proyecto de Supabase actual
  (de hecho, no se aplicó — los permisos y la función `mide_ingest_report`
  se agregaron directamente en la base real, por fuera de esta migración),
- debe considerarse principalmente una **referencia reproducible** para
  levantar un entorno nuevo (desarrollo, staging, CI) desde cero,
- antes de usarla sobre una base ya existente, debe compararse a mano
  contra el esquema real.

Migraciones posteriores (mismo criterio — **aplicar a mano** sobre la base
real, previo diff):

- `20260905120000_mide_report_idempotency.sql` — deduplica `measurements`,
  agrega `unique (device_id, metric, period_start)` y convierte
  `mide_ingest_report` en un upsert idempotente.
- `20260905120001_mide_event_close_and_metadata.sql` — agrega
  `events.metadata jsonb` y la función `mide_upsert_event` (modelo de fila
  única por episodio: abrir y luego cerrar/recuperar con el mismo `event_uid`).
- `20260905120002_mide_event_notifications.sql` — **ya aplicada a mano.**
  Primera versión de la notificación por e-mail: columnas
  `events.alert_notified_at` / `recovery_notified_at`, funciones
  `mide_claim_event_notification` / `mide_release_event_notification` (claim de
  una sola columna: la misma marca sirve de "reservado" y de "enviado"), y
  `mide_upsert_event` con `RETURN` ampliado (mismos argumentos).
- `20260905120003_mide_event_notification_lease.sql` — **incremental sobre
  `120002` ya aplicada; falta aplicar.** Hace la idempotencia a prueba de
  caídas: agrega `alert_notify_claimed_at` / `recovery_notify_claimed_at`
  (reserva con lease de 2 min), la función `mide_confirm_event_notification`
  (marca de envío confirmado), y reescribe con `create or replace` (mismas
  firmas) el cuerpo de `mide_claim_event_notification` (sella la reserva) y
  `mide_release_event_notification` (libera la reserva). No recrea columnas ni
  cambia firmas. `grant execute` sólo para la función nueva.

`supabase/seed.sql` es un archivo distinto, con datos de desarrollo/testing
(entre ellos el dispositivo `mide-frio-001` y el fixture de dispositivo
inactivo `mide-test-inactivo-001` usado por `scripts/test-mide.mjs`) — no
debe confundirse con el esquema. Tampoco se ejecutó contra la base real; el
`mide-frio-001` real ya existía de antes por fuera de este archivo.

## Históricos y retención (futuro, no implementado)

Idea documentada para más adelante, no implementada:

- La telemetría detallada (`measurements`) podría retenerse según el plan
  del cliente (ej. 30 días de detalle en plan básico, varios meses o
  histórico extendido en planes superiores).
- Estrategia posible: detalle de 5 minutos para los últimos 0–30 días,
  agregado diario para lo más antiguo.
- `events` podría conservarse más tiempo que `measurements`.
- Nada de esto implica planes, suscripciones, cron de limpieza ni
  agregados diarios en este cambio — son ideas a evaluar, no trabajo
  pendiente inmediato.
