# MIDE Frío — Diseño de una lógica inteligente de alarmas (análisis sobre datos históricos)

**Tipo de trabajo:** análisis y simulación de solo lectura. **No** se modificó firmware, backend, dashboard, Supabase, migraciones ni configuración real. No se hicieron commits. Esta etapa termina en una recomendación fundamentada; no implementa nada en firmware.

**Fecha:** 2026-08-29. **Zona horaria:** `America/Argentina/Buenos_Aires` (UTC-3).

**Fuente de datos:** los CSV deduplicados generados en la etapa anterior:
`docs/mide/analisis-prueba-prolongada/datos/` — `mediciones_periodo.csv` (2878 períodos de 5 min, 19/08–28/08), `episodios_termicos.csv`, `resumen_diario.csv`, más el `informe.md` de esa etapa.

**Resolución de los datos (límite duro de todo el análisis):** `measurements` guarda un **resumen agregado cada 5 minutos** (`min_value`, `max_value`, `avg_value`, `sample_count ≈ 60`). El dispositivo muestrea cada 5 s pero **no** almacena la lectura individual. Todo lo que sigue trabaja a resolución de 5 minutos. No se inventó resolución intermedia; donde hay una estimación sub-período (p. ej. el instante exacto de cruce) está marcada como estimación.

**Umbral usado:** alto **= -15 °C** (confirmado en `device_config`, `config_version = 2`, sin cambios en todo el período). Config real vigente: `hysteresis = 0.5`, `recovery_delay_seconds = 120`, `alarm_delay_seconds = 180`, `min_threshold = -25`. La tabla `events` está **vacía** en toda la historia del dispositivo: nunca se disparó una alarma real; todo el monitoreo de umbrales existió solo de forma retrospectiva.

---

## Resumen ejecutivo

- Se reconstruyeron y analizaron **43 episodios** reales con `avg_value > -15 °C` entre el 19/08 y el 28/08/2026 (idéntico conteo que la etapa anterior).
- Por gravedad del pico (distancia del `avg` sobre el umbral): **30 episodios en banda 0** (≤ +2 °C), **5 en banda 1** (+2 a +5 °C), **8 en banda 2** (> +5 °C, es decir pico de `avg` más caliente que -10 °C).
- Se simularon **4 familias de estrategia** (A: solo tiempo; B: tiempo + tendencia; C: tiempo + tendencia + bandas de gravedad; D: tolerancia dinámica continua), con **7 configuraciones** en total, todas como máquina de estados *online* a resolución de 5 min.
- **Hallazgo principal:** una compuerta de tendencia **sola** (Estrategia B) suprime alarmas en excursiones graves cortas: **no alerta en 2 de los 8 episodios de banda 2** (E01, E09) y alerta **20–30 min tarde** en otros 2 (E13, E21), porque a los 15 minutos —cuando recién se le permite mirar— esas excursiones ya pasaron el pico y están recuperándose. Hace falta una **vía rápida por gravedad** que saltee la compuerta de tendencia cuando la desviación es grande.
- La regla de **solo tiempo (15 min)** detecta los 8 episodios graves pero alerta **después del pico en 4 de ellos** (las excursiones rápidas llegan al pico en ≤ 10 min) y **más de la mitad de sus alarmas (18 de 31)** caen sobre excursiones que nunca superaron +2 °C.
- **Recomendación:** una lógica tipo **C** — bandas de gravedad expresadas en **°C por encima del umbral configurado**, con compuerta de tendencia sobre pendiente de 3 muestras (15 min) y una vía rápida que alerta ya cuando el pico entra en banda grave. Segunda candidata: **D** con tolerancia lineal decreciente. Ambas son implementables en un ESP32 con sumas, comparaciones y un buffer circular de ~4 valores.

---

## Parte 1 — Reconstrucción detallada de episodios

**Criterio de episodio:** corrida maximal de períodos de 5 min consecutivos con `avg_value > -15 °C` (mismo criterio que la etapa previa; reproduce sus 43 episodios exactamente). Se cierra en el primer período con `avg_value ≤ -15 °C`.

Para cada episodio se calculó (CSV completo: [`datos/episodios_reconstruidos.csv`](./datos/episodios_reconstruidos.csv)):

| Campo | Definición |
|---|---|
| `t_cruce_periodo_art` | inicio del primer período de 5 min con `avg > -15` (lo más temprano que **se sabe** que está fuera de rango) |
| `t_cruce_interp_art` | estimación sub-período por interpolación lineal entre el `avg` previo y el primero fuera de rango — **es una estimación**, la resolución real es 5 min |
| `secuencia_avg_c` | todos los `avg` del episodio, en orden |
| `pico_avg_c` / `pico_max_c` | máximo `avg` del episodio / máximo `max_value` (pico instantáneo dentro de alguna ventana de 5 s) |
| `min_cruce_a_pico` | minutos desde el cruce hasta el período del pico |
| `min_cruce_a_normal` | duración total fuera de rango (= n.º de períodos × 5) |
| `min_pico_a_normal` | minutos desde el pico hasta volver a rango |
| `inicio_recuperacion_art` | primer período a partir del cual la serie ya no vuelve a subir más de 0,1 °C hasta el final del episodio (recuperación sostenida) |
| `dist_max_avg_c` / `dist_max_max_c` | pico − (-15), sobre `avg` y sobre `max_value` |
| `v_heat_mean_c_min` | (pico − `avg` previo) / (minutos previo→pico) |
| `v_heat_max_c_min` | mayor salto positivo entre períodos consecutivos (÷ 5 min) antes del pico |
| `v_rec_mean_c_min` / `v_rec_max_c_min` | pendiente media / máxima (negativa) desde el inicio de recuperación hasta volver a rango |
| `pendiente_primeros_10min_c_min` | pendiente en los primeros ~10 min del episodio (predictor temprano) |

