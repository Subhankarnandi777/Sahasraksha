"""Batch QC on any AWS observation table — the evaluator-facing entry point.

    python -m sahasraksha run observations.csv --out flags.csv

Runs the same pipeline as the final validation notebook (``core.py`` is
extracted from it verbatim):

    ingest integrity -> hourly grid -> physics gates -> harmonic + spatial residuals
    -> regional-event veto -> tide heartbeat -> dual CUSUM -> telemetry/silence
    -> IsolationForest (1% causal threshold) -> fusion -> root cause
    -> severity -> confidence -> labelled estimate -> operator action

Minimum input: ``timestamp, station_id, T, RH, P`` (°C, %, hPa station pressure).
Also accepted: ``Td`` instead of RH, ``P_msl`` instead of P (needs ``alt_m``).
Optional: ``lat, lon, alt_m`` per row, or a separate ``--stations`` table.
One station works too: the spatial layer simply has no neighbours to consult.
"""
from __future__ import annotations

import warnings

import numpy as np
import pandas as pd

from . import core as C

MIN_ROWS_PER_STATION = 72          # three days of hourly grid; below that, harmonics can't be fitted

_ALIASES = {
    "time": "timestamp", "datetime": "timestamp", "date_time": "timestamp", "obs_time": "timestamp",
    "station": "station_id", "stn": "station_id", "site": "station_id", "id": "station_id",
    "temp": "T", "temperature": "T", "t": "T", "air_temp": "T",
    "rh": "RH", "humidity": "RH", "relative_humidity": "RH",
    "p": "P", "pressure": "P", "station_pressure": "P", "pres": "P",
    "td": "Td", "dewpoint": "Td", "dew_point": "Td",
    "slp": "P_msl", "p_msl": "P_msl", "mslp": "P_msl",
    "latitude": "lat", "longitude": "lon", "altitude": "alt_m", "elevation": "alt_m", "alt": "alt_m",
}


def normalise_columns(df: pd.DataFrame) -> pd.DataFrame:
    ren = {}
    for c in df.columns:
        key = str(c).strip()
        if key in ("T", "RH", "P", "Td", "P_msl"):
            continue
        low = key.lower()
        if low in _ALIASES:
            ren[c] = _ALIASES[low]
        elif low != key and low in ("timestamp", "station_id", "lat", "lon", "alt_m"):
            ren[c] = low
    return df.rename(columns=ren)


