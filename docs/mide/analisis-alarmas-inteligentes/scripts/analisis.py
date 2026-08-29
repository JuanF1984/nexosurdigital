# -*- coding: utf-8 -*-
"""
MIDE Frio - Etapa de analisis: logica inteligente de alarmas.
Trabajo 100% de solo lectura / simulacion sobre los CSV deduplicados de
docs/mide/analisis-prueba-prolongada/datos/. No toca firmware/backend/DB.
"""
import pandas as pd, numpy as np, json, textwrap
from pathlib import Path

SRC  = Path(r"C:\Users\JuanF\OneDrive\Documentos\NEXOSUR\nexosur-web\docs\mide\analisis-prueba-prolongada\datos")
OUT  = Path(r"C:\Users\JuanF\OneDrive\Documentos\NEXOSUR\nexosur-web\docs\mide\analisis-alarmas-inteligentes")
DAT  = OUT / "datos"
GRA  = OUT / "graficos"
for p in (DAT, GRA): p.mkdir(parents=True, exist_ok=True)

TH      = -15.0        # umbral alto real de la prueba (device_config)
HYST    = 0.5          # histeresis configurada
STEP    = 5.0          # minutos por periodo (resolucion nativa de measurements)

# ----------------------------------------------------------------------------
# 0. Carga
# ----------------------------------------------------------------------------
df = pd.read_csv(SRC / "mediciones_periodo.csv")
df["t"] = pd.to_datetime(df["period_start_art"])
df = df.sort_values("t").reset_index(drop=True)
df["dist"] = df["avg_value_c"] - TH          # grados por encima del umbral (avg)
N = len(df)
avg = df["avg_value_c"].to_numpy()
tmin = df["min_value_c"].to_numpy()
tmax = df["max_value_c"].to_numpy()
tarr = df["t"].to_list()

def fmt(ts):  return ts.strftime("%Y-%m-%d %H:%M")
def hm(ts):   return ts.strftime("%H:%M")

# ----------------------------------------------------------------------------
# 1. Reconstruccion de episodios (avg_value > -15, periodos consecutivos)
# ----------------------------------------------------------------------------
def build_episodes(close_pred, open_th=TH):
    """close_pred(i) -> True si el periodo i cuenta como 'ya recuperado/dentro'.
    Devuelve lista de (i_ini, i_fin) inclusive sobre indices de df."""
    eps, cur = [], None
    pend_close = 0
    for i in range(N):
        is_over = avg[i] > open_th
        if cur is None:
            if is_over:
                cur = [i, i]; pend_close = 0
        else:
            gap = (tarr[i] - tarr[cur[1]]).total_seconds()
            if gap > 15*60:                       # hueco largo -> corta episodio
                eps.append(tuple(cur)); cur = [i, i] if is_over else None
                pend_close = 0
                continue
            if avg[i] > open_th:
                cur[1] = i; pend_close = 0
            else:
                if close_pred(i):
                    pend_close += 1
                else:
                    pend_close = 0
                # criterio de cierre lo maneja close_run afuera; aca cerramos
                cur[1] = cur[1]        # no extiende
                eps.append(tuple(cur)); cur = None
    if cur is not None: eps.append(tuple(cur))
    return eps

# episodio base: cierra en el primer periodo con avg <= -15 (igual que analisis previo)
EPS = build_episodes(lambda i: True)
assert len(EPS) == 43, len(EPS)

def linreg_slope(y):
    """pendiente (unid/ min) por minimos cuadrados; x en minutos 0,5,10..."""
    n = len(y)
    if n < 2: return 0.0
    x = np.arange(n)*STEP
    x = x - x.mean(); y = np.asarray(y, float); y = y - y.mean()
    d = (x*x).sum()
    return float((x*y).sum()/d) if d else 0.0