**Los 8 episodios de banda 2 (graves) — el banco de pruebas más exigente:**

| Ep | Inicio (ART) | Dur (min) | Pico `avg` | Pico `max` | Dist. máx (°C) | Cruce→pico (min) | v_calent. media | v_calent. máx |
|---|---|---|---|---|---|---|---|---|
| E01 | 19/08 14:12 | 25 | -9,78 | -9,56 | +5,22 | 10 | 0,41 | 0,43 |
| E09 | 22/08 18:43 | 20 | -9,10 | -8,50 | +5,91 | 10 | 0,48 | 0,55 |
| E13 | 23/08 20:57 | 70 | -9,86 | -8,38 | +5,14 | 10 | 0,41 | 0,57 |
| E21 | 24/08 13:18 | 45 | -7,69 | **-3,81** (máx. absoluto del ensayo) | +7,31 | **0** | **1,57** | **1,57** |
| E30 | 25/08 08:08 | 105 | -6,53 | -5,69 | +8,47 | 80 | 0,10 | 0,41 |
| E35 | 26/08 10:23 | 45 | -6,86 | -6,56 | +8,15 | 25 | 0,27 | 0,50 |
| E42 | 27/08 19:58 | 50 | **-4,70** (máx. `avg` del ensayo) | -4,06 | +10,30 | 25 | 0,35 | 0,59 |
| E43 | 28/08 22:33 | 35 | -8,10 | -7,69 | +6,90 | 20 | 0,31 | 0,43 |

Observación clave para el diseño: **la mitad de los episodios graves (E01, E09, E13, E21) llegan al pico en ≤ 10 minutos.** Cualquier regla que espere 15 minutos para decidir llega tarde a esos casos.

Los 5 episodios de banda 1 y los 30 de banda 0 están en el CSV. Los de banda 0 son mayormente excursiones de 5–40 min que se quedaron entre -15 y -14 °C; hay dos largas y poco profundas notables: **E06** (90 min, pico -13,32) y **E07** (60 min, pico -13,80).

Gráficos: [`01_distancia_vs_duracion.png`](./graficos/01_distancia_vs_duracion.png), [`02_tiempo_hasta_pico.png`](./graficos/02_tiempo_hasta_pico.png).

---

## Parte 2 — Método de tendencia

Se compararon **7 métodos simples** × **5 bandas muertas** (`deadband`, en °C/min). Ninguno usa ML; todos son sumas/restas sobre un buffer de 2 a 4 valores. CSV: [`datos/tendencia_metodos_comparacion.csv`](./datos/tendencia_metodos_comparacion.csv).

**Métodos:** `slope_2p` (diferencia último−anterior ÷ 5 min); `slope_3p_ep` / `linreg_3p` (pendiente sobre 3 muestras = `(T_ahora − T_hace_15min) / 15` — para 3 puntos equiespaciados la regresión lineal **es** exactamente eso); `slope_4p` / `linreg_4p` (4 muestras / 20 min); `mm_2v2` (media de las 2 nuevas − media de las 2 previas); `val_vs_mm3` (valor actual − media móvil de 3).

**Ruido de base** (p90 de |pendiente| durante operación normal, sin excursión, `avg` entre -23 y -16 °C):

| Método | p90 \|pendiente\| (°C/min) | p50 |
|---|---|---|
| `slope_2p` | 0,284 | 0,091 |
| `slope_3p` / `linreg_3p` | 0,264 | 0,092 |
| `slope_4p` / `linreg_4p` | 0,245 | 0,091 |
| `mm_2v2` | 0,251 | 0,092 |

Es decir: el ciclado normal del compresor produce pendientes de hasta ~0,28 °C/min por sí solo. Una banda muerta de **0,05 °C/min** (= 0,25 °C en un paso de 5 min, o 0,75 °C sobre 15 min con el método de 3 puntos) filtra el grueso de ese ruido sin perder las excursiones reales, que sostienen 0,3–1,6 °C/min.

**Evaluación** (verdad de referencia = *antes del pico del episodio → ASC*, *después del pico → DESC*, que es exactamente lo que pide el usuario: «¿sigue calentándose o ya empezó a recuperarse?»):

| Métrica | Qué mide | Por qué importa |
|---|---|---|
| `detecta_ascenso` | % de períodos pre-pico etiquetados ASC | sensibilidad para alertar a tiempo |
| `detecta_recuperacion` | % de períodos post-pico etiquetados DESC | permite mantener observación sin alarma |
| `error_desc_prematuro` | dice DESC estando **aún antes** del pico | **error peligroso**: haría «hold» a una excursión que sigue subiendo |
| `error_asc_tardio` | sigue diciendo ASC ≥ 10 min **después** del pico | genera alarmas sobre excursiones ya en recuperación |
| `estable_en_basal` | % de «EST» durante operación normal | robustez / no ruido |
| `cambios_etiqueta_por_muestra` | frecuencia de flip ASC↔DESC↔EST | estabilidad de la señal para firmware |

**Resultado y elección.** El máximo *score* bruto lo obtiene `slope_2p` con banda muerta 0,03 (muy sensible), pero es el más ruidoso (`cambios_etiqueta` 0,19) y su estabilidad basal es casi nula (0,08): durante el ciclado normal casi nunca dice «estable». La elección para las estrategias es la **pendiente sobre 3 muestras (15 min) con banda muerta 0,05 °C/min**:

