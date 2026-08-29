# Análisis de la prueba prolongada — MIDE Frío (`mide-frio-001`)

**Tipo de trabajo:** análisis de solo lectura sobre la base de Supabase real de MIDE. No se modificó, insertó, actualizó ni borró ningún registro. No se aplicaron migraciones ni cambios de configuración, firmware, backend o dashboard.

**Fecha del análisis:** 29/08/2026.
**Zona horaria usada en todo el documento:** `America/Argentina/Buenos_Aires` (ART, UTC-3, sin horario de verano).

---

## 0. Cómo se identificó el dispositivo y los umbrales (antes de analizar)

Antes de escribir cualquier consulta se revisó la documentación del proyecto (`docs/mide/*.md`) y el esquema real (`supabase/migrations/20260818000000_mide_schema.sql`), y luego se confirmó todo contra la base real (no se asumió nada de la documentación sin verificarlo):

- **Dispositivo:** la tabla `devices` tiene **una sola fila**: `device_code = "mide-frio-001"`, `device_type = "frio"`, `name = "MIDE Frío Prototipo"`, `active = true`. No hay ambigüedad: es el único dispositivo de tipo "frio" (y el único dispositivo, punto) que existe en la base. No hubo que elegir entre candidatos.
- **Umbrales realmente vigentes:** se leyó `device_config` para ese dispositivo directamente de la base:

  ```
  sample_interval_seconds = 5
  report_interval_seconds = 300
  min_threshold           = -25
  max_threshold           = -15
  alarm_delay_seconds     = 180
  recovery_delay_seconds  = 120
  hysteresis              = 0.5
  config_version          = 2   (updated_at 2026-08-18T20:21:16Z = 17:21:16 ART)
  ```

  **Importante:** el umbral alto de **-15 °C coincide** con lo que se indicó, pero el umbral bajo real es **-25 °C, no -18 °C**. Este informe usa los valores confirmados en `device_config` (-15 / -25), no los -18 °C mencionados de memoria. `config_version` no volvió a cambiar durante todo el período analizado, así que estos umbrales estuvieron vigentes de forma constante del 19 al 28/08.
- La única fila de `device_config` fue actualizada por última vez ~14 minutos después del primer reporte del dispositivo (17:07:11 → 17:21:16 ART del 18/08), lo cual es consistente con que ese primer día fue de instalación/configuración, tal como se indicó.

---

## 1. Inspección de datos

| Ítem | Valor |
|---|---|
| Primer registro histórico del dispositivo | **2026-08-18 17:07:11 ART** (2026-08-18T20:07:11Z) |
| Último registro histórico disponible (al momento de extraer los datos) | **2026-08-29 10:24:04 ART** (dispositivo sigue reportando hoy) |
| Total de registros históricos (`measurements`, `metric = temperature`, este dispositivo) | **3132** |
| Registros del primer día (18/08, excluido) | 86 (17:07:11 → 23:57:15 ART — día parcial, confirma instalación/configuración) |
| Registros de hoy (29/08, excluido) | 125 (00:00 → 10:24 ART al momento de la extracción) |
| Registros dentro del período de análisis (19/08 00:00 – 28/08 23:59:59 ART) | 2921 crudos → **2878 después de deduplicar** (ver §2.3) |
| Campos disponibles por registro (`measurements`) | `id, device_id, metric, unit, period_start, period_end, min_value, max_value, avg_value, sample_count, created_at` |
| Cadencia configurada (firmware, `device_config`) | muestreo local cada **5 s** (`sample_interval_seconds`), reporte agregado cada **300 s / 5 min** (`report_interval_seconds`) |
| Cadencia real observada (período analizado, deduplicado) | media **300,25 s**, mediana **300,0 s** — prácticamente idéntica a la configurada |

### Naturaleza de los datos

`measurements` **no** guarda cada lectura del sensor: el dispositivo mide cada 5 s pero reporta un **resumen agregado cada 5 minutos** (`min_value`, `max_value`, `avg_value`, `sample_count`). Esto está documentado en `docs/mide/base-de-datos.md` y se confirmó con los datos reales (`sample_count` ronda 60 = 300 s / 5 s). Todo el análisis de este informe trabaja a esa resolución de 5 minutos, no a nivel de muestra individual — se aclara explícitamente en cada sección donde es relevante.

---