def episode_record(a, b):
    seg = slice(a, b+1)
    va = avg[seg]; vmn = tmin[seg]; vmx = tmax[seg]; ts = tarr[a:b+1]
    n = b - a + 1
    pre = avg[a-1] if a > 0 else va[0]
    pre_t = tarr[a-1] if a > 0 else ts[0]
    kpk = int(np.argmax(va))                    # periodo del pico (avg)
    peak_avg = float(va[kpk]); peak_max = float(vmx.max())
    t_cross = ts[0]                             # inicio del 1er periodo sobre umbral
    t_peak  = ts[kpk]
    # cruce interpolado (estimacion; la resolucion real es 5 min)
    if pre < TH < va[0] and (va[0]-pre) != 0:
        frac = (TH - pre)/(va[0]-pre)
        t_cross_i = pre_t + (ts[0]-pre_t)*frac
    else:
        t_cross_i = t_cross
    dur_min   = n*STEP
    t_return  = ts[-1] + pd.Timedelta(minutes=STEP)   # vuelve a rango al cerrar el ultimo periodo
    min_cross_to_peak = (t_peak - t_cross).total_seconds()/60.0
    # inicio de recuperacion sostenida: ultimo periodo desde el cual la serie
    # no vuelve a subir mas de 0.1 C respecto de su minimo corrido hasta el final
    rec_k = kpk
    for j in range(kpk, n):
        if all(va[m] <= va[j] + 0.1 for m in range(j, n)):
            rec_k = j; break
    t_recover = ts[rec_k]
    min_peak_to_normal = (t_return - t_peak).total_seconds()/60.0
    # pendientes
    if min_cross_to_peak > 0:
        v_heat_mean = (peak_avg - pre)/((t_peak - pre_t).total_seconds()/60.0)
    else:
        v_heat_mean = (va[0]-pre)/STEP
    seq = np.concatenate(([pre], va))
    steps = np.diff(seq)/STEP
    v_heat_max = float(steps[:kpk+1].max()) if kpk >= 0 else float(steps.max())
    if n-1-rec_k >= 1:
        v_rec_mean = (va[-1]-va[rec_k])/((ts[-1]-ts[rec_k]).total_seconds()/60.0)
        v_rec_max  = float(np.diff(va[rec_k:]).min()/STEP)
    else:
        v_rec_mean = np.nan; v_rec_max = np.nan
    slope10 = (va[min(2,n-1)] - pre)/((min(2,n-1)+1)*STEP)   # pendiente primeros ~10 min
    return dict(
        episodio=f"E{0}",  # se renombra despues
        inicio_art=fmt(t_cross), fin_periodo_art=fmt(ts[-1]),
        n_periodos=n, duracion_fuera_rango_min=dur_min,
        t_cruce_periodo_art=hm(t_cross),
        t_cruce_interp_art=t_cross_i.strftime("%H:%M:%S"),
        avg_prev_c=round(float(pre),3),
        avg_primer_periodo_c=round(float(va[0]),3),
        secuencia_avg_c="|".join(f"{x:.2f}" for x in va),
        pico_avg_c=round(peak_avg,3), pico_max_c=round(peak_max,3),
        momento_pico_art=hm(t_peak),
        min_cruce_a_pico=round(min_cross_to_peak,1),
        dist_max_avg_c=round(peak_avg-TH,3), dist_max_max_c=round(peak_max-TH,3),
        inicio_recuperacion_art=hm(t_recover),
        min_pico_a_normal=round(min_peak_to_normal,1),
        min_cruce_a_normal=round(dur_min,1),
        v_heat_mean_c_min=round(float(v_heat_mean),3),
        v_heat_max_c_min=round(float(v_heat_max),3),
        v_rec_mean_c_min=round(float(v_rec_mean),3) if v_rec_mean==v_rec_mean else np.nan,
        v_rec_max_c_min=round(float(v_rec_max),3) if v_rec_max==v_rec_max else np.nan,
        pendiente_primeros_10min_c_min=round(float(slope10),3),
        _a=a, _b=b, _pre=pre, _va=va, _ts=ts, _kpk=kpk,
    )

recs = [episode_record(a,b) for (a,b) in EPS]
for k,r in enumerate(recs, 1):
    r["episodio"] = f"E{k:02d}"

ep_df = pd.DataFrame([{kk:vv for kk,vv in r.items() if not kk.startswith("_") and kk!="secuencia_avg_c" or kk=="secuencia_avg_c"} for r in recs])
cols_pub = ["episodio","inicio_art","fin_periodo_art","n_periodos","duracion_fuera_rango_min",
 "t_cruce_periodo_art","t_cruce_interp_art","avg_prev_c","avg_primer_periodo_c","secuencia_avg_c",
 "pico_avg_c","pico_max_c","momento_pico_art","min_cruce_a_pico","dist_max_avg_c","dist_max_max_c",
 "inicio_recuperacion_art","min_pico_a_normal","min_cruce_a_normal",
 "v_heat_mean_c_min","v_heat_max_c_min","v_rec_mean_c_min","v_rec_max_c_min","pendiente_primeros_10min_c_min"]
ep_df[cols_pub].to_csv(DAT/"episodios_reconstruidos.csv", index=False)
print("== Parte 1 == episodios:", len(recs))
print(ep_df[["episodio","inicio_art","n_periodos","pico_avg_c","dist_max_avg_c","min_cruce_a_pico","min_pico_a_normal","v_heat_mean_c_min"]].to_string(index=False))

