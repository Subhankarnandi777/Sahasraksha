"""
SkyGuard AI - the comparison that makes the case.

"9.2x lift" means nothing to a judge until they see what the obvious approach
scores on the same data. Five baselines, ordered by how likely a rival team is
to build them:

  1. WMO threshold QC        what IMD actually deploys today
  2. Raw IsolationForest     what most SIH teams will build
  3. Raw LOF                 the textbook density approach
  4. Raw One-Class SVM       the textbook boundary approach
  5. Raw PCA reconstruction  the "autoencoder" everyone reaches for
  6. SkyGuard                physics-first, ML on residuals only

Baselines 2-5 see the same three channels. The only difference is that
SkyGuard subtracts the climatology and the neighbours first.
"""
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.neighbors import LocalOutlierFactor
from sklearn.svm import OneClassSVM
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import roc_auc_score, average_precision_score

CHANNELS = ["T", "P", "RH"]
GROSS = {"T": (-40, 60), "P": (500, 1100), "RH": (0, 100)}
STEP = {"T": 6.0, "P": 5.0, "RH": 45.0}


def wmo_threshold_qc(df):
    """The classical operational check: plausible range plus step limit.
    This is the bar SkyGuard has to clear to be worth deploying."""
    score = np.zeros(len(df))
    for ch in CHANNELS:
        v = df[ch].to_numpy(dtype=float)
        lo, hi = GROSS[ch]
        out = np.maximum(lo - v, v - hi)
        score += np.clip(out, 0, None)
        d = df.groupby("station_id", observed=True)[ch].diff().abs().to_numpy()
        score += np.clip(np.nan_to_num(d) - STEP[ch], 0, None) / STEP[ch]
    return score


def _raw_matrix(df):
    X = df[CHANNELS].to_numpy(dtype=float)
    return np.nan_to_num(X, nan=np.nanmedian(X))


def run_baselines(df, y, skyguard_score, train_mask, seed=0, svm_sub=6000):
    """Score every method against the same labels with the same metrics."""
    X = _raw_matrix(df)
    sc = StandardScaler().fit(X[train_mask])
    Xs, Xtr = sc.transform(X), sc.transform(X[train_mask])
    scores = {"WMO threshold QC": wmo_threshold_qc(df)}

    iso = IsolationForest(n_estimators=300, contamination=0.02,
                          random_state=seed).fit(Xtr)
    scores["Raw IsolationForest"] = -iso.score_samples(Xs)

    lof = LocalOutlierFactor(n_neighbors=35, novelty=True).fit(Xtr)
    scores["Raw LOF"] = -lof.score_samples(Xs)

    rng = np.random.default_rng(seed)
    sub = rng.choice(len(Xtr), min(svm_sub, len(Xtr)), replace=False)
    svm = OneClassSVM(nu=0.05, gamma="scale").fit(Xtr[sub])
    scores["Raw One-Class SVM"] = -svm.decision_function(Xs)

    pca = PCA(n_components=2, random_state=seed).fit(Xtr)
    scores["Raw PCA reconstruction"] = np.sqrt(
        ((Xs - pca.inverse_transform(pca.transform(Xs))) ** 2).sum(axis=1))

    scores["SkyGuard (physics-first)"] = np.asarray(skyguard_score)

    base = y.mean()
    rows = []
    for name, s in scores.items():
        s = np.nan_to_num(np.asarray(s, dtype=float))
        k = max(int(len(s) * 0.005), 1)
        top = np.argsort(-s)[:k]
        rows.append({
            "method": name,
            "ROC_AUC": round(float(roc_auc_score(y, s)), 3),
            "PR_AUC": round(float(average_precision_score(y, s)), 4),
            "lift@top0.5%": round(float(y[top].mean() / base), 2) if base else 0.0,
            "recall@top5%": round(float(
                y[np.argsort(-s)[:max(int(len(s) * .05), 1)]].sum()
                / max(y.sum(), 1)), 3),
        })
    return (pd.DataFrame(rows)
              .sort_values("ROC_AUC", ascending=False)
              .reset_index(drop=True)), scores


