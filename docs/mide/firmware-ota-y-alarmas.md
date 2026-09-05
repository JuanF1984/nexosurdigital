# Firmware MIDE Frío: OTA + motor de alarmas — impacto en backend / configuración

**Origen:** cambios en el firmware `mide-frio` (repo aparte, `Documentos/arduino/mide-frio`),
versión `0.2.1-dev`. Este documento resume **qué necesita o va a necesitar del
lado de Nexo Sur**.

> **Actualización (Ensayo 2):** ya se implementó, coordinado entre firmware y
> backend, la parte de **eventos** (fila única por episodio: abrir → alerta →
> cerrar/recuperar, idempotente, con `events.metadata jsonb`) y la
> **idempotencia de `/api/mide/report`**. Ver [`api.md`](./api.md) y
> [`base-de-datos.md`](./base-de-datos.md). Lo de **OTA** sigue pendiente y
> desactivado (secciones 2 y siguientes, sin cambios).

> Todo lo del firmware está **desactivado por defecto**: OTA no consulta nada,
> el motor de alarmas evalúa y loguea pero **no** hace `POST /api/mide/event`
> (`MIDE_ALARM_SEND_EVENTS=0`). Nada de esto afecta a producción hoy.

## 1. Motor de alarmas → `POST /api/mide/event`

El firmware ya arma eventos con el **contrato estricto actual**, sin cambios:

```json
{
  "deviceId": "mide-frio-001",
  "eventId":  "mide-frio-001-h812345678",
  "type":     "TEMP_HIGH",
  "severity": "critical" | "warning",
  "startedAt": "2026-08-29T14:12:22-03:00",
  "value":    -9.78
}
```

- `eventId` = `"<deviceId>-h<stampInicioEpisodio>"`, determinístico y estable
  entre reintentos y reinicios → la **idempotencia por `(device_id, event_uid)`
  que ya existe** hace todo el trabajo. No hace falta nada nuevo para esto.
- `severity`: `GRAVEDAD` → `critical`; `PERSISTENCIA_ASCENDENTE` /
  `PERSISTENCIA_ESTABLE` → `warning`.
- Un episodio genera **un** evento (no uno por lectura).

### 1.1 Metadata del motor — IMPLEMENTADO