- `detecta_ascenso` 0,35 · `detecta_recuperacion` 0,51
- **`error_desc_prematuro` = 0,000** y **`error_asc_tardio` = 0,000** en todo el set histórico: nunca dijo «recuperando» mientras la excursión todavía subía, ni «subiendo» pasado el pico.
- usa exactamente los 15 minutos de historia que la lógica de alarma ya espera de por sí.
- coste en firmware: dos restas y una comparación sobre un buffer de 3 valores.

Cuando el método no tiene evidencia suficiente devuelve **EST** (banda muerta). La lógica de alarma trata «EST» de forma conservadora (escala tras un tiempo extra), así que la baja sensibilidad no compromete la seguridad: solo hace que la decisión se apoye un poco más en el tiempo y la gravedad que en la tendencia.

---

## Parte 3 — Estrategias simuladas

Todas son máquinas de estados *online* (solo miran el pasado y el presente en cada período de 5 min). Al cruzar -15 °C entran en **OBSERVACIÓN** (registran el cruce, no alertan). En cada período posterior aplican su regla, que puede pasar a **ALARMA** o mantener observación. Si el episodio vuelve a rango antes de cualquier alarma → «observado sin alarma».

- **A — solo tiempo.** ALARMA cuando el tiempo continuo fuera de rango ≥ 15 min (4.º período consecutivo fuera).
- **B — tiempo + tendencia.** A los ≥ 15 min: si tendencia = ASC → ALARMA; si DESC → mantener observación; si EST → mantener y **escalar a ALARMA si sigue fuera de rango a los 30 min** (criterio documentado: 30 min a temperatura estable fuera de rango es en sí mismo un problema).
- **C — tiempo + tendencia + gravedad.** Bandas de gravedad sobre la **distancia máxima alcanzada** (con *ratchet*: una vez en banda grave no se baja de banda). Cada banda tiene su ventana de tolerancia; al vencer se aplica la lógica de tendencia de B; la banda grave tiene además vía rápida. Dos juegos de ventanas simulados:
  - `C_bandas_15_10_5`: banda 0 → 15 min, banda 1 → 10 min, banda 2 → 5 min.
  - `C_bandas_15_8_0`: banda 0 → 15 min, banda 1 → 8 min, banda 2 → 0 min (alarma inmediata al detectar banda grave).
- **D — gravedad dinámica.** `tolerancia_min = max(0, T_max − k · d)` con `d` = distancia máxima sobre el umbral (°C). Vencida la tolerancia se alerta salvo que la tendencia sea DESC (override de recuperación, opcional). Vía rápida dura: `d ≥ +8 °C` → alarma inmediata. Variantes:
  - `D_k3_T15` (`T_max=15, k=3`): d0→15, d2→9, d5→0 min.
  - `D_k2_T20` (`T_max=20, k=2`): d0→20, d2→16, d5→10, d8→4 min.
  - `D_k3_T15_sinRec`: igual que la primera pero sin override de recuperación.

Bandas de gravedad (relativas al umbral, según la hipótesis del pedido):

| Banda | Distancia sobre umbral | Con umbral -15 °C | Interpretación |
|---|---|---|---|
| 0 | 0 a +2 °C | -15 a -13 °C | observación normal |
| 1 | +2 a +5 °C | -13 a -10 °C | desviación importante |
| 2 | > +5 °C | > -10 °C | desviación grave |

---

## Parte 4 — Criterio de recuperación

Config actual: `hysteresis = 0.5`, `recovery_delay_seconds = 120`. Con períodos de 5 min, 120 s es menos de un período: en la práctica hoy el evento se cerraría con el primer período `avg ≤ -15,5 °C`.

Se re-segmentó toda la serie con 6 criterios de cierre (CSV: [`datos/recuperacion_criterios.csv`](./datos/recuperacion_criterios.csv)):

| Criterio | N.º episodios | Merges vs. R1 | Dur. media (min) | Min. extra con evento abierto |
|---|---|---|---|---|
| R1: `avg ≤ -15,0`, 1 período | 43 | 0 | 30,2 | 0 |
| R2: `avg ≤ -15,5`, 1 período (≈ histéresis actual) | 43 | 0 | 30,2 | 0 |
| R3: `avg ≤ -16,0`, 1 período | 43 | 0 | 30,2 | 0 |
| R4: `avg ≤ -15,0`, sostenido 2 períodos (10 min) | 43 | 0 | 30,2 | +5 |
| R5: `avg ≤ -15,5`, sostenido 2 períodos | 43 | 0 | 30,2 | +5 |
| R6: `avg ≤ -15,5`, sostenido 3 períodos (15 min) | 43 | 0 | 30,2 | +10 |

**El criterio de recuperación no cambia la segmentación en este conjunto de datos.** Por qué:

- **Los episodios están muy separados.** Entre un episodio y el siguiente hay como mínimo **4 períodos** (20 min) por debajo de -15 °C, y la mediana es de 18 períodos (90 min). Ningún par de episodios está separado por ≤ 2 períodos.
- **No hay *flapping* alrededor del umbral.** La señal «blanda» `max_value > -15` (picos que no llegan a subir el promedio) forma 47 rachas y **ninguna** está separada por ≤ 1 período de la siguiente.
- **Ningún episodio vuelve a cruzar -15 °C dentro de los 10 minutos** de haberse cerrado.
- Al cerrar un episodio (R1), el `avg` a los 5 min está en promedio **solo 1,07 °C por debajo** del umbral (en un caso, apenas -0,01 °C): la temperatura queda **cerca** del umbral justo después de cerrar, aunque en esta prueba nunca lo volvió a cruzar enseguida.

