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

Estas mismas reglas se validan también en `/api/mide/report` antes de
llegar a la base (ver [`api.md`](./api.md)) — los constraints son la última
línea de defensa, no la única.

Índice: `(device_id, metric, period_start desc)` para consultas por
dispositivo/métrica ordenadas en el tiempo (el patrón de acceso esperado
del futuro dashboard).

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

En esta primera versión, `/api/mide/event` solo inserta (`value_at_start`);
no actualiza `peak_value`, `ended_at`, `status` ni `notified_at` después de
la inserción inicial — eso queda documentado como pendiente (ver
[`api.md`](./api.md#pendiente)), no implementado ahora.

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

1. inserta las métricas recibidas en `measurements`,
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
measurements     → INSERT
events           → INSERT
device_config    → SELECT
```

Esto es intencional, no un descuido: `service_role` **no** tiene permiso de
`SELECT` sobre `measurements` ni sobre `events`, porque ninguna ruta de
`/api/mide/*` necesita leer esas tablas hoy (solo insertar). El dashboard
inicial (`/mide/dashboard`, ver [`dashboard.md`](./dashboard.md)) sí
necesita leerlas — ese documento tiene el SQL mínimo (`grant select ...`)
para aplicar a mano cuando se decida ampliar estos permisos; no se aplicó
automáticamente desde acá.

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
