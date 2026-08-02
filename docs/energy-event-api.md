# API `/api/energy-event`

Endpoint mínimo y aislado para recibir eventos de un dispositivo ESP32 (corte de
luz, baja tensión, restauración, estado normal) y enviar una alerta por correo
usando [Resend](https://resend.com). No usa base de datos ni panel web: solo
recibe el evento, lo valida y dispara el correo.

- Archivo: `src/app/api/energy-event/route.ts`
- Runtime: Node.js (declarado explícitamente, ya que usa `crypto.timingSafeEqual`
  y el SDK de Resend, que no son compatibles con el runtime Edge).
- Método: **solo POST**. Cualquier otro método recibe `405` automáticamente
  (comportamiento por defecto de los route handlers de Next.js cuando el
  método no está exportado).

## Variables de entorno requeridas

Ver `.env.example` en la raíz del proyecto:

```
RESEND_API_KEY=
DEVICE_API_KEY=
ALERT_EMAIL_FROM=
ALERT_EMAIL_TO=
```

- `RESEND_API_KEY`: API key de Resend (servidor únicamente, nunca se expone).
- `DEVICE_API_KEY`: secreto compartido con el ESP32. El dispositivo debe
  enviarlo como `Authorization: Bearer <DEVICE_API_KEY>`.
- `ALERT_EMAIL_FROM`: remitente del correo de alerta (debe ser un dominio/
  dirección verificada en Resend). No lo envía el ESP32.
- `ALERT_EMAIL_TO`: destinatario(s) del correo de alerta. Admite varias
  direcciones separadas por coma. No lo envía el ESP32.

Si falta alguna de estas variables en el servidor, el endpoint responde
`500` sin detallar cuál falta.

## Esquema del payload

El esquema depende de `event`. Hay dos formas posibles, mutuamente excluyentes:

### `RESTAURADO`

Reporta el ciclo completo del corte: cuándo empezó y cuándo se restauró el
servicio. **No** lleva `dateTime` (se reemplaza por `cutStartedAt`/`restoredAt`).

```
POST /api/energy-event
Content-Type: application/json
Authorization: Bearer <DEVICE_API_KEY>

{
  "deviceId": "detector-casa-01",
  "event": "RESTAURADO",
  "cutStartedAt": "2026-08-01T21:35:10-03:00",
  "restoredAt": "2026-08-01T22:12:46-03:00",
  "durationSeconds": 2256
}
```

| Campo              | Tipo              | Reglas                                                                                     |
|---------------------|-------------------|-----------------------------------------------------------------------------------------------|
| `deviceId`          | string            | 1-64 caracteres, solo `[A-Za-z0-9_-]`.                                                        |
| `event`             | `"RESTAURADO"`    | —                                                                                              |
| `cutStartedAt`      | string (ISO 8601) | Obligatorio. Debe incluir offset o `Z`.                                                       |
| `restoredAt`        | string (ISO 8601) | Obligatorio. Debe incluir offset o `Z`. Debe ser posterior o igual a `cutStartedAt`.           |
| `durationSeconds`   | number            | Obligatorio. Entero entre 0 y 604800. Debe coincidir con `restoredAt - cutStartedAt` con una tolerancia de ±2 segundos (redondeos/demoras). |

`dateTime` no debe enviarse (o debe ser `null`) para este evento.

### `CORTE`, `BAJA_TENSION`, `NORMAL` (y cualquier otro evento permitido a futuro)

Mantiene el esquema original: un único timestamp del evento.

```
POST /api/energy-event
Content-Type: application/json
Authorization: Bearer <DEVICE_API_KEY>

{
  "deviceId": "detector-casa-01",
  "event": "CORTE",
  "dateTime": "2026-08-01T17:18:55-03:00",
  "durationSeconds": null
}
```

| Campo             | Tipo             | Reglas                                                                 |
|--------------------|------------------|-------------------------------------------------------------------------|
| `deviceId`         | string           | 1-64 caracteres, solo `[A-Za-z0-9_-]`.                                  |
| `event`            | string (enum)    | `CORTE`, `BAJA_TENSION`, `NORMAL` (cualquier valor del enum salvo `RESTAURADO`). |
| `dateTime`         | string (ISO 8601)| Obligatorio. Debe incluir offset o `Z` (ej. `2026-08-01T17:18:55-03:00`).            |
| `durationSeconds`  | `null`           | Debe ser exactamente `null`. `cutStartedAt`/`restoredAt` no deben enviarse (o deben ser `null`). |

En ambos casos no se aceptan campos adicionales a los listados (el conjunto
total de campos reconocidos por la API es `deviceId`, `event`, `dateTime`,
`durationSeconds`, `cutStartedAt`, `restoredAt`; cuáles son válidos depende de
`event`).

### Ejemplos inválidos (→ `400`)

```jsonc
// cutStartedAt/restoredAt/durationSeconds obligatorios para RESTAURADO
{ "deviceId": "detector-casa-01", "event": "RESTAURADO", "durationSeconds": 2256 }

// restoredAt anterior a cutStartedAt
{
  "deviceId": "detector-casa-01",
  "event": "RESTAURADO",
  "cutStartedAt": "2026-08-01T22:12:46-03:00",
  "restoredAt": "2026-08-01T21:35:10-03:00",
  "durationSeconds": 2256
}

// durationSeconds no coincide con la diferencia real (tolerancia ±2s)
{
  "deviceId": "detector-casa-01",
  "event": "RESTAURADO",
  "cutStartedAt": "2026-08-01T21:35:10-03:00",
  "restoredAt": "2026-08-01T22:12:46-03:00",
  "durationSeconds": 100
}

// dateTime no debe enviarse junto con RESTAURADO
{
  "deviceId": "detector-casa-01",
  "event": "RESTAURADO",
  "dateTime": "2026-08-01T22:12:46-03:00",
  "cutStartedAt": "2026-08-01T21:35:10-03:00",
  "restoredAt": "2026-08-01T22:12:46-03:00",
  "durationSeconds": 2256
}

// durationSeconds solo es válido para RESTAURADO
{ "deviceId": "detector-casa-01", "event": "CORTE", "dateTime": "2026-08-01T17:18:55-03:00", "durationSeconds": 88 }

// cutStartedAt/restoredAt solo son válidos para RESTAURADO
{
  "deviceId": "detector-casa-01",
  "event": "NORMAL",
  "dateTime": "2026-08-01T17:18:55-03:00",
  "durationSeconds": null,
  "cutStartedAt": "2026-08-01T21:35:10-03:00"
}
```

### Respuesta exitosa (`200`)

```json
{ "ok": true, "emailId": "abcd-1234" }
```

### Respuestas de error

| Código | Motivo                                                              |
|--------|----------------------------------------------------------------------|
| `400`  | JSON inválido, campo desconocido o campo con formato/valor inválido. |
| `401`  | Falta el header `Authorization` o la clave no coincide.              |
| `405`  | Método distinto de `POST`.                                           |
| `415`  | `Content-Type` distinto de `application/json`.                       |
| `500`  | Error interno (config faltante o falla al enviar el correo).         |

Ninguna respuesta de error expone detalles internos, claves ni stack traces.

## Probar localmente

1. Cargar las variables de entorno en `.env.local` (no se commitea, ya está
   en `.gitignore`):

   ```
   RESEND_API_KEY=re_xxxxxxxx
   DEVICE_API_KEY=un-secreto-largo-y-aleatorio
   ALERT_EMAIL_FROM=alertas@tu-dominio-verificado.com
   ALERT_EMAIL_TO=vos@tu-correo.com
   ```

2. Levantar el server: `npm run dev`

3. Probar con el script incluido (usa `fetch` nativo de Node, no requiere
   `curl` instalado):

   ```bash
   DEVICE_API_KEY=un-secreto-largo-y-aleatorio node scripts/test-energy-event.mjs
   ```

   Por defecto envía un evento `CORTE`. Para probar `RESTAURADO` (con
   `cutStartedAt`/`restoredAt`/`durationSeconds` coherentes entre sí,
   generados automáticamente por el script):

   ```bash
   DEVICE_API_KEY=un-secreto-largo-y-aleatorio EVENT=RESTAURADO node scripts/test-energy-event.mjs
   ```

   Variables opcionales: `BASE_URL`, `EVENT`, `DEVICE_ID`, y para
   `EVENT=RESTAURADO`: `DURATION_SECONDS`, `RESTORED_AT`, `CUT_STARTED_AT`
   (ver comentarios en el propio script).

   O bien con `curl` directamente:

   ```bash
   # CORTE / BAJA_TENSION / NORMAL
   curl -i -X POST http://localhost:3000/api/energy-event \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer un-secreto-largo-y-aleatorio" \
     -d '{"deviceId":"detector-casa-01","event":"CORTE","dateTime":"2026-08-01T17:18:55-03:00","durationSeconds":null}'

   # RESTAURADO
   curl -i -X POST http://localhost:3000/api/energy-event \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer un-secreto-largo-y-aleatorio" \
     -d '{"deviceId":"detector-casa-01","event":"RESTAURADO","cutStartedAt":"2026-08-01T21:35:10-03:00","restoredAt":"2026-08-01T22:12:46-03:00","durationSeconds":2256}'
   ```

## Configurar las variables en Vercel

```bash
vercel env add RESEND_API_KEY
vercel env add DEVICE_API_KEY
vercel env add ALERT_EMAIL_FROM
vercel env add ALERT_EMAIL_TO
```

O desde el dashboard: **Project → Settings → Environment Variables**, agregando
cada una para los entornos que corresponda (Production / Preview / Development).

**Importante:** después de agregar o modificar variables de entorno en Vercel
hay que **redeployar** el proyecto (un simple restart no alcanza, Vercel solo
inyecta las variables en builds/deploys nuevos):

```bash
vercel --prod
```

o disparando un redeploy desde el dashboard.

## Fuera de alcance de esta primera versión

- No hay persistencia (Supabase u otra base de datos): cada evento solo
  dispara un correo, no queda historial.
- No hay reintentos si Resend falla; el endpoint responde `500` y el
  dispositivo/quien llame decide si reintenta.
- No hay panel web ni autenticación de usuarios humanos.
- No se implementó el firmware del ESP32.
