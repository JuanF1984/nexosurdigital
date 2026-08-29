# Firmware MIDE Frío: OTA + motor de alarmas — impacto en backend / configuración

**Origen:** cambios en el firmware `mide-frio` (repo aparte, `Documentos/arduino/mide-frio`),
versión `0.2.0-dev`. Este documento resume **qué necesita o va a necesitar del
lado de Nexo Sur**. No se modificó ningún endpoint ni la base en esta etapa;
es una lista de trabajo futuro coordinada.

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

### 1.1 Metadata que hoy NO cabe en el contrato (propuesta, no implementada)

El motor produce información que sería muy útil tener en `events` para el
Ensayo 2 y para afinar la lógica, pero el contrato actual rechaza campos
desconocidos. **Propuesta de extensión** (a decidir; el firmware la puede
mandar en cuanto el backend la acepte):

| Campo sugerido | Tipo | Significado |
|---|---|---|
| `band` | `0\|1\|2` | banda de gravedad alcanzada (desviación sobre el umbral) |
| `maxDeviationC` | number | desviación máxima del episodio (°C sobre el umbral) |
| `trend` | `"ASCENDIENDO"\|"ESTABLE"\|"RECUPERANDO"` | tendencia al momento de alertar |
| `trendSlopeCPerMin` | number | pendiente estimada (°C/min) |
| `timeOutOfRangeMs` | number | tiempo fuera de rango al alertar |
| `reason` | `"GRAVEDAD"\|"PERSISTENCIA_ASCENDENTE"\|"PERSISTENCIA_ESTABLE"` | motivo del disparo |

Y al **cerrar** el episodio (hoy el firmware sólo lo loguea; el contrato no
tiene "update de evento"): `endedAt`, `peakValue`, `durationMs`, `hadAlert`.
La tabla `events` ya tiene columnas `ended_at`, `peak_value`, `status` sin
usar — encajaría un `PATCH`/segundo `POST` idempotente para cerrar.

Mientras no exista, toda esa metadata queda sólo en los logs serie `[ALARM]`
del dispositivo.

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
- El **fallback local** del firmware sigue siendo `min 2 / max 8` (perfil
  heladera). El prototipo es un freezer con config real `-15 / -25`. Mientras
  el dispositivo no tenga la config del servidor (primeros ~30 s tras
  encender, o si `/config` falla), el motor de alarmas usa el fallback y con
  un freezer a −18…−15 °C simplemente **no dispara**. En cuanto llega la
  config real pasa a −15. No es un bug, pero conviene tenerlo presente; si se
  quiere, se puede alinear el fallback del firmware al perfil de despliegue.

## 4. Resumen: qué hay que hacer y cuándo

| Ítem | Bloquea Ensayo 2 | Bloquea OTA real | Bloquea producción |
|---|---|---|---|
| Nada (enviar eventos con el contrato actual) | — | — | — |
| Extender contrato de `/api/mide/event` con metadata del motor | no (nice to have) | no | recomendable |
| Cierre de evento (`ended_at`, `peak_value`) | no | no | recomendable |
| Host de manifiesto + binarios HTTPS + CA | no | **sí** | sí |
| `firmwareChannel` / rollout por dispositivo en `/config` | no | no | recomendable |
| Firma del binario + Secure Boot | no | no | **sí (antes de comercializar)** |