# ----------------------------------------------------------------------------
# 2. Metodos de tendencia
# ----------------------------------------------------------------------------
def trend_methods(win):
    """win: lista de avg (mas viejo -> mas nuevo), >=1 elemento, paso 5 min.
    Devuelve dict metodo -> pendiente C/min."""
    v = np.asarray(win, float)
    out = {}
    out["slope_2p"]   = (v[-1]-v[-2])/STEP if len(v)>=2 else 0.0
    out["slope_3p_ep"] = (v[-1]-v[-3])/(2*STEP) if len(v)>=3 else out["slope_2p"]
    out["slope_4p_ep"] = (v[-1]-v[-4])/(3*STEP) if len(v)>=4 else out.get("slope_3p_ep",out["slope_2p"])
    out["linreg_3p"]  = linreg_slope(v[-3:]) if len(v)>=3 else out["slope_2p"]
    out["linreg_4p"]  = linreg_slope(v[-4:]) if len(v)>=4 else out.get("linreg_3p",out["slope_2p"])
    # media movil: MA(2 nuevos) vs MA(2 previos)
    if len(v)>=4:
        out["mm_2v2"] = (v[-2:].mean() - v[-4:-2].mean())/(2*STEP)
    elif len(v)>=2:
        out["mm_2v2"] = (v[-1]-v[-2])/STEP
    else:
        out["mm_2v2"] = 0.0
    # valor actual vs media movil 3
    out["val_vs_mm3"] = (v[-1] - v[-3:].mean())/STEP if len(v)>=3 else 0.0
    return out

def classify(slope, db):
    return "ASC" if slope > db else ("DESC" if slope < -db else "EST")

METHODS = ["slope_2p","slope_3p_ep","slope_4p_ep","linreg_3p","linreg_4p","mm_2v2","val_vs_mm3"]
DBS = [0.03, 0.05, 0.08, 0.10, 0.15]

# --- ruido de cada metodo en operacion basal (sin excursion) -----------------
inep = np.zeros(N, bool)
for r in recs: inep[r["_a"]:r["_b"]+1] = True
baseline_slopes = {m: [] for m in METHODS}
for gi in range(4, N):
    if inep[gi] or inep[gi-1]: continue
    if not (-23 <= avg[gi] <= -16):   continue
    tm = trend_methods(list(avg[gi-4:gi+1]))
    for m in METHODS: baseline_slopes[m].append(tm[m])
base_noise = {m: float(np.percentile(np.abs(baseline_slopes[m]), 90)) for m in METHODS}
print("\n== Parte 2 == ruido basal de la pendiente (p90 |pendiente| en C/min, operacion normal)")
for m in METHODS: print(f"  {m:12s} p90={base_noise[m]:.3f}   p50={np.percentile(np.abs(baseline_slopes[m]),50):.3f}")

# --- verdad de referencia: antes del pico = ASC, despues del pico = DESC -----
#     (mide directamente lo que pide el usuario: 'sigue calentandose' vs 'ya empezo a recuperarse')
samples = []   # (ep, j, gi, truth, kpk, n)
for r in recs:
    a=r["_a"]; b=r["_b"]; n=b-a+1; kpk=r["_kpk"]
    for j in range(n):
        if j == 0: continue                      # sin historia
        gi=a+j
        if   j < kpk:  truth = "ASC"
        elif j > kpk:  truth = "DESC"
        else:          truth = "PICO"
        samples.append((r["episodio"], j, gi, truth, kpk, n))

def eval_method(m, db):
    asc_ok=asc_tot=0; desc_ok=desc_tot=0
    premature_desc=0; asc_denom=0          # dice DESC estando aun antes del pico (error peligroso)
    missed_turn=0; post_denom=0            # sigue diciendo ASC >=10 min despues del pico
    flips=0; prev=None; prev_ep=None
    for ep,j,gi,truth,kpk,n in samples:
        lab = classify(trend_methods(list(avg[max(0,gi-4):gi+1]))[m], db)
        if prev_ep==ep and prev is not None and lab!=prev: flips+=1
        prev=lab; prev_ep=ep
        if truth=="ASC":
            asc_tot+=1; asc_ok+=(lab=="ASC"); asc_denom+=1; premature_desc+=(lab=="DESC")
        elif truth=="DESC":
            desc_tot+=1; desc_ok+=(lab=="DESC")
            if j>=kpk+2:
                post_denom+=1; missed_turn+=(lab=="ASC")
    # especificidad basal
    stab_tot=stab_est=0
    for gi in range(4,N):
        if inep[gi] or inep[gi-1]: continue
        if not (-23<=avg[gi]<=-16): continue
        lab=classify(trend_methods(list(avg[gi-4:gi+1]))[m], db)
        stab_tot+=1; stab_est+=(lab=="EST")
    return dict(metodo=m, deadband=db,
        detecta_ascenso=round(asc_ok/max(asc_tot,1),3),
        detecta_recuperacion=round(desc_ok/max(desc_tot,1),3),
        error_desc_prematuro=round(premature_desc/max(asc_denom,1),3),
        error_asc_tardio=round(missed_turn/max(post_denom,1),3),
        estable_en_basal=round(stab_est/max(stab_tot,1),3),
        cambios_etiqueta_por_muestra=round(flips/max(len(samples),1),3))

