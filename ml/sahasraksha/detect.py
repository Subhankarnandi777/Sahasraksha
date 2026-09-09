"""
SkyGuard AI - the detection stack.

  Layer 0  Physics gates        deterministic, untrained, ~100% precision
  Layer 1  Harmonic + spatial   removes weather, isolates the sensor
  Layer 2  Tide heartbeat       catches degradation before it shows
  Layer 3  ML on residuals      mops up whatever is left

The ordering matters and is the architectural argument of the whole project.
Most teams start at Layer 3 and train a black box on raw values. That model
spends its capacity relearning the diurnal cycle, cannot separate weather from
sensor error, and cannot be cross-examined. Here the physics does the work it
can do exactly, and machine learning is asked only for the residual.
"""
import numpy as np
import pandas as pd

from .physics import (dewpoint_from_T_RH, reduce_to_msl, GROSS_LIMITS,
                      STEP_LIMITS)

CHANNELS = ["T", "P", "RH"]
# Dominant harmonic period each channel should carry, in hours
DOMINANT_PERIOD = {"T": 24.0, "P": 12.0, "RH": 24.0}


# ---------------------------------------------------------------- Layer 0
def physics_gates(df):
    """Hard physical and instrumental limits. No training, no thresholds
    tuned on data -- these come from WMO guidance and thermodynamics."""
    g = pd.DataFrame(index=df.index)
    T, P, RH = df["T"].to_numpy(), df["P"].to_numpy(), df["RH"].to_numpy()

    for ch, arr in zip(CHANNELS, [T, P, RH]):
        lo, hi = GROSS_LIMITS[ch]
        g[f"gate_range_{ch}"] = ((arr < lo) | (arr > hi)).astype(int)

    # The signature detector: dewpoint may never exceed air temperature.
    with np.errstate(invalid="ignore", divide="ignore"):
        Td = dewpoint_from_T_RH(T, np.clip(RH, 0.1, None))
    g["dewpoint"] = Td
    g["dewpoint_depression"] = T - Td
    g["gate_dewpoint"] = ((Td > T + 0.5) | (RH > 100.5)).astype(int)

    # Step-change limits, evaluated per station
    for ch in CHANNELS:
        d = df.groupby("station_id", observed=True)[ch].diff().abs().to_numpy()
        g[f"d_{ch}"] = np.nan_to_num(d)
        g[f"gate_step_{ch}"] = (d > STEP_LIMITS[ch]).astype(float)
        g[f"gate_step_{ch}"] = g[f"gate_step_{ch}"].fillna(0).astype(int)

    # Persistence: how many consecutive samples has this value not moved?
    for ch in CHANNELS:
        g[f"runlen_{ch}"] = _run_length(df, ch)
        g[f"gate_frozen_{ch}"] = (g[f"runlen_{ch}"] >= 4).astype(int)

    # Missing telemetry
    g["gate_missing"] = df[CHANNELS].isna().any(axis=1).astype(int)

    gate_cols = [c for c in g.columns if c.startswith("gate_")]
    g["physics_flag"] = (g[gate_cols].sum(axis=1) > 0).astype(int)
    return g


def _run_length(df, ch):
    """Consecutive-identical-value run length, computed per station."""
    out = np.zeros(len(df))
    for _, idx in df.groupby("station_id", observed=True).indices.items():
        v = df[ch].to_numpy()[idx]
        run = np.zeros(len(v))
        c = 0
        for i in range(1, len(v)):
            if not np.isnan(v[i]) and v[i] == v[i - 1]:
                c += 1
            else:
                c = 0
            run[i] = c
        out[idx] = run
    return out


# ---------------------------------------------------------------- Layer 1
def _design_matrix(lst, doy, n_diurnal=3, annual=True):
    cols = [np.ones_like(lst)]
    for k in range(1, n_diurnal + 1):
        cols += [np.cos(2 * np.pi * k * lst / 24.0),
                 np.sin(2 * np.pi * k * lst / 24.0)]
    if annual:
        cols += [np.cos(2 * np.pi * doy / 365.25),
                 np.sin(2 * np.pi * doy / 365.25),
                 np.cos(4 * np.pi * doy / 365.25),
                 np.sin(4 * np.pi * doy / 365.25)]
    return np.column_stack(cols)


def harmonic_residuals(df, train_frac=1.0, n_irls=6):
    """
    Fit each station's own climatological signature (diurnal harmonics +
    annual cycle) on an early training slice, then measure how far every
    later observation sits from that signature.

    The fit is done with iteratively reweighted least squares so that faults
    present in the training window cannot capture the model.
    """
    res = pd.DataFrame(index=df.index)
    lst_all = ((df["timestamp"].dt.hour + df["timestamp"].dt.minute / 60.0)
               + df["lon"] / 15.0) % 24.0
    doy_all = df["timestamp"].dt.dayofyear.to_numpy().astype(float)
    res["lst"] = lst_all.to_numpy()

    for ch in CHANNELS:
        fitted = np.full(len(df), np.nan)
        for _, idx in df.groupby("station_id", observed=True).indices.items():
            y = df[ch].to_numpy()[idx].astype(float)
            X = _design_matrix(lst_all.to_numpy()[idx], doy_all[idx])
            ntr = len(idx) if train_frac >= 1.0 else max(int(len(idx) * train_frac), 200)
            Xtr, ytr = X[:ntr], y[:ntr]
            ok = np.isfinite(ytr)
            if ok.sum() < 50:
                continue
            beta = np.linalg.lstsq(Xtr[ok], ytr[ok], rcond=None)[0]
            for _ in range(n_irls):                  # robust reweighting
                r = ytr[ok] - Xtr[ok] @ beta
                s = 1.4826 * np.median(np.abs(r - np.median(r))) + 1e-6
                w = 1.0 / (1.0 + (r / (2.5 * s)) ** 2)
                W = np.sqrt(w)[:, None]
                beta = np.linalg.lstsq(Xtr[ok] * W, ytr[ok] * W.ravel(),
                                       rcond=None)[0]
            fitted[idx] = X @ beta
        res[f"fit_{ch}"] = fitted
        res[f"resid_{ch}"] = df[ch].to_numpy() - fitted

    # --- spatial consistency ------------------------------------------
    # Weather is shared between neighbours; a sensor fault is not. Removing
    # the network-median residual removes the weather and leaves the fault.
    res["timestamp"] = df["timestamp"].to_numpy()
    for ch in CHANNELS:
        med = res.groupby("timestamp", observed=True)[f"resid_{ch}"].transform("median")
        res[f"sresid_{ch}"] = res[f"resid_{ch}"] - med

    # Robust standardisation, per station, using the training slice only
    for ch in CHANNELS:
        z = np.zeros(len(df))
        for _, idx in df.groupby("station_id", observed=True).indices.items():
            v = res[f"sresid_{ch}"].to_numpy()[idx]
            base = v[np.isfinite(v)]
            s = 1.4826 * np.median(np.abs(base - np.median(base))) + 1e-6
            z[idx] = (v - np.median(base)) / s
        res[f"z_{ch}"] = z

    res = res.drop(columns=["timestamp"])
    return res


