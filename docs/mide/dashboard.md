# Dashboard de MIDE

**Estado: dashboard inicial / interno.** Pensado para uso propio de Nexo Sur
mientras se valida el prototipo físico de MIDE Frío, no como portal de
clientes. No tiene login — ver [pendientes](#pendientes-login-y-rls-por-usuario).

## Rutas creadas

```text
/mide                → portada: qué es MIDE, presenta MIDE Frío y MIDE Energía
/mide/dashboard       → dashboard de mide-frio-001
```

Ambas viven en `src/app/mide/` (fuera de `(public)`, `(admin)` y `(portal)`,
que son grupos de rutas sin efecto en la URL) con su propio `layout.tsx`:
una barra superior mínima (`MideTopBar`) en vez del `Navbar`/`Footer` de
marketing, y una nota de pie aclarando que es un dashboard interno.

`/mide/dashboard` apunta directo al dispositivo de desarrollo
`mide-frio-001` (constante `DEVICE_CODE` en
`src/app/mide/dashboard/page.tsx`), no a una ruta dinámica `[deviceId]`: hoy
existe un solo dispositivo de esta línea, y armar un selector de
dispositivos ahora sería sobreingeniería. La capa de datos
(`getDeviceDashboardData(deviceCode)`) ya recibe el código como parámetro,
así que sumar `/mide/dashboard/[deviceId]` más adelante es un cambio de
ruteo, no una reescritura.

## Fuentes de datos

Sin API pública nueva: el dashboard lee Supabase directamente desde
Server Components, usando el mismo cliente service-role que ya usan
`/api/mide/*` (`getMideSupabaseClient()`), a través de
`src/lib/mide/dashboard-data.ts`. Se eligió esto en vez de crear
`/api/mide/dashboard/*` porque evita exponer una API HTTP nueva sin
autenticación propia — el acceso ya está resuelto por correr en el
servidor, sin credenciales en el navegador.

`getDeviceDashboardData(deviceCode)` hace, en paralelo:

- `devices`: fila del dispositivo por `device_code` (ya usado por
  `/api/mide/*`, permisos sin cambios).
- `device_config`: umbrales y cadencia de reporte (ya usado por
  `/api/mide/*`, permisos sin cambios).
- `measurements`: métrica `temperature`, últimas 24 horas, hasta 500 filas.
  **Requiere `SELECT`, que `service_role` no tiene hoy** — ver
  [permisos](#permisos-de-supabase-necesarios).
- `events`: últimos 20 eventos del dispositivo. **También requiere `SELECT`
  nuevo.**

Cada sección se resuelve de forma independiente: si `measurements` o
`events` fallan (por ejemplo, por no tener todavía el `SELECT`), esa
sección se degrada a un estado vacío/"no disponible" en la UI en vez de
romper el resto del dashboard. El error real de Supabase se loguea en el
servidor (`console.error`), nunca se muestra al usuario ni se expone en la
respuesta.

## Estado del dispositivo (NORMAL / ALERTA / SIN DATOS / SIN CONEXIÓN)

Implementado en `src/lib/mide/status.ts`, a partir de datos reales
únicamente — no inventa alarmas ni conectividad que el dispositivo no
reportó:

1. Si no hay una medición de temperatura utilizable (no se pudo leer
   `measurements`, o no hay filas en la ventana de 24 h) → **SIN DATOS**.
2. Si no hay medición pero sí hay una desconexión detectada (ver regla de
   abajo) → **SIN CONEXIÓN** (prioridad sobre "alerta": una lectura vieja no
   debe mostrarse como si fuera confiable).
3. Si la última medición está fuera de `min_threshold`/`max_threshold`
   (de `device_config`) → **ALERTA**.
4. Si no aplica ninguno de los anteriores → **NORMAL**.

### Regla de conectividad (online / retrasado / sin conexión)

`getConnectivityTier(lastSeenAt, reportIntervalSeconds)` compara
`devices.last_seen_at` contra la cadencia de reporte **propia de cada
dispositivo** (`device_config.report_interval_seconds`), nunca un valor
absoluto fijo:

```text
fresco (online):    gap <= intervalo × 2
retrasado:           intervalo × 2  <  gap <= intervalo × 6
sin conexión:        gap  >  intervalo × 6
```

Para `mide-frio-001` (`report_interval_seconds = 300`, validado contra la
base real): online hasta 10 min sin reportar, retrasado hasta 30 min, sin
conexión pasado ese punto. Solo "sin conexión" cambia la etiqueta de estado
visible; "retrasado" no tiene su propio badge (el enunciado pide
exactamente 4 estados) — hoy no se resalta por separado en la UI, es un
tier interno disponible para usarse en una futura iteración (por ejemplo,
una nota secundaria junto a "última conexión").

Los multiplicadores (×2 / ×6) son un margen razonable elegido a mano, no
derivado de un requisito del cliente — documentado acá para poder
ajustarlo con criterio si en el uso real resulta demasiado laxo o
demasiado estricto.

## Mediciones: min/max/avg, no muestras individuales

`measurements` guarda resúmenes por período (ver
[`base-de-datos.md`](./base-de-datos.md)), así que el dashboard nunca
pretende una precisión que la base no tiene:

- **Lectura principal** (arriba, número grande): `avg_value` del período
  más reciente dentro de la ventana de 24 h.
- **Fila de métricas ("Últimas 24 horas")**: calculada en el cliente
  server-side a partir de todas las filas de la ventana
  (`computeSummaryStats` en `src/lib/mide/measurements.ts`):
  - Mínima = mínimo de todos los `min_value`.
  - Máxima = máximo de todos los `max_value`.
  - Promedio = promedio ponderado por `sample_count` de cada período
    (`Σ(avg_value × sample_count) / Σ(sample_count)`), no un promedio
    simple de promedios — un período con más muestras pesa más.
  - Muestras = suma de `sample_count`.
- **Gráfico**: una línea con el `avg_value` de cada período, y una banda
  sombreada entre `min_value` y `max_value` del mismo período. Sin
  interpolar entre muestras individuales inexistentes.
  - Los períodos se agrupan en segmentos contiguos
    (`buildChartSegments`): si el hueco entre el fin de un período y el
    inicio del siguiente supera 3× el intervalo de reporte, se corta el
    segmento — una desconexión larga se ve como un corte en el gráfico,
    no como una línea recta inventada.
  - Eje X fijo a las últimas 24 h (no solo el rango con datos), para que
    la ausencia de datos recientes sea visualmente evidente.
  - Las líneas punteadas horizontales marcan `min_threshold`/
    `max_threshold` configurados, sin números adicionales en el gráfico
    (esos valores ya se muestran en "Rango configurado" para no duplicar
    información).

## Rango configurado

Sección "Rango configurado": lee `min_threshold`/`max_threshold` de
`device_config` (nunca hardcodeado) y dibuja una barra horizontal con esos
valores como extremos y un marcador en la posición de la última lectura.
Si el dispositivo no tiene rango configurado (`null`), se muestra un texto
explícito en vez de asumir un rango por defecto.

## Eventos recientes

Lista simple (no tabla), ordenada por `started_at` descendente, hasta 20
filas. Por evento: tipo (con una traducción legible para tipos conocidos —
`TEMP_HIGH` → "Temperatura alta", etc., y un fallback genérico para tipos
futuros no listados, en `formatEventType`), severidad, inicio, fin si
existe, valor asociado si existe, y una etiqueta Abierto/Cerrado según
`status`. Sin eventos → estado vacío explícito ("Sin eventos registrados"),
nunca eventos inventados. Preparado para cualquier `event_type` futuro sin
cambios de código, porque `event_type` es texto libre en la base.

## Seguridad

- El dashboard nunca llama a Supabase desde el navegador: todo pasa por
  Server Components, con el mismo cliente service-role server-only que ya
  usa `/api/mide/*` (`SUPABASE_URL`/`SUPABASE_SECRET_KEY`, nunca expuestas
  al cliente).
- No se creó ningún endpoint HTTP público nuevo bajo `/api/mide/dashboard/*`
  ni en ningún otro lado — no había necesidad, y hacerlo habría exigido
  diseñar autenticación para una API de lectura interna sin login, lo cual
  está fuera de alcance de esta etapa.
- No se tocó RLS. Las cuatro tablas siguen con RLS habilitado y sin
  políticas públicas; `service_role` sigue siendo el único rol con acceso,
  y sigue bypasseando RLS por diseño de Supabase — no se necesitan (ni se
  agregaron) policies nuevas para que el dashboard funcione.
- `MIDE_DEVICE_API_KEY` no se usa ni se referencia en el código del
  dashboard: esa credencial es exclusiva de la autenticación de
  dispositivos en `/api/mide/*`.

## Permisos de Supabase necesarios

`service_role` hoy tiene, sobre las tablas de MIDE (ver
[`base-de-datos.md`](./base-de-datos.md#permisos-reales-en-supabase)):

```text
devices          → SELECT, UPDATE   (ya alcanza para el dashboard)
device_config    → SELECT            (ya alcanza para el dashboard)
measurements     → INSERT            (el dashboard necesita también SELECT)
events           → INSERT            (el dashboard necesita también SELECT)
```

El dashboard ya se probó contra la base real y **funciona correctamente
sin este cambio** — las secciones de mediciones, gráfico y eventos se
degradan a sus estados vacíos/"no disponible" en vez de romper la página
(ver [fuentes de datos](#fuentes-de-datos)). El SQL mínimo para que esas
secciones muestren datos reales, a aplicar manualmente en el proyecto de
Supabase real (no se ejecutó desde acá):

```sql
grant select on public.measurements to service_role;
grant select on public.events to service_role;
```

Nada más: no se pide `ALL`, no se toca RLS, no se crean políticas nuevas.
Es exactamente el complemento de mínimo privilegio a lo que `/api/mide/*`
ya tiene.

## Pendientes (login y RLS por usuario)

No implementado en esta etapa, a propósito:

- Login de MIDE, usuarios, clientes, organizaciones, planes.
- Políticas RLS para `authenticated` (solo tienen sentido una vez que
  exista un modelo de dueño usuario → cliente/organización →
  dispositivos).
- Selector de dispositivo / ruta `[deviceId]` (hoy fijo a
  `mide-frio-001`, ver [rutas creadas](#rutas-creadas)).
- Edición de configuración, alarmas activas en vivo, notificaciones,
  tiempo real (websocket/polling) — el dashboard se recarga por
  navegación, no se auto-refresca.
- Mostrar el tier "retrasado" de conectividad como su propio indicador
  (hoy es un cálculo interno sin badge propio).

## No se tocó `/api/energy-event`

Este trabajo no leyó, modificó, movió ni integró `/api/energy-event` de
ninguna forma. MIDE Energía se menciona en `/mide` solo como texto
descriptivo ("Antecedente"), sin link funcional a esa ruta ni a ningún
dato suyo.
