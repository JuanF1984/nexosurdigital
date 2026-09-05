# API `/api/mide/*`

Namespace nuevo, independiente de `/api/energy-event` (que sigue existiendo
sin cambios — ver [`arquitectura.md`](./arquitectura.md)). La API es
genérica: no hay rutas por producto (`/api/mide/frio/...`), un mismo
contrato sirve para cualquier `device_type`.

Todas las rutas corren en runtime Node.js (`export const runtime = "nodejs"`)
porque usan `crypto.timingSafeEqual`. Todos los ejemplos de este documento
son ficticios.

## Validación contra la base real

Las tres rutas ya se probaron contra el proyecto de Supabase real (no un
entorno aparte), después de que se aplicaran ahí los permisos mínimos de
`service_role` y la función `mide_ingest_report` (ver
[`base-de-datos.md`](./base-de-datos.md#permisos-reales-en-supabase)).

> **Ensayo 2 (pendiente de re-validar contra la base real):** `/api/mide/event`
> (fila única por episodio: apertura + cierre/recuperación, `metadata jsonb`) y
> `/api/mide/report` (idempotencia con `unique` + upsert) cambiaron. Están
> cubiertos por **tests automatizados** (`vitest`, `src/**/route.test.ts` +
> `src/lib/mide/validation.test.ts`, con un doble en memoria del cliente
> Supabase). Falta aplicar a mano las migraciones `20260905120000` /
> `20260905120001` y sus `grant` sobre la base real y repasar
> `scripts/test-mide.mjs` contra ella.

Se ejecutó `scripts/test-mide.mjs`:

```text
17 casos totales
15/17 casos completamente verificados contra la base real
```

Los 2 casos restantes son ambos "dispositivo inactivo" (`/report` y
`/config`) y quedaron **pendientes de verificación**, no fallidos por un
bug: dependen de un dispositivo fixture, `mide-test-inactivo-001`, que
solo existe en `supabase/seed.sql`, y ese seed no se aplicó sobre la base
real (a propósito — no se creó un dispositivo artificial en la base real
solo para satisfacer estos tests). Como ese `device_code` no existe, la API
responde correctamente `404` (dispositivo inexistente) en vez de `403`
(dispositivo inactivo) — es el comportamiento esperado dado que el
dispositivo no existe, no evidencia de un bug en la distinción entre
"inexistente" e "inactivo". Esos dos casos podrán completarse cuando exista
un dispositivo inactivo real, o en un entorno de desarrollo/CI donde sí se
aplique el seed.

Además de la batería automática, se hicieron verificaciones manuales
puntuales contra la base real — el detalle de cada una está en la sección
de cada endpoint más abajo.

## Autenticación

Las tres rutas requieren:

```
Authorization: Bearer <MIDE_DEVICE_API_KEY>
```

Es un secreto compartido entre todos los dispositivos MIDE, comparado con
`timingSafeEqual` (mismo patrón que `/api/energy-event`, pero con su propia
variable de entorno — no se reutiliza `DEVICE_API_KEY`). Ver
[`seguridad.md`](./seguridad.md) sobre por qué esto es interino.

## `POST /api/mide/report`

Reporta un resumen periódico de una o más métricas.

```json
{
  "deviceId": "mide-frio-001",
  "firmwareVersion": "0.1.0",
  "periodStart": "2026-08-18T08:00:00-03:00",
  "periodEnd": "2026-08-18T08:05:00-03:00",
  "metrics": [
    { "metric": "temperature", "unit": "C", "min": 3.7, "max": 4.2, "avg": 3.9, "samples": 60 }
  ]
}
```

| Campo             | Tipo             | Reglas                                                               |
|-------------------|------------------|-----------------------------------------------------------------------|
| `deviceId`        | string           | 1-64 caracteres, `[A-Za-z0-9_-]`. Debe existir y estar activo.        |
| `firmwareVersion` | string \| null   | Opcional. 1-32 caracteres si se envía.                                |
| `periodStart`     | string (ISO 8601)| Obligatorio, con offset o `Z`.                                        |
| `periodEnd`       | string (ISO 8601)| Obligatorio, con offset o `Z`. Debe ser posterior a `periodStart`.     |
| `metrics`         | array            | No vacío, máximo 20 elementos.                                        |

Cada elemento de `metrics`:

| Campo     | Tipo   | Reglas                                            |
|-----------|--------|-----------------------------------------------------|
| `metric`  | string | minúsculas, `[a-z][a-z0-9_]*`, ej. `temperature`.   |
| `unit`    | string | ej. `C`, `%`, `ppm`, `V`.                            |
| `min`     | number | —                                                    |
| `max`     | number | —                                                    |
| `avg`     | number | Debe cumplir `min <= avg <= max`.                    |
| `samples` | number | Entero positivo.                                     |

No se aceptan campos desconocidos, ni en el cuerpo ni en cada elemento de
`metrics`.

No se acepta la **misma `metric` dos veces** en un mismo reporte (`400`): el
upsert idempotente no puede tocar dos veces la misma fila lógica en una sola
sentencia.

### Comportamiento

1. Busca el dispositivo por `device_code = deviceId`.
2. Si no existe → `404`. Si existe pero `active = false` → `403`.
3. Hace un **upsert** de una fila en `measurements` por cada elemento de
   `metrics` sobre la clave natural `(device_id, metric, period_start)`,
   actualiza `last_seen_at` (siempre) y `firmware_version` (si se envió),
   todo en una sola transacción (función `mide_ingest_report`, ver
   [`base-de-datos.md`](./base-de-datos.md#atomicidad-de-apimidereport)).
4. Responde con la versión de configuración actual del dispositivo.

### Idempotencia

`(device_id, metric, period_start)` es **único** en `measurements`. Un reintento
del ESP32 (no recibió el `200` a tiempo) **no** crea otra fila:

- reintento idéntico → la fila queda igual (update no-op);
- reintento que además combinó una ventana más larga en el dispositivo
  (mismo `period_start`, `period_end` más tardío y `sample_count` mayor) →
  se queda la versión **más completa**;
- reintento más viejo o más corto que lo ya guardado → se ignora
  (`sample_count` menor); no se pierde el dato bueno.

Esto corrige el hallazgo del primer ensayo prolongado (40 grupos de
mediciones duplicadas por reintentos, ~1,5 % de las filas; ver
[`analisis-prueba-prolongada/informe.md`](./analisis-prueba-prolongada/informe.md)
§2.3). Migración: `supabase/migrations/20260905120000_mide_report_idempotency.sql`
(incluye la deduplicación de las filas ya existentes antes de crear el
constraint).

### Respuesta exitosa (`200`)

```json
{ "ok": true, "configVersion": 1 }
```

### Errores

| Código | Motivo                                                                  |
|--------|----------------------------------------------------------------------|
| `400`  | JSON inválido, campo desconocido, o payload que no cumple las reglas de arriba (incluye `min <= avg <= max`, `periodEnd > periodStart`, `samples > 0`, etc. — validado en la API, no solo en la base). |
| `401`  | Falta o no coincide `Authorization: Bearer`.                          |
| `403`  | Dispositivo inactivo.                                                  |
| `404`  | Dispositivo inexistente.                                               |
| `415`  | `Content-Type` distinto de `application/json`.                        |
| `500`  | Error interno (config faltante, error de Supabase).                   |

### Validado contra la base real

Se envió un reporte válido contra `mide-frio-001` (con un `firmwareVersion`
distinguible) y se comprobó:

- respuesta `200` con `ok: true` y `configVersion` presente,
- por `SELECT` directo sobre `devices`: `firmware_version` quedó igual al
  valor enviado, y `last_seen_at` se actualizó al momento del request,
- payload con dos métricas en el mismo reporte también respondió `200`,
- todos los casos inválidos probados (JSON inválido, fecha inválida,
  período invertido, `samples = 0`, `min > avg`, `avg > max`, dispositivo
  inexistente) devolvieron el código esperado, confirmando que la API
  valida el payload **antes** de depender de los constraints de Postgres.

La inserción en `measurements` **no se confirmó con un `SELECT` posterior**
— `service_role` solo tiene `INSERT` sobre esa tabla (ver
[`base-de-datos.md`](./base-de-datos.md#permisos-reales-en-supabase)), a
propósito, porque la API nunca necesita leerla. La evidencia de que la
medición sí se insertó es indirecta pero sólida: `mide_ingest_report`
inserta primero en `measurements` y recién después actualiza `devices`
dentro de la misma transacción; como la actualización de `devices` sí se
confirmó y la respuesta fue exitosa, el insert previo tuvo que completarse
también (si hubiera fallado, la transacción entera se habría abortado y
`devices` no se habría actualizado).

## `POST /api/mide/event`

Abre **o** cierra un episodio térmico. **Una fila por episodio**, identificada
por `(device_id, event_uid)`. El primer POST (sin `endedAt`) crea/abre; un POST
posterior con el **mismo `eventId`** más `endedAt` (+ `peakValue`) actualiza y
**resuelve la misma fila**.

Apertura:

```json
{
  "deviceId": "mide-frio-001",
  "eventId": "mide-frio-001-h812345678",
  "type": "TEMP_HIGH",
  "severity": "critical",
  "startedAt": "2026-08-18T08:17:32-03:00",
  "value": -9.78,
  "metadata": { "reason": "GRAVEDAD", "band": 2, "maxDeviationC": 5.22,
                "trend": "ASCENDIENDO", "trendSlopeCPerMin": 0.61,
                "timeOutOfRangeMs": 240000 }
}
```

Cierre / recuperación (mismo `eventId`):

```json
{
  "deviceId": "mide-frio-001",
  "eventId": "mide-frio-001-h812345678",
  "type": "TEMP_HIGH",
  "severity": "critical",
  "startedAt": "2026-08-18T08:17:32-03:00",
  "endedAt": "2026-08-18T08:42:10-03:00",
  "peakValue": -8.10,
  "metadata": { "reason": "GRAVEDAD", "band": 2, "maxDeviationC": 6.90,
                "durationMs": 1480000 }
}
```

| Campo       | Tipo             | Reglas                                                        |
|-------------|------------------|-----------------------------------------------------------------|
| `deviceId`  | string           | 1-64 caracteres, `[A-Za-z0-9_-]`. Debe existir.                 |
| `eventId`   | string           | 1-128 caracteres, `[A-Za-z0-9_-]`. Generado por el dispositivo, estable entre reintentos y reinicios. |
| `type`      | string           | `MAYUSCULAS_CON_GUION_BAJO`, ej. `TEMP_HIGH`, `POWER_LOSS`. No es un enum cerrado. |
| `severity`  | string (enum)    | `info` \| `warning` \| `critical`.                              |
| `startedAt` | string (ISO 8601)| Obligatorio, con offset o `Z`.                                  |
| `value`     | number \| null   | Opcional. Temperatura al disparo de la alerta.                  |
| `endedAt`   | string (ISO 8601) \| null | **Opcional.** Si está presente, este POST **cierra** el episodio. No puede ser anterior a `startedAt`. |
| `peakValue` | number \| null   | Opcional. Temperatura pico del episodio (se manda en el cierre). |
| `metadata`  | objeto \| null   | Opcional. Objeto **plano** (sólo valores escalares), ≤ 20 claves, claves ≤ 40 car., strings ≤ 64 car., ≤ 1 KB serializado. Metadata experimental del motor de alarmas. |

`status` lo **deriva el backend**: `resolved` si el POST trae `endedAt`,
`open` si no. El firmware nunca envía `status`.

Sigue siendo un **contrato estricto**: cualquier campo fuera de esa lista → `400`.

### Idempotencia y modelo de fila única

`(device_id, event_uid)` es único. Todo POST es idempotente:

| Situación | Efecto |
|---|---|
| 1er POST sin `endedAt` | crea la fila, `status = open`. Respuesta `{ ok, duplicate: false }`. |
| Reintento de la apertura (mismo `eventId`, sin `endedAt`) | no crea otra fila, no regresa nada. Respuesta `{ ok, duplicate: true }`. |
| POST con `endedAt` sobre una fila abierta | actualiza **esa** fila: `ended_at`, `peak_value`, `status = resolved`, `metadata` fusionada. Respuesta `{ ok, resolved: true, created: false }`. |
| POST con `endedAt` sin apertura previa | crea la fila ya `resolved` (caso "cierre antes que apertura"). Respuesta `{ ok, resolved: true, created: true }`. |
| Reintento del cierre | idempotente, la fila queda igual. |

`metadata` se **fusiona** (`||` de jsonb): los valores de la apertura y los
finales del cierre conviven en la misma fila.

Esto permite que el ESP32 reintente cualquier POST tras perder la respuesta del
servidor, sin lógica adicional de su lado, y sin duplicar filas ni
notificaciones futuras.

### Respuesta exitosa (`200`)

Apertura: `{ "ok": true, "duplicate": false }` (o `duplicate: true` en un
reintento). Cierre: `{ "ok": true, "resolved": true, "created": false }`
(o `created: true` si el cierre llegó antes que la apertura).

### Errores

| Código | Motivo                                          |
|--------|--------------------------------------------------|
| `400`  | JSON inválido, campo desconocido o inválido (incluye `endedAt` anterior a `startedAt`, `metadata` no plana o demasiado grande). |
| `401`  | Falta o no coincide `Authorization: Bearer`.     |
| `404`  | Dispositivo inexistente.                          |
| `415`  | `Content-Type` distinto de `application/json`.   |
| `500`  | Error interno.                                    |

Migración: `supabase/migrations/20260905120001_mide_event_close_and_metadata.sql`
(agrega `events.metadata jsonb` y la función `mide_upsert_event`).

### Notificaciones

Sin cambios: las notificaciones a usuario siguen sin implementarse. El
endpoint sólo persiste el evento y su cierre.

### Validado contra la base real

**Contrato anterior (una sola inserción, 6 campos):** se validó contra
`mide-frio-001` que un `eventId` nuevo respondía `{ ok: true, duplicate: false }`
y un reenvío del mismo `eventId` respondía `{ ok: true, duplicate: true }`, con
la idempotencia garantizada por el índice único `(device_id, event_uid)`
(código `23505`).

**Contrato actual (fila única por episodio, con `endedAt` / `peakValue` /
`metadata` y la función `mide_upsert_event`):** validado con tests
automatizados en `src/app/api/mide/event/route.test.ts` (vitest) contra un
doble en memoria que reproduce el constraint único y la semántica del upsert:
apertura → `open`; reintento de apertura → `duplicate: true` sin segunda fila;
cierre con el mismo `eventId` → **la misma fila** pasa a `resolved` con
`ended_at`/`peak_value`; cierre antes que la apertura → fila creada ya
`resolved`; `metadata` fusionada entre apertura y cierre. **Pendiente:**
re-validar contra la base real de Supabase una vez aplicada la migración
`20260905120001` y sus `grant` (`update, select on events to service_role`).

## `GET /api/mide/config`

Devuelve la configuración del dispositivo indicado.

```
GET /api/mide/config?deviceId=mide-frio-001
Authorization: Bearer <MIDE_DEVICE_API_KEY>
```

### Respuesta exitosa (`200`)

```json
{
  "ok": true,
  "version": 1,
  "sampleIntervalSeconds": 5,
  "reportIntervalSeconds": 300,
  "minThreshold": 2,
  "maxThreshold": 8,
  "alarmDelaySeconds": 180,
  "recoveryDelaySeconds": 120,
  "hysteresis": 0.5
}
```

### Errores

| Código | Motivo                                                           |
|--------|---------------------------------------------------------------|
| `400`  | `deviceId` ausente o con formato inválido.                     |
| `401`  | Falta o no coincide `Authorization: Bearer`.                    |
| `403`  | Dispositivo inactivo.                                            |
| `404`  | Dispositivo inexistente, o sin fila en `device_config`.         |
| `500`  | Error interno.                                                    |

### Validado contra la base real

`GET /api/mide/config?deviceId=mide-frio-001` devolvió exactamente la
respuesta del ejemplo de arriba. Esos valores son la configuración
**actual del prototipo MIDE Frío**, tal como está cargada hoy en la base
real — no son valores universales de MIDE ni una configuración definitiva
para todo dispositivo futuro.

El caso "dispositivo inactivo" (`403`) quedó pendiente de verificación
contra la base real por falta del fixture correspondiente — ver
[Validación contra la base real](#validación-contra-la-base-real) al
principio de este documento.

### Versionado de configuración

Flujo previsto: `/api/mide/report` siempre devuelve `configVersion`. Si el
dispositivo ya tiene esa versión aplicada localmente, no hace nada más. Si
el servidor tiene una versión superior a la que el dispositivo conoce,
recién ahí el dispositivo llama a `GET /api/mide/config` para traer los
valores nuevos.

## Convenciones comunes a las tres rutas

- Ninguna respuesta de error expone detalles internos, claves ni stack
  traces (mismo criterio que `/api/energy-event`).
- No se aceptan campos desconocidos en el cuerpo (rechazo estricto, no se
  ignoran silenciosamente).
- Todas las fechas son ISO 8601 con offset obligatorio (`Z` o `±HH:MM`).
