# -*- coding: utf-8 -*-
import pickle, numpy as np, pandas as pd
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

OUT = Path(r"C:\Users\JuanF\OneDrive\Documentos\NEXOSUR\nexosur-web\docs\mide\analisis-alarmas-inteligentes")
DAT, GRA = OUT/"datos", OUT/"graficos"
ctx = pickle.load(open(DAT/"_ctx.pkl","rb"))
recs = ctx["recs"]; SIMS = ctx["SIMS"]; TH = ctx["TH"]
ep_df = ctx["ep_df"]; antic_df = ctx["antic_df"]; comp_df = ctx["comp_df"]
recmap = {r["episodio"]: r for r in recs}
STEP = 5.0
plt.rcParams.update({"figure.dpi":110, "font.size":9, "axes.grid":True, "grid.alpha":.3})

BANDCOL = {0:"#4c9f70", 1:"#e0a13c", 2:"#c0392b"}
def bandof(d): return 0 if d<=2 else (1 if d<=5 else 2)

# ---------------------------------------------------------------- 01
d = ep_df.copy()
d["band"] = d["dist_max_avg_c"].map(bandof)
fig, ax = plt.subplots(figsize=(8,5.5))
for b,g in d.groupby("band"):
    ax.scatter(g.duracion_fuera_rango_min, g.dist_max_avg_c, c=BANDCOL[b], s=55,
               label=["banda 0 (<=+2 C)","banda 1 (+2..+5 C)","banda 2 (>+5 C)"][b], edgecolor="k", lw=.4)
for _,r in d.iterrows():
    if r.dist_max_avg_c>3 or r.duracion_fuera_rango_min>=60:
        ax.annotate(r.episodio, (r.duracion_fuera_rango_min, r.dist_max_avg_c),
                    fontsize=7, xytext=(3,3), textcoords="offset points")
ax.axhline(2, color="#888", ls="--", lw=.8); ax.axhline(5, color="#888", ls="--", lw=.8)
ax.set_xlabel("Duracion fuera de rango (min)"); ax.set_ylabel("Distancia maxima del pico sobre -15 C (C)")
ax.set_title("Episodios sobre umbral alto: distancia del pico vs duracion (n=43)")
ax.legend(); fig.tight_layout(); fig.savefig(GRA/"01_distancia_vs_duracion.png"); plt.close(fig)

# ---------------------------------------------------------------- 02
fig, axs = plt.subplots(1,2, figsize=(11,4.6))
axs[0].scatter(d.dist_max_avg_c, d.min_cruce_a_pico, c=[BANDCOL[b] for b in d.band], s=50, edgecolor="k", lw=.4)
axs[0].set_xlabel("Distancia maxima sobre umbral (C)"); axs[0].set_ylabel("Minutos del cruce al pico")
axs[0].set_title("Tiempo hasta el pico vs gravedad")
axs[0].axhline(15, color="#c0392b", ls="--", lw=1, label="regla de 15 min")
axs[0].legend()
axs[1].hist(d.min_cruce_a_pico, bins=np.arange(0,90,5), color="#4472c4", edgecolor="k")
axs[1].axvline(15, color="#c0392b", ls="--", lw=1.2, label="15 min")
axs[1].set_xlabel("Minutos del cruce al pico"); axs[1].set_ylabel("Episodios")
axs[1].set_title("Distribucion del tiempo hasta el pico")
axs[1].legend()
fig.tight_layout(); fig.savefig(GRA/"02_tiempo_hasta_pico.png"); plt.close(fig)

# ---------------------------------------------------------------- 03
fig, axs = plt.subplots(1,3, figsize=(13,4.2))
axs[0].hist(d.v_heat_mean_c_min, bins=15, color="#c0392b", edgecolor="k")
axs[0].set_title("Velocidad media de calentamiento"); axs[0].set_xlabel("C/min")
axs[1].hist(d.v_rec_mean_c_min.dropna(), bins=15, color="#2e86c1", edgecolor="k")
axs[1].set_title("Velocidad media de recuperacion"); axs[1].set_xlabel("C/min")
axs[2].scatter(d.pendiente_primeros_10min_c_min, d.dist_max_avg_c,
               c=[BANDCOL[b] for b in d.band], s=50, edgecolor="k", lw=.4)