trend_eval = pd.DataFrame([eval_method(m,db) for m in METHODS for db in DBS])
# score: premia detectar ascenso y recuperacion + estabilidad basal;
#        penaliza fuerte el error peligroso (DESC prematuro) y el ruido de etiqueta
trend_eval["score"] = ( trend_eval.detecta_ascenso + trend_eval.detecta_recuperacion
                        + 0.5*trend_eval.estable_en_basal
                        - 2.0*trend_eval.error_desc_prematuro
                        - 1.0*trend_eval.error_asc_tardio
                        - 1.0*trend_eval.cambios_etiqueta_por_muestra )
trend_eval = trend_eval.sort_values("score", ascending=False).reset_index(drop=True)
trend_eval.to_csv(DAT/"tendencia_metodos_comparacion.csv", index=False)
print("\ncomparacion de metodos de tendencia (ordenado por score)")
print(trend_eval.to_string(index=False))

SCORE_TOP_M, SCORE_TOP_DB = trend_eval.iloc[0].metodo, float(trend_eval.iloc[0].deadband)
# Eleccion razonada (no el maximo score bruto): el tope de score es slope_2p@0.03,
# mas sensible pero mas ruidoso y con estabilidad basal casi nula. La pendiente sobre
# 3 puntos (= (T_now - T_hace_15min)/15) con banda muerta 0.05 C/min tiene CERO errores
# peligrosos en el set historico (nunca dice 'recuperando' mientras sigue subiendo, ni
# 'subiendo' >=10 min despues del pico) y usa exactamente los 15 min de historia que la
# logica de alarma ya espera. Es la opcion firmware-friendly.
BEST_M, BEST_DB = "linreg_3p", 0.05
print(f"\nTope de score bruto: {SCORE_TOP_M} @ {SCORE_TOP_DB}")
print(f"Metodo elegido para las estrategias (eleccion razonada): {BEST_M}  deadband={BEST_DB} C/min "
      f"[= pendiente sobre 3 muestras / 15 min]")

def trend_online(gi, db=BEST_DB, m=BEST_M):
    hist = list(avg[max(0, gi-4):gi+1])
    return classify(trend_methods(hist)[m], db)

# ----------------------------------------------------------------------------
# 3+5. Simulacion de estrategias (online, resolucion 5 min)
# ----------------------------------------------------------------------------
def band_rel(dist):
    if dist <= 2.0: return 0          # 0..+2  observacion normal
    if dist <= 5.0: return 1          # +2..+5 desviacion importante
    return 2                          # >+5    desviacion grave

def simulate(strategy, **kw):
    """Devuelve dict episodio -> (alarmo, idx_local, min_desde_cruce, temp_alarma, motivo)."""
    res = {}
    for r in recs:
        a=r["_a"]; b=r["_b"]; n=b-a+1
        va=r["_va"]; alarmed=False
        run_max_dist = -99
        for j in range(n):
            gi=a+j
            elapsed = j*STEP
            d = va[j]-TH
            run_max_dist = max(run_max_dist, d)
            tr = trend_online(gi) if j>=1 else "ASC"
            fired, motivo = strategy(j, elapsed, d, run_max_dist, tr, va, n, kw)
            if fired:
                res[r["episodio"]] = (True, j, elapsed, float(va[j]), motivo)
                alarmed=True; break
        if not alarmed:
            res[r["episodio"]] = (False, None, None, None, "observado sin alarma")
    return res

def strat_A(j, elapsed, d, rmd, tr, va, n, kw):
    if elapsed >= 15: return True, "15 min fuera de rango"
    return False, ""

def strat_B(j, elapsed, d, rmd, tr, va, n, kw):
    if elapsed < 15: return False, ""
    if tr == "ASC":  return True, "15 min + sigue calentando"
    if tr == "DESC": return False, ""                       # se mantiene observacion
    if elapsed >= 30: return True, "estable fuera de rango >=30 min"
    return False, ""

def strat_C(j, elapsed, d, rmd, tr, va, n, kw):
    W = kw.get("W", {0:15, 1:10, 2:5})
    grave_now = kw.get("grave_now", True)
    b = band_rel(rmd)
    if b == 2 and grave_now and elapsed >= W[2]:
        return True, f"desviacion grave (>+5C), {W[2]} min"
    if elapsed < W[b]: return False, ""
    if tr == "DESC" and b < 2: return False, ""             # recuperando -> hold
    if tr == "EST" and b == 0 and elapsed < 30: return False, ""
    return True, f"banda {b}, ventana {W[b]} min, tendencia {tr}"