**Conclusión y recomendación.** Con estos datos no se puede elegir el criterio de recuperación por evidencia de *flapping* porque no lo hubo. Pero el margen tan chico al cerrar (~1 °C) es motivo suficiente para **mantener histéresis** y agregar un **sostén corto** como seguro barato: recuperación = `avg ≤ (umbral − histéresis)` **durante 2 períodos consecutivos (10 min)**, con `histéresis` entre 0,5 y 1,0 °C. Cuesta 1 contador en firmware y solo agrega ~5 min de evento abierto. El valor exacto de histéresis y del sostén **necesita un ensayo físico** con aperturas de puerta repetidas y cercanas, que es el escenario que aquí no ocurrió.

---

## Parte 5 — Alarmas anticipadas por gravedad

¿Conviene **no** esperar los 15 minutos cuando la temperatura se aleja mucho del umbral? Barrido de cortes de temperatura para «alarma inmediata» (CSV: [`datos/alarmas_anticipadas.csv`](./datos/alarmas_anticipadas.csv), gráfico [`07_alarmas_anticipadas.png`](./graficos/07_alarmas_anticipadas.png)):

| Corte `avg` | Dist. sobre umbral | Episodios que disparan | de esos, banda 2 (grave) | de esos, pico apenas sobre el corte y breve | Min. ahorrados vs. regla de 15 min (media) | Min. antes del pico (media) | Temp. media al disparar |
|---|---|---|---|---|---|---|---|
| -13 °C | +2 | 13 | 8 | 1 | +1,9 | +9,2 | -11,7 |
| -12 °C | +3 | 11 | 8 | 0 | +0,9 | +6,4 | -10,7 |
| -11 °C | +4 | 11 | 8 | 2 | -0,9 | +4,5 | -10,1 |
| -10 °C | +5 | 8 | 8 | 2 | -5,0 | +2,5 | -8,7 |
| -9 °C | +6 | 5 | 4 | 1 | -11,0 | +4,0 | -8,1 |
| -8 °C | +7 | 4 | 4 | 0 | -16,2 | +1,2 | -7,1 |
| -7 °C | +8 | 3 | 3 | 1 | -28,3 | 0,0 | -6,0 |

Lectura:

- **Un corte en -10 °C (= +5 °C sobre el umbral, borde de la banda grave) dispara en 8 episodios, y los 8 son exactamente los de banda 2.** Cero episodios de banda 0/1 lo activan. Es un corte «limpio»: quien lo cruza es siempre un episodio que terminó siendo grave.
- Con ese corte se alerta **en promedio 2,5 min antes del pico** (contra la regla de 15 min, que en esos mismos episodios llega **después** del pico en 4 de 8). El «ahorro» negativo (-5 min) respecto de la regla de 15 min es engañoso: significa que la temperatura tardó > 15 min en llegar a -10 °C en algunos episodios lentos (E30 sobre todo), pero en los rápidos el corte por gravedad es lo único que alerta a tiempo.
- Bajar el corte a -13 °C anticiparía más (~9 min antes del pico) pero arrastra 5 episodios de banda 0/1 que no eran graves. **No parece un buen intercambio**: esos 5 son excursiones que se quedaron entre -13 y -12 °C.

**Sí es razonable no esperar los 15 minutos cuando el `avg` supera ~-10 °C (+5 °C sobre el umbral).** Es el mecanismo que salva los episodios rápidos.

---

## Parte 6 — Replay de los episodios

CSV período a período con pendientes, tendencia y marca de qué estrategia habría alertado en cada punto: [`datos/replay_cronologico.csv`](./datos/replay_cronologico.csv) (260 filas = los 43 episodios). Replays legibles de 17 episodios seleccionados: [`datos/replays_legibles.txt`](./datos/replays_legibles.txt). Selección: pequeños, autolimitados, ~-13 °C, cerca de -10 °C, graves (≤ -8 °C) y el máximo absoluto.

**E21 — 24/08, máximo absoluto del ensayo (`max_value` -3,81 °C) y excursión instantánea:**

```
13:13  (aprox) cruza -15 C            [avg previo -15,53]
13:18   -7,69 C  (+7,3)  ASC   <- PICO      ALARMA: C_15_8_0, D_k3
13:23  -11,36 C  (+3,6)  ASC               ALARMA: C_15_10_5
13:28  -12,44 C  (+2,6)  DESC
13:33  -12,76 C  (+2,2)  DESC              ALARMA: A_solo_tiempo   (15 min tarde)
13:38  -12,81 C  (+2,2)  EST               ALARMA: D_k2_T20
13:48  -12,56 C  (+2,4)  EST               ALARMA: B_tiempo_tendencia   (30 min tarde)
13:58  -14,92 C  (+0,1)  DESC
14:03  vuelve a rango
```

En un solo período (5 min) saltó de -15,5 a -7,7 °C. **Solo las estrategias con vía rápida por gravedad (C y D dura) alertan cerca del pico.** A llega 15 min tarde; B llega 30 min tarde (por su escalón de «EST a los 30 min»).

**E01 — 19/08, excursión grave corta que B NO detecta:**

```
14:12   -13,82 C  (+1,2)  ASC
14:17   -11,79 C  (+3,2)  ASC
14:22    -9,78 C  (+5,2)  ASC   <- PICO    ALARMA: C_15_10_5, C_15_8_0, D (todas)
14:27   -11,36 C  (+3,6)  EST               ALARMA: A_solo_tiempo
14:32   -14,21 C  (+0,8)  DESC
14:37  vuelve a rango
```