axs[2].axvline(0.30, color="#888", ls="--", lw=1, label="0.30 C/min")
axs[2].axhline(2, color="#888", ls=":", lw=.8)
axs[2].set_xlabel("Pendiente primeros ~10 min (C/min)"); axs[2].set_ylabel("Distancia maxima (C)")
axs[2].set_title("Pendiente temprana vs pico alcanzado"); axs[2].legend()
fig.tight_layout(); fig.savefig(GRA/"03_pendiente_termica.png"); plt.close(fig)

# ---------------------------------------------------------------- 04  momento de alarma por estrategia
STRATS = ["A_solo_tiempo","B_tiempo_tendencia","C_bandas_15_8_0","D_dinamica_k2_T20"]
SCOL = {"A_solo_tiempo":"#7f8c8d","B_tiempo_tendencia":"#2e86c1",
        "C_bandas_15_8_0":"#c0392b","D_dinamica_k2_T20":"#8e44ad"}
show = ["E02","E08","E37","E31","E38","E04","E01","E09","E13","E43","E35","E30","E42","E21","E06"]
show = [e for e in show if e in recmap]
fig, ax = plt.subplots(figsize=(10, 7))
for row,ep in enumerate(show):
    r = recmap[ep]; va = np.asarray(r["_va"]); n=len(va); kpk=r["_kpk"]
    dur = n*STEP
    ax.plot([0,dur],[row,row], color="#ccc", lw=6, solid_capstyle="butt", zorder=1)
    ax.plot(kpk*STEP, row, "k^", ms=7, zorder=3)                      # pico
    ax.plot(dur, row, "k|", ms=12, zorder=3)                          # vuelta a rango
    for k,s in enumerate(STRATS):
        fired,j,el,temp,mot = SIMS[s][ep]
        if fired:
            ax.plot(j*STEP, row+ (k-1.5)*0.12, "o", color=SCOL[s], ms=7, zorder=4)
    ax.annotate(f"{ep}  pico {r['pico_avg_c']:.1f}C", (dur+2, row), va="center", fontsize=7)
ax.set_yticks(range(len(show))); ax.set_yticklabels(show)
ax.set_xlabel("Minutos desde el cruce de -15 C")
ax.set_title("Momento de alarma de cada estrategia  (^ pico,  | vuelta a rango)")
handles = [plt.Line2D([0],[0], marker="o", ls="", color=SCOL[s], label=s) for s in STRATS]
ax.legend(handles=handles, loc="lower right", fontsize=8)
ax.set_xlim(-3, 130)
fig.tight_layout(); fig.savefig(GRA/"04_momento_de_alarma_por_estrategia.png"); plt.close(fig)

# ---------------------------------------------------------------- 05  episodios representativos
rep = [("E02","excursion minima"),("E06","larga y poco profunda"),
       ("E37","pico ~ -12 C"),("E38","pico ~ -10 C"),
       ("E21","spike inmediato a -7.7 C"),("E42","maximo absoluto del ensayo (-4.7 C)")]