def _derive_channels(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    if "RH" not in df.columns and "Td" in df.columns:
        df["RH"] = np.clip(C.RH_from_T_dewpoint(df["T"].to_numpy(float),
                                                np.minimum(df["Td"].to_numpy(float), df["T"].to_numpy(float))), 0, 100).round(2)
        # rounded: a stuck sensor must still repeat EXACTLY after the Td -> RH conversion
    if "P" not in df.columns and "P_msl" in df.columns:
        if "alt_m" not in df.columns:
            raise ValueError("P_msl given without alt_m: station pressure cannot be derived.")
        df["P"] = np.round(df["P_msl"].to_numpy(float) * np.exp(
            -9.80665 * df["alt_m"].to_numpy(float) / (287.05 * (df["T"].to_numpy(float) + 273.15))), 2)
    for need in ("timestamp", "station_id", "T", "RH", "P"):
        if need not in df.columns:
            raise ValueError(f"missing column '{need}'. Required: timestamp, station_id, T, RH (or Td), P (or P_msl + alt_m).")
    return df


def infer_cadence(obs: pd.DataFrame) -> dict:
    """Hourly if a station reports in >= 12 distinct clock hours, else 3-hourly (synoptic)."""
    hrs = obs.groupby("station_id")["timestamp"].apply(lambda s: s.dt.hour.nunique())
    return {sid: (1.0 if n >= 12 else 3.0) for sid, n in hrs.items()}


def to_hourly_grid(obs: pd.DataFrame, interp_limit: int = 3) -> tuple[pd.DataFrame, dict, list]:
    """Raw reports -> the hourly grid the detector is validated on (same rule as the
    notebook's isd_to_schema: floor to the hour, reindex, interpolate gaps <= 3 h,
    remember which hours had no report)."""
    obs = obs.copy()
    obs["timestamp"] = pd.to_datetime(obs["timestamp"], errors="coerce")
    bad_time = obs["timestamp"].isna()
    if bad_time.any():
        warnings.warn(f"{int(bad_time.sum())} rows with unparseable timestamps dropped")
        obs = obs[~bad_time]
    obs["station_id"] = obs["station_id"].astype(str)
    for c in ("T", "RH", "P"):
        obs[c] = pd.to_numeric(obs[c], errors="coerce")

    # integrity is checked in ARRIVAL order, before anything is sorted
    obs = C.ingest_integrity(obs)
    cadence = infer_cadence(obs)

    frames, skipped = [], []
    for sid, g in obs.groupby("station_id", sort=True):
        g = g.assign(timestamp=g["timestamp"].dt.floor("h"))
        agg = g.groupby("timestamp").agg(T=("T", "first"), P=("P", "first"), RH=("RH", "first"),
                                         ingest_bad=("ingest_bad", "max"))
        grid = pd.date_range(agg.index.min(), agg.index.max(), freq="h")
        if len(grid) < MIN_ROWS_PER_STATION:
            skipped.append((sid, f"only {len(grid)} h of record (need {MIN_ROWS_PER_STATION})"))
            continue
        agg = agg.reindex(grid)
        src_missing = agg[["T", "P", "RH"]].isna().all(axis=1).to_numpy()
        out = pd.DataFrame({"timestamp": grid, "station_id": sid})
        for c in ("T", "P", "RH"):
            out[c] = agg[c].interpolate(limit=interp_limit, limit_area="inside").to_numpy()
        for c in ("lat", "lon", "alt_m"):
            if c in g.columns and g[c].notna().any():
                out[c] = float(pd.to_numeric(g[c], errors="coerce").dropna().iloc[0])
        out["ingest_bad"] = agg["ingest_bad"].fillna(0).astype(int).to_numpy()
        out["source_missing"] = src_missing
        frames.append(out)
    if not frames:
        raise ValueError("no station has enough record to analyse: " + "; ".join(f"{s}: {r}" for s, r in skipped))
    grid_df = pd.concat(frames, ignore_index=True)
    return grid_df.sort_values(["station_id", "timestamp"]).reset_index(drop=True), cadence, skipped


def _attach_meta(df: pd.DataFrame, stations: pd.DataFrame | None) -> tuple[pd.DataFrame, list]:
    notes = []
    if stations is not None:
        st = normalise_columns(stations).copy()
        st["station_id"] = st["station_id"].astype(str)
        keep = [c for c in ("station_id", "lat", "lon", "alt_m") if c in st.columns]
        df = df.drop(columns=[c for c in keep if c != "station_id" and c in df.columns]).merge(
            st[keep].drop_duplicates("station_id"), on="station_id", how="left")
    if "lon" not in df.columns or df["lon"].isna().any():
        notes.append("longitude missing for some stations: local solar time assumes 78°E (central India)")
        df["lon"] = df["lon"].fillna(78.0) if "lon" in df.columns else 78.0
    if "lat" not in df.columns or df["lat"].isna().any():
        notes.append("latitude missing for some stations: neighbour search treats them as 22°N")
        df["lat"] = df["lat"].fillna(22.0) if "lat" in df.columns else 22.0
    if "alt_m" in df.columns and df["alt_m"].isna().any():
        notes.append("altitude missing for some stations: hydrostatic (MSL) gate skipped for them")
    return df, notes


def _layer(ph, co, cu, dg, ml, flag):
    lay = np.select([ph, co, cu, dg, ml], ["physics", "comms", "cusum", "tide", "ml"], "")
    return np.where(np.asarray(flag) == 1, lay, "")


def run_qc(obs: pd.DataFrame, stations: pd.DataFrame | None = None, ml_rate: float = 0.01,
           train_frac: float = 0.40, verbose: bool = True) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """Returns (per-row verdicts, per-station work orders, run info)."""
    obs = normalise_columns(obs)
    if stations is not None:                      # station metadata first: P_msl -> P needs alt_m
        st = normalise_columns(stations).copy()
        st["station_id"] = st["station_id"].astype(str)
        keep = [c for c in ("station_id", "lat", "lon", "alt_m") if c in st.columns]
        obs = obs.drop(columns=[c for c in keep[1:] if c in obs.columns]).assign(
            station_id=obs["station_id"].astype(str)).merge(st[keep].drop_duplicates("station_id"),
                                                            on="station_id", how="left")
    obs = _derive_channels(obs)
    df, cadence, skipped = to_hourly_grid(obs)
    df, notes = _attach_meta(df, None)
    if "alt_m" in df.columns and df["alt_m"].isna().all():
        df = df.drop(columns="alt_m")
    n_st = df["station_id"].nunique()
    if n_st == 1:
        notes.append("single station: the spatial layer has no neighbours; physics, harmonic, tide, CUSUM, comms and ML still run")

    F = C.build_feature_frame_final_v3(df, station_cadence=cadence)
    train = np.zeros(len(df), bool)
    for _, idx in df.groupby("station_id", observed=True).indices.items():
        train[idx[:max(int(len(idx) * train_frac), 24)]] = True
    scored = train & ~df["source_missing"].to_numpy()
    scores, _ = C.fit_score_models(F, scored if scored.sum() >= 50 else train)
    s = scores["IsolationForest"]
    thr = C.threshold_at_rate(s, scored if scored.sum() >= 50 else train, target_fpr=ml_rate)

    flag, ph, ml, dg, cu, co = C.fuse(F, s, thr, degradation_cut=0.45)
    mech = C.classify_root_cause_v2(F, df)
    label = C.operator_label(F, mech)
    conf = C.get_confidence_scores(F, s, thr)
    sev, grade = C.calculate_severity(df, F, flag, mech)
    rep = C.impute_safe(df, F, flag)

    flagged = np.asarray(flag) == 1
    cause = np.where(flagged, label, "ok")
    # a physically impossible value is quarantined at once, whatever its rank in the queue
    grade = np.where(flagged & (cause == "impossible"), "CRITICAL", grade)
    # confidence that the verdict is right: for flags, how far the evidence is above the
    # threshold (physics/comms are deterministic rules, so they are certain)
    rule = ph | co
    verdict_conf = np.where(flagged, np.where(rule, 1.0, np.maximum(conf, 0.5)), 1.0 - conf)

    out = pd.DataFrame({
        "timestamp": df["timestamp"], "station_id": df["station_id"],
        "reported": ~df["source_missing"].to_numpy(),
        "T": df["T"].round(2), "RH": df["RH"].round(1), "P": df["P"].round(2),
        "flag": flag.astype(int), "root_cause": cause,
        "decided_by": _layer(ph, co, cu, dg, ml, flag),
        "severity": np.where(flagged, sev, 0.0), "grade": grade,
        "confidence": np.round(verdict_conf, 3), "ml_score": np.round(s, 4),
        "regional_event": F["regional_event"].to_numpy().astype(int) if "regional_event" in F else 0,
    })
    for ch in ("T", "RH", "P"):
        was = rep[f"{ch}_was_repaired"].to_numpy() == 1
        out[f"{ch}_estimate"] = np.where(was, rep[f"{ch}_repaired"], np.nan)
    gates = [c for c in F.columns if c.startswith("gate_")]
    G = F[gates].to_numpy() == 1
    out["gates_fired"] = [";".join(g for g, on in zip(gates, row) if on) for row in G]
    out["action"] = np.where(flagged, pd.Series(cause).map(C.ACTIONS).fillna(C.ACTIONS["unclassified"]), "")

    work = C.maintenance_report(df, F, flagged.astype(float), horizon_days=30)   # as validated in STEP 26
    info = {"stations": n_st, "grid_rows": len(df), "reported_rows": int((~df["source_missing"]).sum()),
            "flag_rate": float(flagged.mean()), "cadence_h": cadence, "skipped": skipped, "notes": notes,
            "ml_threshold": thr}
    if verbose:
        print(f"stations analysed : {n_st}   hourly rows: {len(df):,}   reported: {info['reported_rows']:,}")
        print(f"flagged           : {int(flagged.sum()):,} ({100 * flagged.mean():.2f}%)")
        if flagged.any():
            print("by root cause     :", pd.Series(cause[flagged]).value_counts().to_dict())
            print("decided by        :", pd.Series(out['decided_by'][flagged]).value_counts().to_dict())
        for s_, r_ in skipped:
            print(f"skipped {s_}: {r_}")
        for n_ in notes:
            print("note:", n_)
    return out, work, info