def esp32_c_source(beta_T, beta_P, beta_RH, station="AWS_XXX"):
    """
    Emit the on-device detector as compilable C.

    Only the closed-form layers go on the microcontroller: range gates, step
    limits, frozen-run detection, the harmonic residual, CUSUM, and the tide
    quadrature. No matrix library, no floating-point model file, no network.
    A station can therefore diagnose itself while it is unable to phone home,
    which is precisely the failure we most want reported.
    """
    def arr(b):
        return ", ".join(f"{v:.6f}f" for v in b)
    return f"""// SkyGuard-Edge  |  {station}  |  auto-generated, no dependencies
#include <math.h>
#include <stdint.h>

#define SG_PI 3.14159265358979f

#define NC 11                       // 1 + 3 diurnal harmonic pairs + 2 annual pairs
static const float BT[NC] = {{{arr(beta_T)}}};
static const float BP[NC] = {{{arr(beta_P)}}};
static const float BH[NC] = {{{arr(beta_RH)}}};

typedef struct {{
    float mean[3], var[3], last[3];
    uint16_t run[3];
    float cp[3], cn[3];
    float A, B, detrend, amp_base;
    uint32_t n;
}} sg_state_t;                       // 25 floats + 3 uint16 + 1 uint32 = 116 bytes

static void basis(float lst, float doy, float *x) {{
    x[0] = 1.0f;
    for (int k = 1; k <= 3; k++) {{
        x[2*k-1] = cosf(2.0f*SG_PI*k*lst/24.0f);
        x[2*k  ] = sinf(2.0f*SG_PI*k*lst/24.0f);
    }}
    x[7] = cosf(2.0f*SG_PI*doy/365.25f);
    x[8] = sinf(2.0f*SG_PI*doy/365.25f);
    x[9] = cosf(4.0f*SG_PI*doy/365.25f);
    x[10]= sinf(4.0f*SG_PI*doy/365.25f);
}}

static float predict(const float *b, const float *x) {{
    float s = 0.0f;
    for (int i = 0; i < NC; i++) s += b[i]*x[i];
    return s;
}}

// returns bitmask: 1 range, 2 step, 4 frozen, 8 drift, 16 tide degradation
uint8_t sg_update(sg_state_t *st, float lst, float doy,
                  float T, float P, float RH) {{
    float x[NC]; basis(lst, doy, x);
    const float lo[3] = {{-40.f, 500.f, 0.f}}, hi[3] = {{60.f, 1100.f, 100.f}};
    const float stepl[3] = {{6.f, 5.f, 45.f}};
    const uint16_t runl[3] = {{6, 6, 10}};
    float v[3] = {{T, P, RH}};
    const float *bt[3] = {{BT, BP, BH}};
    const float a = 0.02f, k = 1.5f, h = 12.0f;
    uint8_t flags = 0;

    for (int c = 0; c < 3; c++) {{
        if (!isfinite(v[c])) continue;
        if (v[c] < lo[c] || v[c] > hi[c]) flags |= 1;
        if (st->n) {{
            if (fabsf(v[c] - st->last[c]) > stepl[c]) flags |= 2;
            st->run[c] = (v[c] == st->last[c]) ? st->run[c] + 1 : 0;
            if (st->run[c] >= runl[c]) flags |= 4;
        }}
        st->last[c] = v[c];

        float r = v[c] - predict(bt[c], x);
        st->mean[c] = (1.f-a)*st->mean[c] + a*r;
        float d = r - st->mean[c];
        st->var[c] = (1.f-a)*st->var[c] + a*d*d;
        float z = d / (sqrtf(st->var[c]) + 1e-6f);

        st->cp[c] = fmaxf(0.f, st->cp[c] + z - k);
        st->cn[c] = fmaxf(0.f, st->cn[c] - z - k);
        if (fmaxf(st->cp[c], st->cn[c]) > h) {{ flags |= 8; st->cp[c]=st->cn[c]=0.f; }}
    }}

    // Semidiurnal tide heartbeat on pressure -- the early-warning channel
    const float ta = 0.01f;
    if (st->n == 0) st->detrend = P;
    st->detrend = (1.f-ta)*st->detrend + ta*P;
    float y = P - st->detrend, w = 2.0f*SG_PI*lst/12.0f;
    st->A = (1.f-ta)*st->A + ta*2.f*y*cosf(w);
    st->B = (1.f-ta)*st->B + ta*2.f*y*sinf(w);
    if (st->n > 336) {{
        float amp = sqrtf(st->A*st->A + st->B*st->B);
        if (st->amp_base <= 0.f) st->amp_base = amp;
        else st->amp_base = 0.9995f*st->amp_base + 0.0005f*amp;
        if (st->amp_base > 1e-6f && amp/st->amp_base < 0.55f) flags |= 16;
    }}
    st->n++;
    return flags;
}}
"""
