"""
SkyGuard AI - validation rigour.

Three questions a judge will ask that the notebook cannot currently answer:

  1. "Does it work on a station you never trained on?"        -> LOSO
  2. "How certain is that lift number?"                        -> bootstrap CI
  3. "You validated your headline feature on two events?"      -> balanced injection

Answering these is worth more than another point of F1, because they are the
questions that separate a result from a demo.
"""
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import roc_auc_score, average_precision_score

from .injector import FAULT_CLASSES, CHANNELS, CHANNEL_SCALE


# ─────────────────────────────────────────────────────── 1. bootstrap CIs
def bootstrap_metrics(y, score, n_boot=1000, top_pct=0.5, seed=0):
    """
    Percentile bootstrap over observations.

    Lift at the top 0.5% of 95,000 rows rests on roughly 476 rows and a few
    dozen positives. A point estimate alone invites the question "how stable
    is that?", and the honest answer is an interval.
    """
    rng = np.random.default_rng(seed)
    y = np.asarray(y).astype(int)
    s = np.nan_to_num(np.asarray(score, dtype=float))
    n = len(y)
    aucs, lifts = [], []
    for _ in range(n_boot):
        b = rng.integers(0, n, n)
        yb, sb = y[b], s[b]
        if yb.sum() < 5:
            continue
        aucs.append(roc_auc_score(yb, sb))
        k = max(int(n * top_pct / 100), 1)
        top = np.argpartition(-sb, k)[:k]
        lifts.append(yb[top].mean() / max(yb.mean(), 1e-12))

    def ci(v):
        v = np.asarray(v)
        return (round(float(np.median(v)), 3),
                round(float(np.percentile(v, 2.5)), 3),
                round(float(np.percentile(v, 97.5)), 3))

    a, al, ah = ci(aucs)
    l, ll, lh = ci(lifts)
    return {"n_boot": len(aucs),
            "ROC_AUC": a, "ROC_AUC_95CI": (al, ah),
            f"lift@top{top_pct}%": l, "lift_95CI": (ll, lh)}


# ─────────────────────────────────────────────────── 2. leave-one-station-out
def loso_validate(df, F, FEATURES, label, threshold_budget=0.05, seed=0):
    """
    Hold out one entire station, fit the learned layer on the rest, score the
    held-out station.

    This is the question IMD actually cares about: a new AWS is commissioned
    tomorrow with no fault history at all — does the system work on it, or only
    on the stations it was tuned against? Nothing here is fitted on the
    held-out station's rows.
    """
    y = np.asarray(label).astype(int)
    X = F[FEATURES].to_numpy()
    sid = df["station_id"].to_numpy()
    rows = []
    for held in pd.unique(sid):
        te = sid == held
        tr = ~te
        if y[te].sum() < 3 or tr.sum() < 500:
            rows.append({"held_out": held, "n": int(te.sum()),
                         "n_pos": int(y[te].sum()), "ROC_AUC": np.nan,
                         "lift@top1%": np.nan, "note": "too few positives"})
            continue
        sc = StandardScaler().fit(X[tr])
        iso = IsolationForest(n_estimators=300, contamination=0.02,
                              random_state=seed).fit(sc.transform(X[tr]))
        s_te = -iso.score_samples(sc.transform(X[te]))
        yte = y[te]
        k = max(int(len(s_te) * 0.01), 1)
        top = np.argsort(-s_te)[:k]
        rows.append({"held_out": held, "n": int(te.sum()), "n_pos": int(yte.sum()),
                     "ROC_AUC": round(float(roc_auc_score(yte, s_te)), 3),
                     "PR_AUC": round(float(average_precision_score(yte, s_te)), 4),
                     "lift@top1%": round(float(yte[top].mean()/max(yte.mean(), 1e-12)), 2),
                     "note": ""})
    out = pd.DataFrame(rows)
    ok = out.dropna(subset=["ROC_AUC"])
    summary = {"stations": len(ok),
               "ROC_AUC_mean": round(float(ok.ROC_AUC.mean()), 3),
               "ROC_AUC_std": round(float(ok.ROC_AUC.std()), 3),
               "ROC_AUC_min": round(float(ok.ROC_AUC.min()), 3),
               "lift_mean": round(float(ok["lift@top1%"].mean()), 2)}
    return out, summary


# ────────────────────────────────────────────── 3. class-balanced injection
def inject_balanced(df, per_class=8, seed=7, severity=1.0,
                    min_len=6, max_len=200):
    """
    Equal events per failure mode.

    The random injector gave the sluggish class two events out of forty-five.
    A detector validated on n=2 is not validated, and `sluggish` is precisely
    the class the tide heartbeat exists to catch — so it is the one class that
    must not be under-sampled.
    """
    rng = np.random.default_rng(seed)
    out = df.copy()
    for ch in CHANNELS:
        out[f"{ch}_true"] = out[ch].to_numpy()
    out["is_fault"] = 0
    out["fault_class"] = "none"
    out["fault_channel"] = "none"

    stations = out["station_id"].unique()
    idx_map = {s: np.flatnonzero((out["station_id"] == s).to_numpy())
               for s in stations}
    events = []
    for cls in FAULT_CLASSES:
        for _ in range(per_class):
            sid = rng.choice(stations); ch = rng.choice(CHANNELS)
            rows = idx_map[sid]; n = len(rows)
            if cls == "spike":
                length = 1
            elif cls == "sluggish":
                length = int(rng.integers(240, max(241, max_len + 240)))
            else:
                length = int(rng.integers(min_len, max_len))
            length = min(length, n // 5)
            start = int(rng.integers(48, n - length - 48))
            sel = rows[start:start + length]
            vals = out.loc[sel, ch].to_numpy(dtype=float).copy()
            scale = CHANNEL_SCALE[ch] * severity
            m = len(vals)

            if cls == "spike":
                vals = vals + rng.uniform(6, 15)*scale*rng.choice([-1, 1])
            elif cls == "frozen":
                vals[:] = vals[0]
            elif cls == "drift":
                vals = vals + rng.uniform(3, 9)*scale*rng.choice([-1, 1])*np.linspace(0, 1, m)
            elif cls == "step":
                vals = vals + rng.uniform(2.5, 6)*scale*rng.choice([-1, 1])
            elif cls == "noise":
                sd = max(np.std(np.diff(vals))/np.sqrt(2), 1e-3)
                vals = vals + rng.normal(0, sd*rng.uniform(4, 10), m)
            elif cls == "dropout":
                vals[:] = np.nan if rng.random() < 0.5 else vals[0]
            elif cls == "sluggish":
                mu = np.nanmean(vals)
                vals = mu + (vals-mu)*np.linspace(1.0, rng.uniform(0.15, 0.45), m)

            out.loc[sel, ch] = np.round(vals, 2)
            out.loc[sel, "is_fault"] = 1
            out.loc[sel, "fault_class"] = cls
            out.loc[sel, "fault_channel"] = ch
            events.append({"station_id": sid, "channel": ch, "fault_class": cls,
                           "start_time": out.loc[sel[0], "timestamp"],
                           "end_time": out.loc[sel[-1], "timestamp"],
                           "n_samples": m})
    return out, pd.DataFrame(events)