def strat_D(j, elapsed, d, rmd, tr, va, n, kw):
    Tmax = kw.get("Tmax", 15.0); k = kw.get("k", 3.0)
    rec_override = kw.get("rec_override", True)
    hard = kw.get("hard", 8.0)                              # dist que fuerza alarma ya
    allowed = max(0.0, Tmax - k*rmd)
    if rmd >= hard: return True, f"dist +{rmd:.1f}C >= {hard} (alarma inmediata)"
    if elapsed < allowed: return False, ""
    if tr == "DESC" and rec_override: return False, ""
    return True, f"dist +{rmd:.1f}C -> tolerancia {allowed:.0f} min, tendencia {tr}"

SIMS = {
    "A_solo_tiempo":       simulate(strat_A),
    "B_tiempo_tendencia":  simulate(strat_B),
    "C_bandas_15_10_5":    simulate(strat_C, W={0:15,1:10,2:5}, grave_now=True),
    "C_bandas_15_8_0":     simulate(strat_C, W={0:15,1:8,2:0},  grave_now=True),
    "D_dinamica_k3_T15":   simulate(strat_D, Tmax=15.0, k=3.0, hard=8.0, rec_override=True),
    "D_dinamica_k2_T20":   simulate(strat_D, Tmax=20.0, k=2.0, hard=8.0, rec_override=True),
    "D_dinamica_k3_T15_sinRec": simulate(strat_D, Tmax=15.0, k=3.0, hard=8.0, rec_override=False),
}

# ----------------------------------------------------------------------------
# 7. Comparacion de resultados
# ----------------------------------------------------------------------------
peak_by_ep = {r["episodio"]: r["pico_avg_c"] for r in recs}
kpk_by_ep  = {r["episodio"]: r["_kpk"] for r in recs}
n_by_ep    = {r["episodio"]: (r["_b"]-r["_a"]+1) for r in recs}
dur_by_ep  = {r["episodio"]: (r["_b"]-r["_a"]+1)*STEP for r in recs}
# clasificacion por banda de gravedad del PICO (distancia avg sobre umbral), igual que Partes 3/9
def sev_band(distpk):
    return 0 if distpk <= 2 else (1 if distpk <= 5 else 2)
band_by_ep = {r["episodio"]: sev_band(r["dist_max_avg_c"]) for r in recs}
# grave     : el pico entro en banda 2  (> +5 C sobre umbral, i.e. avg > -10 C)
sev_by_ep  = {ep: (b == 2) for ep, b in band_by_ep.items()}
# excursion pequeña        : pico en banda 0  (<= +2 C sobre umbral)
small_by_ep = {ep: (b == 0) for ep, b in band_by_ep.items()}
# pequeña Y breve (recuperada sin intervencion): banda 0 y duracion <= 20 min
smallbrief_by_ep = {r["episodio"]: (band_by_ep[r["episodio"]] == 0 and dur_by_ep[r["episodio"]] <= 20) for r in recs}
from collections import Counter
_bc = Counter(band_by_ep.values())
print(f"\nepisodios por banda de gravedad del pico:  banda0(<=+2C)={_bc[0]}  banda1(+2..+5C)={_bc[1]}  banda2(>+5C)={_bc[2]}")

per_ep_rows = []
summary_rows = []
for name, sim in SIMS.items():
    n_alarm=0; n_obs=0; late_sev=0; unnec=0; unnec_brief=0; anticip=[]; talarm_temp=[]
    for ep,(fired,j,elapsed,temp,motivo) in sim.items():
        kpk = kpk_by_ep[ep]
        if fired:
            n_alarm+=1
            anticip.append((kpk - j)*STEP)      # min antes del pico (positivo = anticipa)
            talarm_temp.append(temp)
            if sev_by_ep[ep] and (j > kpk):     # alarmo despues del pico en un episodio grave
                late_sev+=1
            if small_by_ep[ep]:      unnec+=1
            if smallbrief_by_ep[ep]: unnec_brief+=1
        else:
            n_obs+=1
        per_ep_rows.append(dict(estrategia=name, episodio=ep,
            pico_avg_c=peak_by_ep[ep], n_periodos=n_by_ep[ep], duracion_min=dur_by_ep[ep],
            grave_real=sev_by_ep[ep], excursion_pequena=small_by_ep[ep],
            pequena_y_breve=smallbrief_by_ep[ep],
            alarmo=fired, idx_periodo_alarma=j,
            min_desde_cruce=elapsed, temp_alarma_c=temp,
            min_antes_del_pico=((kpk-j)*STEP) if fired else None,
            motivo=motivo))
    summary_rows.append(dict(estrategia=name,
        alarmas_totales=n_alarm, episodios_sin_alarma=n_obs,
        episodios_con_alarma=n_alarm,
        graves_reales=sum(sev_by_ep.values()),
        graves_alertados_tarde=late_sev,
        alarmas_en_excursion_pequena=unnec,
        alarmas_en_excursion_pequena_y_breve=unnec_brief,
        anticipacion_media_min=round(float(np.mean(anticip)),1) if anticip else None,
        anticipacion_mediana_min=round(float(np.median(anticip)),1) if anticip else None,
        temp_media_al_alarmar_c=round(float(np.mean(talarm_temp)),2) if talarm_temp else None))