A los 15 min (14:27) la excursión **ya pasó el pico**; la tendencia es EST/DESC, así que **B mantiene observación y el episodio se cierra sin alarma jamás.** Llegó a -9,78 °C. C y D lo capturan al entrar en banda 2 (14:22, 10 min). Mismo patrón exacto en **E09** (pico -9,10 °C, sin alarma de B).

**E06 — 22/08, larga y poco profunda (banda 0):**

```
09:37  cruza -15 C
09:57   -14,49 C  (+0,5)  EST    ALARMA: A_solo_tiempo, D_k3
10:12   -14,15 C  (+0,8)  EST    ALARMA: B, C_15_10_5, C_15_8_0   (escalón EST a 30 min)
10:58   -13,32 C  (+1,7)  EST    <- PICO
11:13  vuelve a rango  (90 min fuera de rango, nunca por encima de -13,3)
```

90 minutos entre -15 y -13,3 °C. **Todas** las estrategias terminan alertando: A/D a los 15–20 min, B/C a los 30 min por el escalón de «estable fuera de rango». Es discutible si esto es una alarma necesaria, pero **no** es una «alarma potencialmente innecesaria por excursión pequeña que se recupera sola»: es una excursión sostenida de hora y media. Ver Parte 7.

**E02 — 19/08, excursión mínima:** 1 solo período, pico -14,89 °C, vuelve a rango en 5 min. **Ninguna estrategia alerta.** Correcto.

**E42 — 27/08, máximo `avg` del ensayo (-4,70 °C):** cruza 19:53, C y D alertan a los 10–15 min (a -12 / -10 °C, en pleno ascenso), pico a los 25 min. A y B alertan a los 15 min (-10 °C). Todas lo capturan; C/D lo hacen antes y en banda grave.

---

## Parte 7 — Comparación de resultados

43 episodios. «Grave» = pico en banda 2 (8 episodios). «Excursión pequeña» = pico en banda 0 (≤ +2 °C, 30 episodios). «Pequeña y breve» = banda 0 **y** duración ≤ 20 min (recuperada sin intervención; 3 episodios). CSV por episodio × estrategia: [`datos/resultado_por_episodio_estrategia.csv`](./datos/resultado_por_episodio_estrategia.csv). Gráfico: [`06_comparacion_estrategias.png`](./graficos/06_comparacion_estrategias.png).

| Estrategia | Alarmas | Sin alarma | Graves alertados tarde (post-pico) | Alarmas en excursión pequeña (banda 0) | …de esas, pequeña **y breve** | Anticipación mediana vs. pico | Temp. media al alarmar |
|---|---|---|---|---|---|---|---|
| **A — solo tiempo (15 min)** | 31 | 12 | **4** / 8 | 18 | 3 | 0 min | -13,2 °C |
| **B — tiempo + tendencia** | 19 | 24 | 2 / 8 · **+ 2 graves sin alarma** | 9 | 0 | +5 min | -12,7 °C |
| **C — bandas 15/10/5** | 22 | 21 | 1 / 8 | 9 | 0 | +5 min | -12,6 °C |
| **C — bandas 15/8/0** | 22 | 21 | **0** / 8 | 9 | 0 | +5 min | -12,4 °C |
| **D — dinámica k3/T15** | 32 | 11 | 0 / 8 | 19 | 4 | +5 min | -13,1 °C |
| **D — dinámica k2/T20** | 26 | 17 | 1 / 8 | 14 | 0 | 0 min | -12,7 °C |
| **D — k3/T15 sin override recuperación** | 32 | 11 | 0 / 8 | 19 | 4 | +5 min | -13,1 °C |

**Detalle por episodio grave — ¿alertó? y a cuántos minutos del cruce:**

| Ep (banda 2) | A | B | C 15/8/0 | D k2/T20 | Notas |
|---|---|---|---|---|---|
| E01 | 15 | **no** | 10 | 10 | B no alerta: recuperando a los 15 min |
| E09 | 15 | **no** | 10 | 10 | ídem |
| E13 | 15 | 30 (tarde) | 10 | 10 | B llega 20 min post-pico |
| E21 | 15 (tarde) | 30 (tarde) | **0** | 20 | spike instantáneo; solo C dura llega al pico |
| E30 | 15 | 30 | 30 | 20 | excursión lenta (pico a los 80 min); todas anticipan |
| E35 | 15 | 15 | 10 | 15 | |
| E42 | 15 | 15 | 10 | 15 | |
| E43 | 15 | 15 | 10 | 15 | |

**Interpretación (usando la terminología pedida, sin «falso positivo»):**