## 2. Calidad y continuidad de los datos

### 2.1 Intervalo entre reportes (período analizado, deduplicado, n=2877 intervalos)

| Métrica | Valor |
|---|---|
| Promedio | 300,25 s |
| Mediana | 300,0 s |
| Mínimo | 300,0 s |
| Máximo | 600,0 s |
| Desvío estándar | 7,52 s |
| Intervalos > 150 s por encima de lo esperado (gap real de comunicación) | **1** |

### 2.2 Huecos de comunicación

Se midió el hueco real como el tiempo entre el fin de un período (`period_end`) y el inicio del siguiente (`period_start`) — así se distingue un hueco real de la variación normal de ±unos segundos en el cierre de cada ventana de 5 minutos.

**Todos los huecos > 1 s en el período (hay exactamente uno):**

| Desde (ART) | Hasta (ART) | Duración |
|---|---|---|
| 2026-08-23 13:13:15 | 2026-08-23 13:17:45 | 4,5 min (270 s) |

Tiempo total sin datos en los 10 días: **4,5 minutos sobre 240 horas → 0,031 % del período.** Conectividad excelente y estable; no hay huecos grandes ni recurrentes que sugieran problemas de Wi-Fi.

### 2.3 Registros duplicados / sospechosamente próximos

Se encontraron **40 grupos de registros duplicados** (43 filas de más) dentro del período: pares (y 3 tríos) de filas con el **mismo `period_start`**, `min/max/avg` casi o exactamente iguales, y `created_at` separados por **6 a 90 segundos**. Ejemplo típico:

```
period_start = 2026-08-19T17:07:22Z
  id 261, created_at 17:11:17.546  avg=-15.98542
  id 262, created_at 17:11:23.597  avg=-15.98542   (mismos min/max/avg)
```

**Causa probable (confirmada en el código, no solo hipótesis):** `docs/mide/api.md` documenta que `POST /api/mide/report` **no tiene protección de idempotencia** (a diferencia de `/api/mide/event`, que sí tiene un constraint único `device_id + event_uid`). Si el ESP32 reintenta un envío porque no recibió confirmación a tiempo, el servidor inserta una fila nueva cada vez. Esto es coherente con separaciones de segundos entre duplicados. **Es un hallazgo de software, no un problema térmico ni de sensor.**

Para el resto del análisis se deduplicó quedándose con la fila de `id` más alto de cada grupo (la más completa/reciente). 2921 → 2878 filas.

### 2.4 Valores faltantes y anómalos

- **Nulls:** 0 filas con `null` en `min_value`, `max_value`, `avg_value`, `sample_count`, `period_start` o `period_end`, en toda la tabla.
- **Violaciones de `min ≤ avg ≤ max`:** 0.
- **Temperaturas fuera de rango físico plausible** (< -40 °C o > 25 °C, umbral generoso para un freezer): 0.
- **`sample_count`:** esperado ≈ 60 (300 s / 5 s). Distribución real: 2558/2878 filas (89 %) con exactamente 60; el resto entre 51 y 59, y una cola pequeña de 57 filas (2 %) por debajo de 55, con un mínimo de 32 y un caso puntual de 85 (asociado a uno de los duplicados de §2.3, donde el segundo envío acumuló muestras de una ventana más larga). Es variación menor del firmware al cerrar cada ventana, no pérdida de datos: no hay períodos vacíos ni con `sample_count = 0`.

**Conclusión de esta sección:** los problemas de calidad encontrados son de **software de ingesta** (falta de idempotencia en `/api/mide/report`) y de **jitter menor de firmware**, no de conectividad real ni del sensor de temperatura.

---

## 3. Análisis térmico general (19/08 00:00 – 28/08 23:59:59 ART, deduplicado, n=2878 períodos de 5 min)

| Métrica | Valor |
|---|---|
| Cantidad de mediciones (períodos de 5 min) | 2878 (171.615 muestras crudas de 5 s subyacentes) |
| Temperatura mínima absoluta (`min_value`) | **-25,875 °C** — 2026-08-28 19:33:56 ART |
| Temperatura máxima absoluta (`max_value`) | **-3,8125 °C** — 2026-08-24 13:18:01 ART |
| Promedio (ponderado por `sample_count`, sobre `avg_value`) | **-18,29 °C** |
| Mediana | -18,07 °C |
| Desvío estándar | 2,86 °C |
| P5 / P25 / P75 / P95 | -23,19 / -20,28 / -16,28 / -14,36 °C |