per_ep_df = pd.DataFrame(per_ep_rows)
per_ep_df.to_csv(DAT/"resultado_por_episodio_estrategia.csv", index=False)
comp_df = pd.DataFrame(summary_rows)
print("\n== Parte 7 == comparacion de estrategias")
print(comp_df.to_string(index=False))

# ----------------------------------------------------------------------------
# 4. Criterio de recuperacion / cierre de evento
# ----------------------------------------------------------------------------
def segment(open_th, close_val, close_sustain):
    """Abre en avg>open_th; cierra tras `close_sustain` periodos consecutivos con avg<=close_val."""
    eps=[]; cur=None; streak=0
    for i in range(N):
        if cur is None:
            if avg[i] > open_th: cur=[i,i]; streak=0
        else:
            if (tarr[i]-tarr[cur[1]]).total_seconds() > 15*60:
                eps.append(tuple(cur)); cur=[i,i] if avg[i]>open_th else None; streak=0; continue
            if avg[i] > open_th:
                cur[1]=i; streak=0
            else:
                streak+=1
                if avg[i] <= close_val and streak >= close_sustain:
                    eps.append(tuple(cur)); cur=None; streak=0
    if cur is not None: eps.append(tuple(cur))
    return eps

CRIT = {
 "R1_avg<=-15.0_x1periodo":      (TH, TH,      1),
 "R2_avg<=-15.5_x1periodo":      (TH, TH-0.5,  1),   # ~ histeresis 0.5 actual (delay<1 periodo)
 "R3_avg<=-16.0_x1periodo":      (TH, TH-1.0,  1),
 "R4_avg<=-15.0_x2periodos":     (TH, TH,      2),   # sostenido 10 min
 "R5_avg<=-15.5_x2periodos":     (TH, TH-0.5,  2),
 "R6_avg<=-15.5_x3periodos":     (TH, TH-0.5,  3),   # sostenido 15 min
}
base_eps = segment(*CRIT["R1_avg<=-15.0_x1periodo"])
rec_rows=[]
for name,(ot,cv,cs) in CRIT.items():
    e = segment(ot,cv,cs)
    durs=[(b-a+1)*STEP for a,b in e]
    rec_rows.append(dict(criterio=name, n_episodios=len(e), merges_vs_R1=len(base_eps)-len(e),
        dur_media_min=round(float(np.mean(durs)),1), dur_max_min=float(np.max(durs)),
        min_extra_evento_abierto_vs_R1=round((cs-1)*STEP,1)))
rec_df = pd.DataFrame(rec_rows)
rec_df.to_csv(DAT/"recuperacion_criterios.csv", index=False)
print("\n== Parte 4 == criterios de recuperacion / cierre de evento")
print(rec_df.to_string(index=False))

# separacion entre episodios: periodos consecutivos con avg<=-15 entre un episodio y el siguiente
gaps=[]
for k in range(len(base_eps)-1):
    b1=base_eps[k][1]; a2=base_eps[k+1][0]
    gaps.append(a2-b1-1)
gaps=np.array(gaps)
print(f"separacion entre episodios (periodos <=-15 intermedios): min={gaps.min()}  p10={np.percentile(gaps,10):.0f}"
      f"  mediana={np.median(gaps):.0f}  -> {(gaps<=2).sum()} pares con <=2 periodos de separacion")

# chattering con la senal 'blanda' max_value>-15 (picos que no llegan a subir el avg)
soft = tmax > TH
runs=[]; s=None
for i in range(N):
    if soft[i] and s is None: s=i
    if (not soft[i]) and s is not None: runs.append((s,i-1)); s=None
if s is not None: runs.append((s,N-1))
soft_gaps=[runs[k+1][0]-runs[k][1]-1 for k in range(len(runs)-1)]
chatter_soft=sum(1 for g in soft_gaps if g<=1)
print(f"señal blanda max_value>-15: {len(runs)} rachas, {chatter_soft} separadas por <=1 periodo "
      f"(flapping potencial si se alarmara por max_value)")

# comportamiento de la cola: avg 5 y 10 min despues de cerrar cada episodio (R1)
tail5=[]; tail10=[]
for a,b in base_eps:
    if b+1 < N: tail5.append(avg[b+1]-TH)
    if b+2 < N: tail10.append(avg[b+2]-TH)
print(f"al cerrar el episodio (R1): avg a +5min  media {np.mean(tail5):+.2f} C vs umbral "
      f"(mas cerca del umbral {np.max(tail5):+.2f}, mas lejos {np.min(tail5):+.2f})")