# ---------------------------------------------------------------- Layer 2
def tide_heartbeat(df, resid, window_hours=72):
    """
    Track each sensor's ability to reproduce the harmonic it must carry.

    For pressure that harmonic is the semidiurnal atmospheric tide, S2: a
    solar-driven 12-hour oscillation of roughly 1 hPa over India, and the
    single most regular signal in surface meteorology. A healthy barometer
    reproduces it every single day. A degrading one loses amplitude or slips
    in phase -- days before it emits a value any threshold would reject.

    The same idea applied at 24 hours catches a sluggish thermometer or a
    fouled hygrometer.
    """
    out = pd.DataFrame(index=df.index)
    lst = resid["lst"].to_numpy()

    for ch in CHANNELS:
        period = DOMINANT_PERIOD[ch]
        amp = np.full(len(df), np.nan)
        pha = np.full(len(df), np.nan)

        c = np.cos(2 * np.pi * lst / period)
        s = np.sin(2 * np.pi * lst / period)
        y_all = df[ch].to_numpy().astype(float)

        for _, idx in df.groupby("station_id", observed=True).indices.items():
            y = pd.Series(y_all[idx])
            # Detrend so the harmonic fit is not dragged by synoptic swings
            y_dt = y - y.rolling(window_hours, min_periods=12, center=True).mean()
            A = 2 * (y_dt * c[idx]).rolling(window_hours, min_periods=36).mean()
            B = 2 * (y_dt * s[idx]).rolling(window_hours, min_periods=36).mean()
            amp[idx] = np.sqrt(A.to_numpy() ** 2 + B.to_numpy() ** 2)
            pha[idx] = np.arctan2(B.to_numpy(), A.to_numpy())

        out[f"amp_{ch}"] = amp
        out[f"phase_{ch}"] = pha

        # Health = amplitude now, relative to this station's own baseline
        ratio = np.full(len(df), np.nan)
        pdev = np.full(len(df), np.nan)
        for _, idx in df.groupby("station_id", observed=True).indices.items():
            a = amp[idx]
            base_a = np.nanmedian(a)
            ratio[idx] = a / (base_a + 1e-9)
            base_p = np.nanmedian(pha[idx])
            d = np.angle(np.exp(1j * (pha[idx] - base_p)))
            pdev[idx] = np.abs(d)
        out[f"amp_ratio_{ch}"] = np.nan_to_num(ratio, nan=1.0)
        out[f"phase_dev_{ch}"] = np.nan_to_num(pdev, nan=0.0)

    # A single interpretable sensor-health score in [0, 1]
    hb = np.clip(out[[f"amp_ratio_{c}" for c in CHANNELS]].min(axis=1), 0, 1.5)
    out["heartbeat_health"] = np.clip(hb / 1.0, 0, 1)
    out["degradation_index"] = np.clip(1.0 - out["heartbeat_health"], 0, 1)
    return out


# ---------------------------------------------------------------- Layer 2b
def cusum_features(resid, df, k=1.5, h=12.0):
    """
    Two-sided CUSUM on the spatially-corrected standardised residual.

    A drifting or step-offset sensor produces a small, persistent bias. Any
    single sample looks innocent, so point thresholds miss it for days.
    CUSUM accumulates that bias and fires as soon as the evidence is
    sufficient -- which is exactly the "calibration drift" failure mode IMD
    lists in the problem statement.
    """
    out = pd.DataFrame(index=df.index)
    for ch in CHANNELS:
        z_all = resid[f"z_{ch}"].to_numpy()
        stat = np.zeros(len(df))
        for _, idx in df.groupby("station_id", observed=True).indices.items():
            z = np.nan_to_num(z_all[idx])
            cp = cn = 0.0
            s = np.zeros(len(z))
            for i, v in enumerate(z):
                cp = max(0.0, cp + v - k)
                cn = max(0.0, cn - v - k)
                s[i] = max(cp, cn)
                if s[i] > h:
                    # Change declared: reset and start watching again, so the
                    # statistic reports *current* evidence, not history.
                    cp = cn = 0.0
            stat[idx] = s
        out[f"cusum_{ch}"] = stat
        out[f"cusum_flag_{ch}"] = (stat > h).astype(int)
    out["cusum_flag"] = (out[[f"cusum_flag_{c}" for c in CHANNELS]]
                         .sum(axis=1) > 0).astype(int)
    return out