*Metodología:* el mínimo/máximo absolutos usan `min_value`/`max_value` de cada período (capturan picos breves dentro de la ventana de 5 s). El promedio, mediana, desvío y percentiles se calculan sobre `avg_value` de cada período de 5 minutos — es la resolución nativa de los datos; no existen muestras de 5 s almacenadas.

### 3.1 Resumen diario

CSV completo: [`datos/resumen_diario.csv`](./datos/resumen_diario.csv).

| Fecha | Períodos | Mín (°C) | Máx (°C) | Prom. pond. (°C) | Mediana (°C) | Desvío | Períodos avg>-15 | Períodos min<-25 |
|---|---|---|---|---|---|---|---|---|
| 19/08 | 288 | -24,88 | -9,56 | -19,34 | -19,41 | 2,72 | 6 | 0 |
| 20/08 | 288 | -24,38 | -10,75 | -19,62 | -19,76 | 2,30 | 6 | 0 |
| 21/08 | 288 | -24,38 | -9,94 | -18,72 | -18,51 | 2,05 | 7 | 0 |
| 22/08 | 287 | -24,19 | -8,50 | -17,44 | -17,13 | 2,56 | 45 | 0 |
| 23/08 | 287 | -24,38 | -8,38 | -17,79 | -17,26 | 2,74 | 23 | 0 |
| 24/08 | 288 | -22,88 | -3,81 | -16,49 | -15,91 | 2,15 | 67 | 0 |
| 25/08 | 288 | -23,69 | -5,69 | -17,42 | -17,41 | 2,86 | 57 | 0 |
| 26/08 | 288 | -24,88 | -6,56 | -18,38 | -18,14 | 3,13 | 24 | 0 |
| 27/08 | 288 | -24,81 | -4,06 | -18,11 | -17,87 | 2,95 | 18 | 0 |
| 28/08 | 288 | -25,88 | -7,69 | -19,53 | -19,44 | 3,17 | 7 | **15** |

**Patrón visible:** los días 22–25/08 concentran muchos más períodos por encima del umbral alto que el resto (ver §5). El día 28/08 es el único con incursiones por debajo de -25 °C.

---

## 4. Umbrales: episodios térmicos

Umbrales usados (confirmados en `device_config`, §0): **alto = -15 °C**, **bajo = -25 °C**. Las mediciones consecutivas que cruzan un umbral se agrupan en **episodios** (no se cuenta cada período de 5 min como un evento independiente).

### 4.1 Umbral alto (-15 °C)

- **Criterio de episodio:** períodos consecutivos con `avg_value > -15 °C`.
- **Episodios detectados:** **43**
- **Tiempo total por encima del umbral:** 21,67 h sobre 240 h → **9,03 % del período**
- **Períodos de 5 min con `avg_value > -15 °C`:** 260 de 2878 (9,03 %)
- Además, **49 períodos** tuvieron un pico breve (`max_value > -15 °C`) sin que el promedio del período llegara a superar el umbral — quedan fuera del conteo de episodios pero indican oscilaciones cortas cerca del límite.

**10 episodios más relevantes (mayor duración):**

| Inicio (ART) | Fin (ART) | Duración | Pico (°C) | Momento del pico | Prom. episodio (°C) | Pico → normal |
|---|---|---|---|---|---|---|
| 25/08 08:08:12 | 25/08 09:53:13 | 105 min | -5,69 | 09:28:13 | -12,61 | 25 min |
| 22/08 09:42:59 | 22/08 11:13:00 | 90 min | -13,25 | 10:58:00 | -14,02 | 15 min |
| 23/08 20:57:50 | 23/08 22:07:52 | 70 min | -8,38 | 21:07:50 | -11,64 | 60 min |
| 25/08 10:13:13 | 25/08 11:23:14 | 70 min | -11,50 | 11:13:14 | -13,34 | 10 min |
| 22/08 12:08:00 | 22/08 13:08:01 | 60 min | -13,75 | 12:58:01 | -14,32 | 10 min |
| 27/08 19:58:44 | 27/08 20:48:44 | 50 min | -4,06 | 20:23:44 | -10,08 | 25 min |
| 24/08 13:18:01 | 24/08 14:03:01 | 45 min | **-3,81** (máx. absoluto) | 13:18:01 | -12,23 | 45 min |
| 26/08 10:23:24 | 26/08 11:08:25 | 45 min | -6,56 | 10:48:24 | -10,84 | 20 min |
| 22/08 07:37:58 | 22/08 08:17:59 | 40 min | -14,31 | 08:12:59 | -14,68 | 5 min |
| 24/08 08:27:58 | 24/08 09:07:58 | 40 min | -14,06 | 09:02:58 | -14,58 | 5 min |