- **A (solo tiempo)** no deja ningún episodio grave sin alarma, pero **alerta después del pico en 4 de 8** y produce **18 alarmas sobre excursiones de banda 0**. De esas 18, solo 3 son «pequeñas y breves»; las otras 15 son excursiones sostenidas de 20–90 min entre -15 y -13,5 °C — alertar sobre ellas es defendible.
- **B (tiempo + tendencia)** reduce las alarmas a la mitad (31 → 19) y **elimina por completo las 3 alarmas sobre excursiones pequeñas y breves**, pero su compuerta de tendencia **le hace perder 2 episodios graves (E01, E09)** y llegar tarde a otros 2. **Riesgo inaceptable para una alarma de cadena de frío.**
- **C (bandas + tendencia + vía rápida)** mantiene el recorte de B (22 alarmas, mismas 9 excursiones pequeñas, 0 pequeñas-y-breves) **y recupera la respuesta rápida en los graves**: `C_15_8_0` alerta en los 8 episodios de banda 2, ninguno después del pico. Es el mejor equilibrio.
- **D dinámica** depende mucho del ajuste: `k3/T15` es tan disparadora como A (32 alarmas, 19 en banda 0); `k2/T20` queda entre B y C (26 alarmas, 1 grave tarde). El *override* de recuperación casi no cambia nada en este set (misma cuenta con y sin él) porque en banda 2 la vía rápida `d ≥ +8` domina.
- Las **9 alarmas de B/C sobre excursiones de banda 0** son todas de episodios de **≥ 25 min** fuera de rango (E05, E06 de 90 min, E07 de 60 min, E18, E19, E20, E22, E24, E32). Ninguna es una excursión que «se recuperó sola en pocos minutos». La lógica de tendencia + los 30 min de escalón ya filtran esas: **quedaron 0 alarmas sobre excursiones pequeñas y breves**.

---

## Parte 8 — Análisis de velocidad térmica

CSV: [`datos/velocidad_termica.csv`](./datos/velocidad_termica.csv). Gráfico: [`03_pendiente_termica.png`](./graficos/03_pendiente_termica.png).

| Métrica (sobre 43 episodios) | Media | Mediana | Extremo |
|---|---|---|---|
| Velocidad media de calentamiento (cruce→pico) | 0,17 °C/min | 0,05 °C/min | 1,57 °C/min (E21) |
| Velocidad **máxima** de calentamiento (salto entre 2 períodos) | — | — | 1,57 °C/min (E21) |
| Velocidad media de recuperación | -0,20 °C/min | -0,14 °C/min | -0,68 °C/min |

**¿Aporta la pendiente a la clasificación?**

- Correlación entre la pendiente de los primeros ~10 min y la distancia máxima alcanzada: **r = 0,35** (positiva pero débil).
- Como **regla escalonada** funciona mejor que como variable continua: de los **6 episodios con pendiente inicial ≥ 0,30 °C/min, 5 terminan superando +2 °C** (banda 1 o 2); de los **37 con pendiente inicial < 0,30 °C/min, solo 8** lo hacen. Es decir, una pendiente inicial alta es un **indicador temprano razonable** de que la excursión va a ser importante (83 % vs. 22 %).
- **Pero** el caso más grave y peligroso, **E30** (pico -6,53 °C), tuvo pendiente inicial de solo **0,10 °C/min**: estuvo ~45 min oscilando cerca de -14,5 °C y **después** se disparó. Una regla basada solo en pendiente temprana lo habría subestimado. La distancia acumulada (que sí lo detecta cuando finalmente sube) es más confiable como disparador principal.

**Conclusión:** la pendiente **sí aporta**, pero como **señal secundaria**, no como disparador principal:

1. La compuerta de tendencia (Parte 2) ya usa la pendiente para decidir *hold* vs. *alarma* tras vencer la ventana de tiempo — ese es su uso natural y suficiente.
2. Añadir además un «disparo por pendiente alta» (p. ej. pendiente 3-puntos ≥ 0,4 °C/min sostenida 2 lecturas ⇒ subir una banda de gravedad) es un refinamiento **opcional** que capturaría antes a E21/E42, a coste de 1 comparación extra. Se puede probar en el ensayo físico, pero **no es imprescindible**: la vía rápida por distancia (`avg > -10 °C`) ya cubre esos casos con lógica más simple.
3. No conviene hacer la velocidad una **entrada continua** del algoritmo (más constantes que calibrar, r bajo). Mantenerla como umbral binario si se incluye.

La velocidad de recuperación (media -0,2 °C/min, ninguna excursión se recuperó más rápido de -0,68 °C/min) es útil sobre todo para dimensionar el `recovery_delay`: a esa velocidad, salir de -13 °C a -15,5 °C lleva ~12 min, coherente con exigir 2 períodos de sostén.

---

## Parte 9 — Generalización (independencia del valor absoluto)

Toda la lógica propuesta se expresa como **«X grados por encima del umbral configurado»**, no como temperaturas absolutas:

| Concepto | Forma relativa | Con umbral -15 °C (freezer) | Con umbral +5 °C (heladera) |
|---|---|---|---|
| Banda 0 (observación) | pico ≤ umbral + 2 °C | ≤ -13 °C | ≤ +7 °C |
| Banda 1 (importante) | umbral + 2 a + 5 °C | -13 a -10 °C | +7 a +10 °C |
| Banda 2 (grave) | > umbral + 5 °C | > -10 °C | > +10 °C |
| Vía rápida por gravedad | `valor > umbral + 5 °C` | > -10 °C | > +10 °C |
| Recuperación | `valor ≤ umbral − histéresis`, 2 períodos | ≤ -15,5 °C | ≤ +4,5 °C |
| Compuerta de tendencia | pendiente sobre 15 min, banda muerta 0,05 °C/min | igual | igual |

**Esto es razonable y recomendable** para que MIDE Frío se reutilice en freezers, heladeras o cámaras: el operador configura `min_threshold` / `max_threshold` y la lógica de alarma se re-escala sola.