print(f"                            avg a +10min media {np.mean(tail10):+.2f} C vs umbral "
      f"(mas cerca {np.max(tail10):+.2f}, mas lejos {np.min(tail10):+.2f})")
reopen = sum(1 for a,b in base_eps if b+2<N and (avg[b+1]>TH or avg[b+2]>TH))
print(f"episodios que vuelven a cruzar -15 dentro de los 10 min de haber cerrado: {reopen}")

# ----------------------------------------------------------------------------
# 5. Alarmas anticipadas por gravedad (barrido de cortes de temperatura)
# ----------------------------------------------------------------------------
CUTS = [-13.0,-12.0,-11.0,-10.0,-9.0,-8.0,-7.0]
antic_rows=[]
for C in CUTS:
    trips=0; unnec=0; graves=0; ahorro=[]; antes_pico=[]; temps=[]
    for r in recs:
        va=r["_va"]; n=len(va); kpk=r["_kpk"]
        hit=None
        for j in range(n):
            if va[j] >= C: hit=j; break
        if hit is None: continue
        trips+=1
        temps.append(float(va[hit]))
        ahorro.append(15 - hit*STEP)               # min "ahorrados" vs regla de 15 min
        antes_pico.append((kpk-hit)*STEP)
        # autolimitada: pico apenas por encima del corte y vuelve a rango <=20 min despues del hit
        vuelve = n*STEP - hit*STEP
        if (r["pico_avg_c"] <= C + 1.0) and (vuelve <= 20):
            unnec+=1
        if r["dist_max_avg_c"] > 5.0:          # pico en banda 2 (grave), consistente con Parte 7
            graves+=1
    antic_rows.append(dict(corte_avg_c=C, dist_sobre_umbral=C-TH,
        episodios_que_disparan=trips,
        de_esos_banda2_grave=graves,
        de_esos_pico_apenas_sobre_corte_y_breve=unnec,
        min_ahorro_medio_vs_15=round(float(np.mean(ahorro)),1) if ahorro else None,
        min_antes_del_pico_medio=round(float(np.mean(antes_pico)),1) if antes_pico else None,
        temp_media_al_disparar_c=round(float(np.mean(temps)),2) if temps else None))
antic_df = pd.DataFrame(antic_rows)
antic_df.to_csv(DAT/"alarmas_anticipadas.csv", index=False)
print("\n== Parte 5 == alarmas anticipadas por gravedad (barrido de cortes)")
print(antic_df.to_string(index=False))

# ----------------------------------------------------------------------------
# 8. Velocidad termica: aporta a la clasificacion?
# ----------------------------------------------------------------------------
vt = ep_df[["episodio","pico_avg_c","dist_max_avg_c","min_cruce_a_pico",
            "v_heat_mean_c_min","v_heat_max_c_min","v_rec_mean_c_min","v_rec_max_c_min",
            "pendiente_primeros_10min_c_min"]].copy()
vt.to_csv(DAT/"velocidad_termica.csv", index=False)
p10 = ep_df["pendiente_primeros_10min_c_min"].to_numpy()
dmax= ep_df["dist_max_avg_c"].to_numpy()
mask = ~np.isnan(p10)
corr = float(np.corrcoef(p10[mask], dmax[mask])[0,1])
hi = p10 >= 0.30
print("\n== Parte 8 == velocidad termica")
print(f"corr(pendiente primeros 10 min, distancia maxima) = {corr:.2f}")
print(f"episodios con pendiente_10min >= 0.30 C/min: {hi.sum()} -> "
      f"{(dmax[hi] > 2).sum()}/{hi.sum()} superan +2C  (banda importante/grave)")
print(f"episodios con pendiente_10min <  0.30 C/min: {(~hi).sum()} -> "
      f"{(dmax[~hi] > 2).sum()}/{(~hi).sum()} superan +2C")
print("v_heat_mean  media/mediana/max:", round(np.nanmean(ep_df.v_heat_mean_c_min),3),
      round(np.nanmedian(ep_df.v_heat_mean_c_min),3), round(np.nanmax(ep_df.v_heat_mean_c_min),3))
print("v_rec_mean   media/mediana/min:", round(np.nanmean(ep_df.v_rec_mean_c_min),3),
      round(np.nanmedian(ep_df.v_rec_mean_c_min),3), round(np.nanmin(ep_df.v_rec_mean_c_min),3))

# ----------------------------------------------------------------------------
# 6. Replay cronologico
# ----------------------------------------------------------------------------
def alarm_marks_for_ep(ep):
    marks = {}
    for name, sim in SIMS.items():
        fired,j,elapsed,temp,motivo = sim[ep]
        if fired: marks.setdefault(j, []).append(name)
    return marks