Lista completa (43 episodios altos + 5 bajos) en [`datos/episodios_termicos.csv`](./datos/episodios_termicos.csv).

### 4.2 Umbral bajo (-25 °C)

- **Criterio de episodio:** períodos consecutivos con `min_value < -25 °C`.
- **Episodios detectados:** **5**, y los **5 ocurren el mismo día, 28/08**, entre las 14:58 y las 21:08 ART.
- **Tiempo total por debajo del umbral:** 75 min sobre 240 h → 0,52 % del período.

| Inicio (ART) | Fin (ART) | Duración | Pico frío (°C) | Momento |
|---|---|---|---|---|
| 28/08 14:58:53 | 28/08 15:08:53 | 10 min | -25,25 | 14:58:53 |
| 28/08 16:28:54 | 28/08 16:43:54 | 15 min | -25,56 | 16:38:54 |
| 28/08 17:53:55 | 28/08 18:13:55 | 20 min | -25,63 | 18:08:55 |
| 28/08 19:18:56 | 28/08 19:38:56 | 20 min | **-25,88** (mín. absoluto) | 19:33:56 |
| 28/08 20:58:57 | 28/08 21:08:57 | 10 min | -25,44 | 21:03:57 |

Ningún otro día del período tuvo incursiones por debajo de -25 °C — es un patrón exclusivo del último día analizado (ver §6).

---

## 5. Ciclos del freezer

**Método:** se detectaron máximos y mínimos locales en la serie de `avg_value` (resolución de 5 min) con `scipy.signal.find_peaks` (prominencia ≥ 1 °C, separación mínima 15 min), y se armaron ciclos "valle → pico → valle". Se detectaron **137 ciclos** en los 10 días. Su amplitud (pico − valle) tiene una distribución con una masa densa entre 3,5 y 8 °C y una cola dispersa hasta 19 °C; se usó **8 °C como corte** (quiebre visible en el histograma) para separar:

- **119 ciclos "normales"** (amplitud 3,5–7,9 °C) → interpretados como el ciclo de compresión/descompresión habitual del equipo.
- **18 ciclos de amplitud grande** (8,5–19 °C) → coinciden en tiempo con los episodios del §4.1. **Hipótesis, no confirmado:** son compatibles con aperturas de puerta u otra manipulación física, pero **no hay sensor de puerta**, así que esto es una interpretación, no un hecho verificado.

Este corte de 8 °C es una elección basada en la forma de la distribución de esta muestra, no un valor universal — queda documentado para que pueda ajustarse con criterio si aparecen más datos.

### 5.1 Ciclos normales — estadísticas (n=119)

| Métrica | Media | Mediana | Mín | Máx |
|---|---|---|---|---|
| Amplitud (°C) | 5,67 | 5,77 | 3,49 | 7,89 |
| Duración total del ciclo | 98,5 min | 95,0 min | 35 min | 170 min |
| Tiempo de descenso (pico→valle, enfriando) | 27,8 min | 25,0 min | 5 min | 90 min |
| Tiempo de ascenso (valle→pico, sin enfriar activamente) | 70,6 min | 70,0 min | 10 min | 145 min |
| Temperatura del pico (tope del ciclo) | -16,34 °C | -16,15 °C | -19,96 °C | -12,10 °C |
| Temperatura del valle (piso del ciclo) | -21,72 °C | -21,61 °C | -25,69 °C | -16,50 °C |

**Rango habitual de oscilación:** aproximadamente **-22 °C a -16 °C**, con el ciclo completo (enfriar + recuperar) tardando en promedio poco más de 1,5 horas. El tiempo de ascenso (~70 min) es sistemáticamente mayor que el de descenso (~28 min): el equipo enfría relativamente rápido y luego permanece "en reposo" (sin refrigerar activamente) un tiempo más largo antes de volver a activarse — patrón típico de un ciclo de termostato con carga térmica moderada.