**Salvedad importante:** las **constantes de tiempo** (ventanas de tolerancia de 15/8/0 min, sostén de recuperación) **no son universales**. Dependen de la masa térmica y la carga del equipo: una heladera con poca inercia puede calentarse a +5 °C sobre el umbral en 2–3 minutos, mientras que este freezer cargado tardó 10–25 min en la mayoría de los episodios. Recomendación: expresar las **bandas** en °C relativos (universal) pero dejar las **ventanas de tiempo** y la **histéresis** como parámetros por tipo de dispositivo en `device_config`, con los valores de este informe como *default* para `device_type = "frio"` tipo freezer. La pendiente umbral de la señal secundaria (0,3–0,4 °C/min) también es dependiente del equipo.

---

## Parte 10 — Propuesta final: 1–2 lógicas candidatas para el próximo ensayo físico

Ambas candidatas: explicables, sin IA, implementables en ESP32 (aritmética entera/float simple + buffer circular de 3–4 valores + 2–3 contadores), manejan histéresis, distinguen observación de alarma, consideran recuperación y gravedad, y evitan alarmas por excursiones pequeñas que se recuperan solas.

### Candidata 1 (recomendada) — «Observación + bandas relativas + tendencia + vía rápida de gravedad»

Corresponde a la familia **C** (`C_15_8_0` en la simulación: 0 graves tarde, 22 alarmas, 0 alarmas sobre excursiones pequeñas-y-breves).

```
Parámetros (todos en device_config; defaults para freezer):
  U            = max_threshold                 (-15 °C en esta prueba)
  H            = 1.0 °C     histéresis          (probar 0.5 y 1.0)
  BANDA1       = U + 2 °C
  BANDA2       = U + 5 °C
  TOL0         = 15 min     tolerancia banda 0
  TOL1         = 8 min      tolerancia banda 1
  DEADBAND     = 0.05 °C/min
  REC_SOSTEN   = 2 períodos (10 min)

Estado NORMAL:
  si avg_5min > U  ->  estado = OBSERVACION
      t_cruce = ahora ;  dist_max = avg - U

En cada reporte de 5 min dentro de OBSERVACION:
  dist       = avg - U
  dist_max   = max(dist_max, dist)
  elapsed    = ahora - t_cruce
  pend       = (avg - avg_hace_15min) / 15        # pendiente 3 muestras
  tendencia  = ASC si pend >  DEADBAND
               DESC si pend < -DEADBAND
               EST  en otro caso

  # ---- VÍA RÁPIDA: gravedad ----
  si dist_max > BANDA2:            -> ALARMA ("desviación grave")

  # ---- Banda 1 ----
  sino si dist_max > BANDA1:
     si elapsed >= TOL1 y tendencia != DESC   -> ALARMA ("desviación importante sostenida")

  # ---- Banda 0 ----
  sino:
     si elapsed >= TOL0:
        si tendencia == ASC                   -> ALARMA ("15 min fuera de rango, sigue subiendo")
        si tendencia == EST y elapsed >= 30   -> ALARMA ("30 min estable fuera de rango")
        # tendencia == DESC  -> mantener OBSERVACION (excursión autolimitada)

  # ---- Recuperación (cierra OBSERVACION o ALARMA) ----
  si avg <= U - H durante REC_SOSTEN períodos consecutivos -> estado = NORMAL
```

Por qué esta: es la única que en la simulación **alerta en los 8 episodios graves sin que ninguno quede detectado después del pico**, manteniendo el recuento de alarmas a la mitad de la regla de solo-tiempo y sin alertar en ninguna excursión pequeña y breve. La vía rápida por distancia resuelve los episodios rápidos (E01, E09, E21) que la tendencia sola no puede.

### Candidata 2 (más simple de expresar) — «Tolerancia dinámica lineal»

Corresponde a la familia **D** (`k2/T20`: 26 alarmas, 1 grave tarde, 0 pequeñas-y-breves). Una sola fórmula en vez de bandas discretas.

```
Parámetros:
  U, H, DEADBAND, REC_SOSTEN  igual que Candidata 1
  T_MAX = 20 min
  K     = 2 min por °C
  DURO  = U + 8 °C            distancia que fuerza alarma inmediata

En OBSERVACION, cada 5 min:
  dist_max  = max(dist_max, avg - U)
  tol       = max(0, T_MAX - K * dist_max)      # +2°C->16min, +5°C->10min, +8°C->4min
  si (avg - U) > 8      -> ALARMA inmediata
  si elapsed >= tol:
     si tendencia != DESC -> ALARMA
     # DESC -> mantener OBSERVACION
  Recuperación: igual que Candidata 1
```

Ventaja: una recta en lugar de una tabla de bandas; el «gradiente» (más lejos ⇒ menos espera) es continuo y transparente. Desventaja: en la simulación deja **E30** detectado un poco más tarde que C y necesita el escalón «DURO» de todos modos para los spikes, con lo cual no es tan «pura» como parece.

### Recomendación

Llevar **ambas** al ensayo físico y compararlas en vivo, con la Candidata 1 como favorita. Son idénticas en el 80 % del código (estado, tendencia, recuperación); solo cambia el bloque de decisión de tiempo/gravedad, así que se pueden probar alternadamente en el mismo firmware con un flag de configuración.

---

## Valores que todavía requieren ensayo físico