El contrato de `/api/mide/event` ahora acepta 3 campos **opcionales**:
`endedAt`, `peakValue` y `metadata` (objeto jsonb plano). Ver
[`api.md`](./api.md#post-apimideevent).

- **Apertura** (POST sin `endedAt`): `metadata` con `band`, `maxDeviationC`,
  `trend`, `trendSlopeCPerMin`, `reason`, `timeOutOfRangeMs`.
- **Cierre/recuperación** (POST con el mismo `eventId` + `endedAt` +
  `peakValue`): `metadata` con `reason`, `band` (máx), `maxDeviationC` (máx),
  `durationMs`. Se **fusiona** con la de la apertura en la misma fila.
- `status` (`open` / `resolved`) lo deriva el backend de la presencia de
  `endedAt`; el firmware no lo manda.

La tabla `events` ganó una columna `metadata jsonb` (migración
`20260905120001`). Se eligió jsonb —y no columnas escalares— porque la forma
todavía se está afinando en el Ensayo 2.

### 1.2 Notificaciones

Sin cambios respecto de lo ya documentado en `api.md`: las notificaciones a
usuario siguen sin implementarse. El firmware sólo inserta el evento.

## 2. OTA → infraestructura nueva (no existe hoy)

El firmware trae un servicio OTA por **pull HTTPS de un manifiesto**
(`ota_service`, ver `mide-frio/docs/ota.md`). Hoy está en modo *dry-run* y
además **deshabilitado por compilación**. Para usarlo de verdad hace falta,
del lado de Nexo Sur:

### 2.1 Host de actualizaciones (HTTPS)

- `GET https://<host>/mide-frio/manifest.json`:
  ```json
  {
    "version": "0.3.0",
    "url": "https://<host>/mide-frio/0.3.0/firmware.bin",
    "sha256": "<64 hex del .bin>",
    "sizeBytes": 1123456,
    "minVersion": "0.2.0"
  }
  ```
- El `.bin` servido con `Content-Length` correcto y `Content-Type` cualquiera.
- Certificado TLS cuya **CA raíz** se pueda embeber en el firmware
  (`MIDE_OTA_ROOT_CA_PEM` en `secrets.h`). Sin CA embebida el firmware **no
  descarga** (salvo modo laboratorio explícito).
- Podría ser un bucket estático (S3/R2/Vercel Blob) + CDN; no necesita lógica.

### 2.2 Opción: integrar el versionado a `/api/mide/config`

En vez de (o además de) un host aparte, `GET /api/mide/config` podría devolver:

| Campo nuevo sugerido | Uso |
|---|---|
| `firmwareChannel` | `"stable"` / `"beta"` — para despliegues graduales |
| `targetFirmwareVersion` | fija a qué versión debe converger este dispositivo |
| `firmwareManifestUrl` | override de la URL del manifiesto por dispositivo |

Esto permitiría **rollout por dispositivo** sin re-flashear la flota entera y
sin hardcodear la URL en cada unidad. Es una decisión de arquitectura a tomar
(hoy el firmware usa una URL única de `secrets.h`).

### 2.3 Firma del binario (seguridad, futuro)

Hoy la confianza en el `.bin` es: TLS al host correcto + verificación de
**SHA-256** publicado por ese host. **No hay firma criptográfica.** Para
tenerla hace falta:

- firmar el `.bin` en el pipeline de build de firmware;
- embeber la clave pública en el firmware y verificar la firma antes de
  instalar (idealmente + Secure Boot v2 del ESP32-C3);
- eso además habilita compilar el bootloader con rollback automático real.

Es trabajo de infraestructura de firmware, no de `nexosur-web`, pero se
menciona acá para que quede en el panorama.

### 2.4 Reporte del resultado del update

No hace falta nada nuevo: `POST /api/mide/report` ya manda `firmwareVersion`
en cada reporte, así que el backend/dashboard puede ver qué versión corre cada
dispositivo y detectar un update fallido (versión que no cambió o que volvió
atrás).

## 3. Configuración: `device_config` de `mide-frio-001`

Sin cambios requeridos. Notas:

- El motor de alarmas usa `max_threshold` (umbral alto), `hysteresis` y
  `recovery_delay_seconds` **tal como están**. Todo lo demás (bandas,
  tolerancias) es experimental y vive en el firmware, no en la config.
- El **fallback local** del firmware ya **no** es perfil heladera. Ahora, al
  arrancar, la prioridad es: (1) última config válida persistida en NVS de un
  `/config` anterior; (2) si no hay, fallback de fábrica **perfil freezer**
  `min -25 / max -15`. En ambos casos se sigue pidiendo `/config` y, cuando
  llega, reemplaza y se re-persiste. Un freezer que arranca offline ya no
  queda ciego con un perfil +2/+8. (Firmware `0.2.1-dev`, ver
  `mide-frio/docs/firmware.md`.)

## 4. Resumen: qué hay que hacer y cuándo

| Ítem | Estado | Bloquea OTA real | Bloquea producción |
|---|---|---|---|
| Enviar eventos (apertura) con idempotencia por `eventId` | **hecho** | — | — |
| Contrato de `/api/mide/event` con metadata del motor (`metadata jsonb`) | **hecho** (`20260905120001`) | no | — |
| Cierre/recuperación de evento (`ended_at`, `peak_value`, `status`) | **hecho** (`mide_upsert_event`) | no | — |
| Idempotencia de `/api/mide/report` (`unique` + upsert) | **hecho** (`20260905120000`) | no | — |
| Aplicar migraciones + grants a la base real (manual) | **pendiente operativo** | no | sí |
| Host de manifiesto + binarios HTTPS + CA | pendiente | **sí** | sí |
| `firmwareChannel` / rollout por dispositivo en `/config` | pendiente | no | recomendable |
| Firma del binario + Secure Boot | pendiente | no | **sí (antes de comercializar)** |