### 5.2 Estabilidad y deriva del patrón

Ver comparación cuantitativa completa en §6. En resumen: la **amplitud media de los ciclos normales crece de forma progresiva** a lo largo del ensayo (4,85 °C → 5,69 °C → 6,62 °C entre el primer, segundo y tercer tramo de días). Esto es un **patrón observado**, no necesariamente una falla — es consistente con varias causas posibles (acumulación de escarcha en el evaporador, mayor carga térmica ambiente, mayor frecuencia de aperturas ya desde antes del 29/08, cambios en el ciclo del compresor) que **no se pueden distinguir con los datos disponibles** (no hay sensor de puerta, temperatura ambiente ni corriente del compresor).

---

## 6. Evolución durante la prueba (primeros días / intermedios / últimos días)

Segmentos: **Primeros** = 19–21/08 (3 días) · **Intermedios** = 22–25/08 (4 días) · **Últimos** = 26–28/08 (3 días).

### 6.1 Temperatura general

| Segmento | Mín (°C) | Máx (°C) | Prom. ponderado (°C) | Mediana (°C) | Desvío |
|---|---|---|---|---|---|
| Primeros (19-21/08) | -24,88 | -9,56 | -19,22 | -19,16 | 2,40 |
| Intermedios (22-25/08) | -24,38 | **-3,81** | **-17,28** | -16,87 | 2,64 |
| Últimos (26-28/08) | **-25,88** | -4,06 | -18,67 | -18,46 | 3,14 |

### 6.2 Episodios sobre umbral alto

| Segmento | Episodios | Tiempo total | Promedio por día |
|---|---|---|---|
| Primeros | 4 | 1,58 h | **0,53 h/día** |
| Intermedios | 30 | 16,00 h | **4,00 h/día** |
| Últimos | 9 | 4,08 h | **1,36 h/día** |

### 6.3 Amplitud y forma de los ciclos normales

| Segmento | N ciclos normales | Amplitud media | Amplitud mediana | Pico medio | Valle medio |
|---|---|---|---|---|---|
| Primeros | 38 | 4,85 °C | 4,91 °C | -17,55 °C | -22,19 °C |
| Intermedios | 49 | 5,69 °C | 5,69 °C | -15,47 °C | -20,73 °C |
| Últimos | 32 | 6,62 °C | 6,74 °C | -16,22 °C | -22,66 °C |

### 6.4 Conectividad

| Segmento | Huecos > 1 s | Tiempo total sin datos |
|---|---|---|
| Primeros | 0 | 0 min |
| Intermedios | 1 | 4,5 min |
| Últimos | 0 | 0 min |

**Lectura conjunta:** la conectividad fue perfecta en todo el ensayo (no hay deriva ahí). El comportamiento térmico sí muestra cambios:

1. **El tramo intermedio (22-25/08) concentra la enorme mayoría de los episodios sobre umbral alto** (30 de 43, con 4 h/día en promedio contra ~0,5–1,4 h/día en los otros tramos) y el promedio más alto del período. Esto sugiere que **ya hubo actividad de prueba/manipulación física dentro de la ventana que se definió como "válida"** (22–25/08), no solo el 29/08 que se excluyó explícitamente. Es un hallazgo a tener en cuenta si se busca un tramo "limpio" para caracterizar el comportamiento basal del equipo: los días 19-21 y 26-27 parecen más representativos de operación sin intervención que el 22-25.
2. **La amplitud de los ciclos normales crece de forma sostenida** a lo largo de los tres tramos (4,85 → 5,69 → 6,62 °C). Es una tendencia progresiva, no un salto brusco — compatible con una deriva gradual (ver §5.2), presentada aquí como observación, no como diagnóstico.
3. **El último día (28/08) es el único con incursiones bajo -25 °C** (§4.2) y también el de menor promedio ponderado y mayor desvío estándar del período — un cambio de comportamiento que aparece justo al final de la ventana "limpia", inmediatamente antes de las pruebas físicas nuevas que arrancaron el 29/08. No se puede determinar con estos datos si está relacionado con esas pruebas (podrían haber empezado preparativos ese mismo día) o es una variación normal del equipo; se señala para que el equipo de campo lo tenga presente.