| Parámetro | Valor propuesto (simulación) | Por qué no está cerrado |
|---|---|---|
| Histéresis `H` | 0,5–1,0 °C | no hubo *flapping* en los datos; el margen chico al cerrar (~1 °C) sugiere subir a 1,0, pero hay que verlo con aperturas de puerta reales |
| Sostén de recuperación | 2 períodos (10 min) | mismo motivo; podría bastar 1 período |
| Ventanas de tolerancia `TOL0/TOL1` (o `T_MAX`/`K`) | 15 / 8 min (ó 20 min, 2 min/°C) | dependen de la inercia térmica del equipo y su carga; este freezer estaba cargado y con actividad de prueba entre el 22 y 25/08 |
| Borde de banda 2 / distancia «dura» | +5 °C / +8 °C sobre umbral | +5 °C separó limpio los 8 graves en **esta** muestra (n pequeño); validar con más episodios |
| Banda muerta de pendiente | 0,05 °C/min | derivada del ruido de ciclado de **este** equipo (p90 ≈ 0,26–0,28 °C/min sobre 15 min); recalcular por dispositivo |
| Disparo opcional por pendiente alta | ≥ 0,4 °C/min, 2 lecturas | mejora marginal; decidir si vale la complejidad |
| Escalón «EST a los 30 min» | 30 min | elegido a criterio; ninguna excursión estable-y-prolongada del set lo cuestiona, pero no está calibrado contra riesgo real de producto |

---

## Archivos generados

Todos en `nexosur-web/docs/mide/analisis-alarmas-inteligentes/` (carpeta nueva, separada de `analisis-prueba-prolongada/`; no se tocó ningún archivo de producción ni el análisis anterior):

| Archivo | Contenido |
|---|---|
| `informe.md` | Este documento |
| `datos/episodios_reconstruidos.csv` | 43 episodios con las ~24 métricas cronológicas de la Parte 1 |
| `datos/tendencia_metodos_comparacion.csv` | 7 métodos × 5 bandas muertas, métricas de la Parte 2 |
| `datos/resultado_por_episodio_estrategia.csv` | 43 episodios × 7 configuraciones de estrategia (alarmó, cuándo, temp., motivo) |
| `datos/replay_cronologico.csv` | 260 filas: cada período de cada episodio con pendientes, tendencia y marca de alarma por estrategia |
| `datos/replays_legibles.txt` | replay en texto de 17 episodios seleccionados |
| `datos/recuperacion_criterios.csv` | 6 criterios de cierre re-segmentando la serie completa (Parte 4) |
| `datos/alarmas_anticipadas.csv` | barrido de 7 cortes de temperatura para alarma inmediata (Parte 5) |
| `datos/velocidad_termica.csv` | velocidades de calentamiento/recuperación por episodio (Parte 8) |
| `graficos/01_distancia_vs_duracion.png` | distancia del pico sobre umbral vs. duración, por banda |
| `graficos/02_tiempo_hasta_pico.png` | tiempo cruce→pico vs. gravedad + histograma (línea de 15 min) |
| `graficos/03_pendiente_termica.png` | histogramas de velocidad + pendiente temprana vs. pico alcanzado |
| `graficos/04_momento_de_alarma_por_estrategia.png` | línea de tiempo de 15 episodios con el instante de alarma de cada estrategia |
| `graficos/05_episodios_representativos.png` | 6 episodios (mínimo, largo poco profundo, ~-12, ~-10, spike, máximo) con marcas de alarma |
| `graficos/06_comparacion_estrategias.png` | barras: alarmas totales / en excursión pequeña / graves tarde, por estrategia |
| `graficos/07_alarmas_anticipadas.png` | episodios que disparan y anticipación al pico según el corte de temperatura |
| `scripts/analisis.py`, `scripts/graficos.py` | scripts reproducibles (solo lectura de los CSV de la etapa previa) |

---

## Limitaciones del análisis

1. **Resolución de 5 minutos.** No se ve nada por debajo de ~1 minuto. Un pico real más caliente y más breve que E21 podría no haber quedado registrado ni siquiera en `max_value`. Las pendientes en °C/min son medias sobre pasos de 5 min, no derivadas instantáneas.
2. **Muestra chica.** 43 episodios, **solo 8 en banda grave** y **5 en banda 1**. Los bordes de banda (+2/+5/+8 °C) y las ventanas de tiempo se eligieron sobre esta muestra; separan bien **aquí**, pero con más datos podrían moverse.
3. **Sin sensor de puerta, temperatura ambiente ni corriente del compresor.** No se puede verificar la causa de ninguna excursión. Por eso no se usa «falso positivo»: una «alarma potencialmente innecesaria» o una «excursión autolimitada» podría igual haber correspondido a un riesgo real para el producto.
4. **Segmentación de recuperación no estresada.** Los episodios estuvieron tan separados (≥ 20 min entre uno y otro, sin re-cruces rápidos) que ningún criterio de recuperación cambió la segmentación. La recomendación de histéresis + sostén es un seguro razonable, no una conclusión medida.
5. **La ventana «válida» tuvo manipulación.** El propio informe de la etapa anterior señala que entre el 22 y el 25/08 hubo actividad de prueba física dentro del período considerado válido (30 de los 43 episodios caen ahí). El comportamiento térmico de esos días puede no representar operación normal.
6. **Umbral alto ajustado.** El pico típico de los ciclos normales del equipo ronda -16,3 °C y en el tramo intermedio llegó a -15,5 °C de media: la operación normal roza el umbral de alarma. Varias excursiones de «banda 0» pueden ser ciclado normal del compresor más que incidentes; la lógica propuesta las tolera (tendencia + 30 min), pero conviene revisar el margen del umbral en sí (ya señalado en la etapa anterior).
7. **Todo lo simulado es retrospectivo.** No hay ni una alarma real en la historia del dispositivo (`events` vacía). Estas estrategias nunca corrieron sobre el flujo en vivo; la simulación asume reportes cada 5 min sin pérdidas (hubo 1 hueco de 4,5 min en 10 días) y sin el retardo de red/servidor real.