rep = [(e,t) for e,t in rep if e in recmap]
fig, axs = plt.subplots(2,3, figsize=(14,7.5)); axs=axs.ravel()
for ax,(ep,t) in zip(axs, rep):
    r=recmap[ep]; va=np.asarray(r["_va"]); n=len(va)
    x=np.arange(n)*STEP
    pre=r["_pre"]
    ax.plot(np.r_[-5,x], np.r_[pre,va], "-o", color="#333", ms=4)
    ax.axhline(TH, color="#c0392b", lw=1); ax.axhline(TH+2, color="#888", ls="--", lw=.8)
    ax.axhline(TH+5, color="#888", ls="--", lw=.8)
    ax.axhspan(TH+5, 0, color="#c0392b", alpha=.06)
    ax.axhspan(TH+2, TH+5, color="#e0a13c", alpha=.08)
    for s in STRATS:
        fired,j,el,temp,mot = SIMS[s][ep]
        if fired: ax.plot(j*STEP, va[j], "o", color=SCOL[s], ms=9, mfc="none", mew=2)
    ax.set_title(f"{ep}: {t}", fontsize=9)
    ax.set_xlabel("min desde cruce"); ax.set_ylabel("avg C")
handles = [plt.Line2D([0],[0], marker="o", ls="", mfc="none", mew=2, color=SCOL[s], label=s) for s in STRATS]
fig.legend(handles=handles, loc="upper center", ncol=4, fontsize=8)
fig.tight_layout(rect=[0,0,1,0.95]); fig.savefig(GRA/"05_episodios_representativos.png"); plt.close(fig)

# ---------------------------------------------------------------- 06  comparacion estrategias
c = comp_df.set_index("estrategia").copy()
c["graves_sin_alarma"] = 8 - (c["graves_reales"] - 0)   # placeholder, recompute below
# recomputar graves sin alarma desde el CSV por episodio
_r = pd.read_csv(DAT/"resultado_por_episodio_estrategia.csv")
gsa = _r[_r.grave_real==True].groupby("estrategia").alarmo.apply(lambda s:(~s.astype(bool)).sum())
c["graves_sin_alarma"] = gsa
metrics = ["alarmas_totales","alarmas_en_excursion_pequena","graves_alertados_tarde","graves_sin_alarma"]
labels  = ["alarmas totales","alarmas en excursion pequena (<=+2 C)","graves alertados tarde (post-pico)","graves SIN alarma (de 8)"]
x = np.arange(len(c)); w=0.20
fig, ax = plt.subplots(figsize=(12,5))
for k,(m,l) in enumerate(zip(metrics,labels)):
    ax.bar(x+(k-1.5)*w, c[m], w, label=l)
    for xi,v in zip(x+(k-1.5)*w, c[m]): ax.annotate(str(int(v)),(xi,v),ha="center",va="bottom",fontsize=7)
ax.set_xticks(x); ax.set_xticklabels(c.index, rotation=20, ha="right")
ax.set_title("Comparacion de estrategias sobre los 43 episodios historicos (8 en banda grave)")
ax.legend(); fig.tight_layout(); fig.savefig(GRA/"06_comparacion_estrategias.png"); plt.close(fig)

# ---------------------------------------------------------------- 07  alarmas anticipadas
a = antic_df
fig, ax1 = plt.subplots(figsize=(9,5))
ax1.bar(a.corte_avg_c, a.episodios_que_disparan, width=0.6, color="#4472c4", label="episodios que disparan")
ax1.bar(a.corte_avg_c, a.de_esos_banda2_grave, width=0.6, color="#c0392b", label="de esos, banda grave")
ax1.set_xlabel("Corte de temperatura para alarma inmediata (avg C)")
ax1.set_ylabel("Episodios")
ax2 = ax1.twinx()
ax2.plot(a.corte_avg_c, a.min_antes_del_pico_medio, "k-o", label="min antes del pico (media)")
ax2.axhline(0, color="#888", lw=.7)
ax2.set_ylabel("Minutos antes del pico (media)")
ax1.set_title("Alarmas anticipadas por gravedad: barrido de cortes")
ax1.legend(loc="upper left"); ax2.legend(loc="upper right")
ax1.invert_xaxis()
fig.tight_layout(); fig.savefig(GRA/"07_alarmas_anticipadas.png"); plt.close(fig)

print("graficos escritos:", sorted(p.name for p in GRA.glob("*.png")))