---

## 7. Archivos generados

Todos dentro de `nexosur-web/docs/mide/analisis-prueba-prolongada/` (no se tocó ningún archivo de producción):

| Archivo | Contenido |
|---|---|
| `informe.md` | Este informe |
| `datos/mediciones_periodo.csv` | 2878 registros usados (deduplicados), ordenados cronológicamente, con timestamps ART y UTC |
| `datos/resumen_diario.csv` | Resumen por día (10 filas) |
| `datos/episodios_termicos.csv` | 48 episodios térmicos (43 sobre umbral alto + 5 bajo umbral bajo) |
| `graficos/01_temperatura_vs_tiempo.png` | Temperatura vs. tiempo, período completo, con umbrales |
| `graficos/02_temperatura_por_dia.png` | Un panel por día (10 paneles) |
| `graficos/03_distribucion_temperaturas.png` | Histograma de `avg_value` con umbrales y promedio |
| `graficos/04_intervalos_entre_reportes.png` | Distribución y serie temporal de intervalos entre reportes |
| `graficos/05_episodios_sobre_umbrales.png` | Serie temporal con episodios sombreados sobre/bajo umbral |

---

## 8. Hechos observados

- El único dispositivo MIDE Frío en la base es `mide-frio-001`, sin ambigüedad.
- Umbrales realmente vigentes durante todo el período: **-15 °C (alto) / -25 °C (bajo)**, sin cambios de versión de configuración en la ventana analizada.
- Primer registro histórico: 18/08 17:07:11 ART (día parcial, excluido). Período analizado: 19/08 00:00 – 28/08 23:59:59 ART (10 días completos). Se excluyó también todo el 29/08 por instrucción explícita.
- 2878 mediciones válidas (deduplicadas) en el período; cadencia real prácticamente idéntica a la configurada (300 s).
- Un único hueco real de comunicación en 10 días (4,5 min, 23/08).
- 40 grupos de registros duplicados, atribuibles a la falta de idempotencia de `POST /api/mide/report` documentada en el propio repositorio.
- 0 valores `null`, 0 violaciones de `min≤avg≤max`, 0 temperaturas físicamente imposibles.
- Temperatura mínima absoluta -25,875 °C (28/08); máxima absoluta -3,8125 °C (24/08).
- 43 episodios sobre -15 °C (9,03 % del tiempo); 5 episodios bajo -25 °C, todos el 28/08.
- La tabla `events` está vacía (0 filas) en toda la historia del dispositivo — no se generó ni un solo evento de alarma real, pese a que hubo decenas de cruces de umbral en `measurements`.

## 9. Inferencias razonables (interpretaciones, no hechos verificados)

- Los ciclos de amplitud grande (>8 °C, coincidentes con los episodios sobre umbral) son **compatibles con aperturas de puerta u otra manipulación física**, pero esto es una hipótesis: no hay sensor de puerta que lo confirme.
- El crecimiento progresivo de la amplitud de los ciclos normales (4,85 → 5,69 → 6,62 °C) podría reflejar escarcha acumulada, mayor carga térmica u otro cambio gradual del equipo o del entorno — no se puede aislar la causa con los sensores actuales.
- La alta concentración de episodios en 22-25/08 sugiere que hubo actividad de prueba/manipulación ya dentro de la ventana considerada "válida", no solo a partir del 29/08.
- El patrón distinto del 28/08 (incursiones bajo -25 °C, mayor desvío) podría ser el inicio de un cambio de comportamiento o simplemente variabilidad normal; no es concluyente con los datos disponibles.

## 10. Problemas o anomalías detectados

- **Falta de idempotencia en `/api/mide/report`** (40 grupos de duplicados, ~1,5 % de las filas crudas) — problema de software de ingesta, no de sensor ni de conectividad.
- **`events` completamente vacía**: la lógica de firmware que dispara `/api/mide/event` está documentada como pendiente (`docs/mide/arquitectura.md`), así que hoy no existe alarma en tiempo real — todo el monitoreo de umbrales es retrospectivo, como este mismo análisis.
- **57 períodos (2 %) con `sample_count` por debajo de 55** (mínimo 32) — jitter menor de firmware al cerrar la ventana de acumulación, sin pérdida de datos evidente (no hay períodos vacíos).
- **Único hueco de comunicación** de 4,5 min el 23/08 — no recurrente, no indica un problema de fondo.
- **5 incursiones bajo -25 °C concentradas exclusivamente el 28/08** — patrón nuevo respecto a los 9 días anteriores, señalado para seguimiento.
- **Umbral alto (-15 °C) relativamente ajustado** respecto al pico típico de los ciclos normales (media -16,3 °C, mediana -16,15 °C): en el tramo intermedio el pico medio de los ciclos normales llegó a -15,47 °C, es decir, muy cerca del umbral de alarma incluso en operación "normal" — con la deriva de amplitud observada, el margen entre el pico habitual y el umbral de alarma se redujo con el tiempo.

