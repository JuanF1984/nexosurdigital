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

### Comportamiento

1. Busca el dispositivo por `device_code = deviceId`.
2. Si no existe → `404`. Si existe pero `active = false` → `403`.
3. Inserta una fila en `measurements` por cada elemento de `metrics`,
   actualiza `last_seen_at` (siempre) y `firmware_version` (si se envió),
   todo en una sola transacción (función `mide_ingest_report`, ver
   [`base-de-datos.md`](./base-de-datos.md#atomicidad-de-apimidereport)).
4. Responde con la versión de configuración actual del dispositivo.

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

Reporta un evento/alarma.

```json
{
  "deviceId": "mide-frio-001",
  "eventId": "esp32-generated-id-0001",
  "type": "TEMP_HIGH",
  "severity": "warning",
  "startedAt": "2026-08-18T08:17:32-03:00",
  "value": 8.6
}
```

| Campo       | Tipo             | Reglas                                                        |
|-------------|------------------|-----------------------------------------------------------------|
| `deviceId`  | string           | 1-64 caracteres, `[A-Za-z0-9_-]`. Debe existir.                 |
| `eventId`   | string           | 1-128 caracteres, `[A-Za-z0-9_-]`. Generado por el dispositivo. |
| `type`      | string           | `MAYUSCULAS_CON_GUION_BAJO`, ej. `TEMP_HIGH`, `POWER_LOSS`. No es un enum cerrado — cualquier tipo de evento futuro es válido si cumple el patrón. |
| `severity`  | string (enum)    | `info` \| `warning` \| `critical`.                              |
| `startedAt` | string (ISO 8601)| Obligatorio, con offset o `Z`.                                  |
| `value`     | number \| null   | Opcional.                                                        |

### Idempotencia

`device_id + event_uid` es único en la base. Si llega exactamente el mismo
`eventId` para el mismo dispositivo:

- **no** se duplica la fila,
- se responde éxito igual (`{ "ok": true, "duplicate": true }`),
- **no** se dispara una segunda notificación futura (aunque las
  notificaciones en sí no están implementadas todavía).

Esto permite que el dispositivo reintente enviar un evento si perdió la
respuesta del servidor, sin lógica adicional de su lado.

### Respuesta exitosa (`200`)

```json
{ "ok": true, "duplicate": false }
```

o, en un reintento:

```json
{ "ok": true, "duplicate": true }
```

### Errores

| Código | Motivo                                          |
|--------|--------------------------------------------------|
| `400`  | JSON inválido, campo desconocido o inválido.     |
| `401`  | Falta o no coincide `Authorization: Bearer`.     |
| `404`  | Dispositivo inexistente.                          |
| `415`  | `Content-Type` distinto de `application/json`.   |
| `500`  | Error interno.                                    |

### Pendiente

Esta primera versión solo inserta el evento inicial. No actualiza
`peak_value`, `ended_at`, `status` ni `notified_at` después de la
inserción, ni envía notificaciones nuevas — se documenta como trabajo
futuro, no se implementa ahora.

### Validado contra la base real

Se envió un evento contra `mide-frio-001` con un `eventId` nuevo:

```json
{ "ok": true, "duplicate": false }
```

y se reenvió exactamente el mismo `eventId`:

```json
{ "ok": true, "duplicate": true }
```

Igual que con `measurements`, `service_role` solo tiene `INSERT` sobre
`events` (no `SELECT`), así que no se hizo un `SELECT COUNT(*)` posterior
para contar filas. La idempotencia quedó comprobada mediante el propio
constraint de Postgres: `duplicate: true` en la respuesta solo puede
ocurrir porque el segundo `insert` chocó contra el índice único
`(device_id, event_uid)` y la API capturó ese código de error (`23505`) —
es una garantía del motor de base de datos, no solo de la lógica de la
API. Esto es justamente lo que permite que un dispositivo reintente un
evento después de perder la comunicación, sin generar una segunda fila
lógica ni una segunda notificación futura.

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