replay_rows=[]
for r in recs:
    ep=r["episodio"]; a=r["_a"]; b=r["_b"]; va=r["_va"]; ts=r["_ts"]; kpk=r["_kpk"]
    pre=r["_pre"]
    marks = alarm_marks_for_ep(ep)
    for j in range(len(va)):
        gi=a+j
        replay_rows.append(dict(
            episodio=ep, fecha=ts[j].strftime("%Y-%m-%d"), hora=hm(ts[j]),
            min_desde_cruce=j*STEP,
            avg_c=round(float(va[j]),3), min_c=round(float(tmin[gi]),3), max_c=round(float(tmax[gi]),3),
            dist_sobre_umbral_c=round(float(va[j]-TH),3),
            pendiente_2p_c_min=round((va[j]-(va[j-1] if j>0 else pre))/STEP,3),
            pendiente_linreg3_c_min=round(linreg_slope(list(avg[max(0,gi-2):gi+1])),3),
            tendencia=trend_online(gi) if j>=1 else "ASC",
            es_pico=(j==kpk),
            alarma_estrategias="|".join(marks.get(j, [])),
        ))
replay_df = pd.DataFrame(replay_rows)
replay_df.to_csv(DAT/"replay_cronologico.csv", index=False)
print("\n== Parte 6 == replay_cronologico.csv filas:", len(replay_df))

# --- replays legibles (texto) para episodios seleccionados ---
def pick(cond, k=2):
    got=[r["episodio"] for r in recs if cond(r)]
    return got[:k]

sel = []
sel += [("pequenos", e) for e in pick(lambda r: (r["_b"]-r["_a"]+1) <= 2, 3)]
sel += [("autolimitados_recuperados", e) for e in pick(lambda r: r["pico_avg_c"] <= -13.5 and (r["_b"]-r["_a"]+1) >= 3, 3)]
sel += [("cerca_de_-13", e) for e in pick(lambda r: -13.6 <= r["pico_avg_c"] <= -12.4, 3)]
sel += [("cerca_de_-10", e) for e in pick(lambda r: -11.2 <= r["pico_avg_c"] <= -9.0, 3)]
sel += [("graves_-8_o_mas", e) for e in pick(lambda r: r["pico_avg_c"] >= -8.0, 5)]
# maximo absoluto
emax = max(recs, key=lambda r: r["pico_max_c"])["episodio"]
sel += [("maximo_absoluto_del_ensayo", emax)]

seen=set(); sel2=[]
for tag,e in sel:
    if (tag,e) in seen: continue
    seen.add((tag,e)); sel2.append((tag,e))

lines=[]
recmap={r["episodio"]:r for r in recs}
for tag,ep in sel2:
    r=recmap[ep]; va=r["_va"]; ts=r["_ts"]; kpk=r["_kpk"]; pre=r["_pre"]
    marks=alarm_marks_for_ep(ep)
    lines.append(f"### {ep}  ({tag})   {ts[0].strftime('%d/%m %H:%M')}  |  pico avg {r['pico_avg_c']:.2f} C (max {r['pico_max_c']:.2f})  |  dur {len(va)*5} min")
    tcross = ts[0] - pd.Timedelta(minutes=5)
    lines.append(f"{hm(tcross)}  (aprox) cruza -15 C   [prev {pre:.2f} C]")
    for j in range(len(va)):
        tag_j=[]
        if j==kpk: tag_j.append(f"<- PICO {va[j]:.2f} C")
        if j==r["_kpk"]:
            pass
        m=marks.get(j,[])
        if m: tag_j.append("ALARMA: "+", ".join(m))
        if hm(ts[j])==r["inicio_recuperacion_art"] and j!=kpk: tag_j.append("(inicio recuperacion sostenida)")
        lines.append(f"{hm(ts[j])}  {va[j]:6.2f} C  (+{va[j]-TH:4.1f})  tend={trend_online(r['_a']+j) if j>=1 else 'ASC':4s}  {' '.join(tag_j)}")
    tret = ts[-1] + pd.Timedelta(minutes=5)
    lines.append(f"{hm(tret)}  vuelve a rango (<= -15 C)")
    lines.append("")
(Path(DAT/"replays_legibles.txt")).write_text("\n".join(lines), encoding="utf-8")
print("replays_legibles.txt escrito con", len(sel2), "episodios")

# ----------------------------------------------------------------------------
# guardar objetos para el script de graficos
# ----------------------------------------------------------------------------
import pickle
with open(DAT/"_ctx.pkl","wb") as f:
    pickle.dump(dict(
        recs=[{k:v for k,v in r.items()} for r in recs],
        SIMS={k:v for k,v in SIMS.items()},
        comp_df=comp_df, antic_df=antic_df, rec_df=rec_df, ep_df=ep_df,
        trend_eval=trend_eval, BEST_M=BEST_M, BEST_DB=BEST_DB, TH=TH,
    ), f)
print("\nOK - contexto guardado")