## 11. Conclusión técnica

- **¿El sensor funciona de forma estable?** Sí, dentro de lo que estos datos permiten evaluar: valores siempre dentro de un rango físicamente plausible, sin nulls, sin violaciones de las restricciones de la base, y con un patrón cíclico coherente y repetible día a día.
- **¿La comunicación es confiable?** Sí, muy: cadencia real prácticamente idéntica a la configurada (300 s), un solo hueco de 4,5 min en 10 días completos. El único problema de "duplicación" de datos es de la capa de ingesta (falta de idempotencia en `/api/mide/report`), no del enlace de comunicación en sí.
- **¿Los registros son suficientemente consistentes para MIDE Frío?** Para esta etapa de prototipo, sí, con dos limitaciones a tener presentes: (1) solo se almacenan resúmenes de 5 minutos, no la serie cruda de 5 s, lo que limita la precisión para caracterizar excursiones muy breves; (2) no hay ningún evento de alarma real registrado todavía, porque esa parte del firmware está pendiente — el monitoreo de umbrales hoy solo es posible de forma retrospectiva (como este análisis), no en tiempo real.
- **¿Los umbrales usados (-15 / -25 °C) son razonables?** El umbral bajo (-25 °C) da margen razonable frente al valle típico de los ciclos normales (~-21,7 °C de media). El umbral alto (-15 °C) es más ajustado: el pico típico de los ciclos normales ronda -16,3 °C de media, y en el tramo intermedio del ensayo llegó a -15,47 °C de media — es decir, la operación normal del equipo se acerca bastante al umbral de alarma, sobre todo si la amplitud de ciclo sigue creciendo. Vale la pena revisar si conviene un margen algo mayor antes de una instalación definitiva.
- **Aspectos a resolver antes de una instalación definitiva:**
  1. Agregar idempotencia a `POST /api/mide/report` (constraint único análogo al de `/api/mide/event`) para eliminar los duplicados de ingesta.
  2. Implementar la lógica de firmware que dispara `/api/mide/event`, hoy pendiente, para tener alarmas en tiempo real en vez de solo análisis retrospectivo.
  3. Revisar el margen del umbral alto (-15 °C) a la luz de que el pico típico de los ciclos normales ya se le acerca, especialmente si la deriva de amplitud observada continúa.
  4. Si en algún momento se necesita distinguir con certeza aperturas de puerta de otras causas de temperatura alta, se necesita un sensor de puerta — hoy es solo una hipótesis razonable, no algo verificable con los datos actuales.

## 12. Limitaciones del análisis

- Los datos son resúmenes de 5 minutos, no muestras crudas de 5 s: cualquier excursión más corta que ~1 minuto puede no reflejarse bien en `avg_value`, aunque sí quedaría capturada en `min_value`/`max_value` si ocurrió dentro de un período reportado.
- No existe sensor de puerta, de temperatura ambiente ni de corriente del compresor: toda atribución de causa (apertura de puerta, carga térmica, degradación del equipo) es hipótesis, no hecho verificado.
- El corte de 8 °C usado para separar "ciclo normal" de "ciclo de evento" es una elección basada en la forma de esta muestra de 10 días, no un estándar validado; con más datos podría refinarse.
- El período intermedio (22-25/08) muestra señales de manipulación/prueba ya dentro de la ventana considerada "válida" — si se busca caracterizar el comportamiento verdaderamente basal del equipo, podría convenir acotar aún más el tramo de referencia (p. ej. 19-21 y 26-27/08).
- El dispositivo sigue reportando datos en este mismo momento (29/08), así que los conteos "históricos totales" de este informe son válidos al momento de la extracción y crecerán después.
