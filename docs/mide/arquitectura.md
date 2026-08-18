# Arquitectura de MIDE

## Qué es MIDE

MIDE es una plataforma genérica de monitoreo IoT de Nexo Sur. No existía
como módulo formal en este proyecto hasta ahora; se introduce a partir de
esta base de código (`/api/mide/*`, `supabase/migrations/*_mide_schema.sql`,
`docs/mide/*`, y desde `/mide` el dashboard inicial — ver
[`dashboard.md`](./dashboard.md)).

```text
MIDE
├── MIDE Energía   (prototipo previo, ver más abajo)
├── MIDE Frío      (primer dispositivo de la nueva arquitectura)
└── futuros productos
    ├── MIDE Aire
    └── otros
```

MIDE no es una solución exclusiva de temperatura: dispositivos, métricas y
tipos de evento son genéricos en el esquema y en la API (ver
[`base-de-datos.md`](./base-de-datos.md) y [`api.md`](./api.md)).

## MIDE Energía y `/api/energy-event`

`/api/energy-event` (`src/app/api/energy-event/route.ts`) es un prototipo
previo e independiente, usado activamente para seguir probando MIDE
Electricidad. No tiene base de datos: recibe un evento del ESP32, lo valida
y envía un email de alerta vía Resend.

`/api/energy-event` **sigue existiendo tal cual, sin cambios de contrato, de
lógica ni de dependencias**, y no forma parte de la arquitectura nueva. No
comparte código, variables de entorno, tablas ni utilidades con
`/api/mide/*`. Una eventual migración de MIDE Electricidad a la arquitectura
nueva se evaluará en el futuro; no se hizo acá.

> **Nota explícita:** durante toda la introducción de MIDE (creación de
> `/api/mide/*`, conexión con Supabase, validación contra la base real)
> `/api/energy-event` **no se modificó, no se movió, no se refactorizó, no
> se integró a `/api/mide`, no se le cambiaron variables de entorno y no se
> le cambió el contrato**. Sigue siendo la API que usa MIDE Energía hoy,
> de forma completamente independiente.

## MIDE Frío y la arquitectura nueva

MIDE Frío es el primer dispositivo construido sobre la arquitectura nueva
(`/api/mide/*` + Supabase). El dispositivo de desarrollo `mide-frio-001` es
solo el primero registrado — la arquitectura no asume que sea el único
dispositivo ni el único `device_type` posible.

## Flujo end-to-end

```text
ESP32 / dispositivo MIDE
          │
          │ HTTPS (Authorization: Bearer <MIDE_DEVICE_API_KEY>)
          ▼
    /api/mide/report   /api/mide/event   /api/mide/config
          │
          ▼
       Supabase (service role, servidor únicamente)
```

El dispositivo **nunca** se conecta directamente a Supabase. Toda escritura
y lectura pasa por la API propia, que:

- valida el dispositivo (existe, activo) y el payload,
- escribe en la base con la clave de servicio (`SUPABASE_SECRET_KEY`),
- devuelve configuración y confirma eventos,
- en el futuro, disparará notificaciones.

## Medición local vs. reporte al servidor

El dispositivo mide localmente cada pocos segundos (`sample_interval_seconds`
en `device_config`), pero **no** envía cada lectura individual: agrega
localmente y reporta un resumen periódico (`report_interval_seconds`) a
`/api/mide/report` con min/max/avg/cantidad de muestras por métrica. Ver
[`base-de-datos.md`](./base-de-datos.md#measurements).

## Funcionamiento offline esperado

La lógica crítica del dispositivo (umbrales, alarmas, hysteresis, delays de
alarma/recuperación) vive localmente en el firmware, usando la última
configuración conocida (`device_config`, versionada por `config_version`).
Si Internet está caído, el dispositivo debe poder seguir evaluando sus
propios umbrales y guardar/reintentar el envío de eventos y reportes
cuando la conexión vuelva — la idempotencia de `/api/mide/event`
(`device_id + event_uid`) existe justamente para permitir esos reintentos
sin duplicar datos. Esta lógica de firmware **no** se implementa en este
cambio (fuera de alcance).

## Web pública y dashboard inicial

Ya existen dos pantallas, ambas descriptas en detalle en
[`dashboard.md`](./dashboard.md):

```text
/mide                 → portada: qué es MIDE, MIDE Frío, MIDE Energía, futuros productos
/mide/dashboard        → dashboard inicial/interno de mide-frio-001 (sin login todavía)
```

Organización prevista a futuro, todavía no implementada:

```text
/mide/login            → privada
/mide/dispositivos     → privada
/mide/eventos          → privada
```

Cuando exista login, el modelo de acceso será:

```text
usuario autenticado → cliente/organización → dispositivos asignados
```

Usuarios, clientes, organizaciones, planes y permisos de dashboard **no**
existen todavía; solo se documenta la dirección futura. Ver también
[`seguridad.md`](./seguridad.md) sobre RLS y el rol de estos futuros
usuarios.

## Estado de implementación

Estado real, verificado contra el proyecto de Supabase existente (no contra
un entorno de prueba aparte). Ver detalle de la validación en
[`api.md`](./api.md#validación-contra-la-base-real) y de los permisos en
[`base-de-datos.md`](./base-de-datos.md#permisos-reales-en-supabase).

```text
Backend base (/api/mide/*)                    operativo
Conexión con el proyecto Supabase real         conectada
GET  /api/mide/config                          validado contra mide-frio-001
POST /api/mide/report                          validado contra mide-frio-001
POST /api/mide/event                           validado contra mide-frio-001
Idempotencia de /api/mide/event                validada (constraint único + 23505)
Atomicidad de /api/mide/report                 implementada mediante RPC mide_ingest_report
Firmware ESP32 integrado con la nueva API      pendiente
Dashboard MIDE (inicial/interno)               implementado — ver dashboard.md
Usuarios / clientes / organizaciones           pendiente
Planes y retención                             pendiente
Autenticación individual por dispositivo / HMAC pendiente
```

`/api/energy-event` queda fuera de este estado: es un sistema aparte, ya
operativo desde antes, que no se tocó (ver nota más arriba).

## Próxima etapa prevista (no implementada en este cambio)

Próximo paso técnico documentado: integrar el prototipo físico de MIDE Frío
(ESP32-C3 + DS18B20) con la API ya validada. Orden previsto:

1. Estabilizar la conexión Wi-Fi del ESP32-C3.
2. Consultar `GET /api/mide/config` al iniciar (y cuando cambie
   `configVersion`).
3. Leer el sensor DS18B20.
4. Seguir usando el RTC local del dispositivo para los timestamps.
5. Medir con la frecuencia de `sample_interval_seconds`, acumulando en RAM.
6. Acumular por período: mínimo, máximo, promedio y cantidad de muestras.
7. Enviar el primer `POST /api/mide/report` real con esos agregados.
8. Implementar, en una etapa posterior, la lógica de eventos de temperatura
   (`POST /api/mide/event`).
9. Validar funcionamiento offline y reintentos (idempotencia de eventos).

No se escribió firmware en este cambio — es una guía para el próximo paso,
no una implementación.

## Decisiones fuera de alcance de este cambio

- Firmware ESP32, dashboard, login MIDE, clientes/organizaciones/planes,
  retención automática, gráficos, notificaciones nuevas, HMAC, realtime.
- Migración de `/api/energy-event` a la arquitectura nueva.
- Refactor general del resto del proyecto.
