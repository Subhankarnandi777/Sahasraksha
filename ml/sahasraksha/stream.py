"""
Sahasraksha - streaming engine.

The batch pipeline proves the science. This proves it can run operationally.

Every statistic here is updated in constant time and constant memory per
station: no window buffer, no history array, no refit. That is what makes
the same detector valid on a server ingesting 2,395 stations and on a
microcontroller bolted inside one of them.

Recursive equivalents used:
  rolling mean      -> exponentially weighted mean
  rolling variance  -> Welford / EW variance
  windowed harmonic -> EW quadrature accumulators (A, B)
  CUSUM             -> already recursive by construction
"""
import time
import numpy as np
from .physics import dewpoint_from_T_RH

CHANNELS = ["T", "P", "RH"]
DOMINANT_PERIOD = {"T": 24.0, "P": 12.0, "RH": 24.0}
GROSS_LIMITS = {"T": (-40.0, 60.0), "P": (500.0, 1100.0), "RH": (0.0, 100.0)}
STEP_LIMITS = {"T": 6.0, "P": 5.0, "RH": 45.0}
FROZEN_MIN_RUN = {"T": 6, "P": 6, "RH": 10}
NATIONAL_T_MAX = 52.0      # India's highest recorded air temperature is 51.0 °C (Phalodi, 2016)
DEWPOINT_CEILING = 34.0    # no Indian surface station has a credible dewpoint above this

# What the operator should do, per verdict reason (same wording as the batch
# pipeline's ACTIONS in core.py, mapped onto the streaming reason codes).
STREAM_ACTIONS = {
    "impossible": "Quarantine this reading from forecast assimilation and use the estimate. "
                  "If it recurs within 24 h, dispatch a technician to inspect the T/RH probe and radiation shield.",
    "range":      "Reading outside physical limits. Quarantine it and use the estimate; check units and sensor wiring.",
    "step":       "Sudden jump. If the new level persists, verify the installation (post-maintenance or resiting) and apply an offset.",
    "frozen":     "Sensor or logger stuck. Power-cycle the logger remotely; dispatch if not cleared in 6 h.",
    "missing":    "Channel missing. Check telemetry link and power; values shown are estimates until the link returns.",
    "drift":      "Calibration drift. Schedule recalibration against a transfer standard; apply the offset meanwhile.",
    "degrading":  "Pressure sensor losing its 12-hour tide. Clear the pressure port and schedule a service visit.",
    "anomaly":    "Reading disagrees with this station's own signature. Hold for review; no dispatch unless it persists.",
    "ok":         "",
}


class StationState:
    """Constant-size state for one weather station. This is the whole
    on-device footprint."""
    __slots__ = ("beta", "ew_mean", "ew_var", "last", "runlen",
                 "A", "B", "amp_base", "cp", "cn", "n", "detrend")

    def __init__(self, beta):
        self.beta = beta                       # harmonic coefficients per channel
        self.ew_mean = {c: 0.0 for c in CHANNELS}
        self.ew_var = {c: 1.0 for c in CHANNELS}
        self.detrend = {c: None for c in CHANNELS}
        self.last = {c: None for c in CHANNELS}
        self.runlen = {c: 0 for c in CHANNELS}
        self.A = {c: 0.0 for c in CHANNELS}
        self.B = {c: 0.0 for c in CHANNELS}
        self.amp_base = {c: None for c in CHANNELS}
        self.cp = {c: 0.0 for c in CHANNELS}
        self.cn = {c: 0.0 for c in CHANNELS}
        self.n = 0


def design_row(lst, doy, n_diurnal=3):
    """One row of the harmonic design matrix -- 11 terms."""
    r = [1.0]
    for k in range(1, n_diurnal + 1):
        r += [np.cos(2*np.pi*k*lst/24.0), np.sin(2*np.pi*k*lst/24.0)]
    r += [np.cos(2*np.pi*doy/365.25), np.sin(2*np.pi*doy/365.25),
          np.cos(4*np.pi*doy/365.25), np.sin(4*np.pi*doy/365.25)]
    return np.asarray(r)


class StreamingSahasraksha:
    """
    Online detector. `update()` consumes one observation and returns a verdict
    immediately -- no lookahead, no batch, no refit.
    """

    def __init__(self, coeffs, alpha=0.02, tide_alpha=0.01,
                 cusum_k=3.0, cusum_h=12.0, z_cut=4.0, deg_cut=0.45):
        # cusum_k=1.5 previously sat BELOW the measured residual noise floor
        # (mean |z| ~ 0.87-1.00 across channels), causing the accumulator to
        # climb on clean data and latch permanently. Verified against the
        # same noise measurement used to fix the batch pipeline's CUSUM.
        self.states = {sid: StationState(b) for sid, b in coeffs.items()}
        self.alpha, self.tide_alpha = alpha, tide_alpha
        self.k, self.h, self.z_cut, self.deg_cut = cusum_k, cusum_h, z_cut, deg_cut

    def update(self, sid, lst, doy, obs):
        """obs = dict of channel -> value (may contain NaN). Returns a dict."""
        st = self.states.get(sid)
        if st is None:
            return {"flag": 0, "reason": "unknown_station", "severity": 0.0}
        x = design_row(lst, doy)
        st.n += 1
        gates, z, evidence = [], {}, {}
        estimate, band = {}, {}
        cs_peak = 0.0

        for ch in CHANNELS:
            # expected value = own harmonic signature + current residual bias,
            # band = 2 sigma of recent residuals; taken BEFORE this reading
            # updates the statistics, so a bad reading cannot widen its own band
            estimate[ch] = round(float(np.dot(st.beta[ch], x)) + st.ew_mean[ch], 2)
            band[ch] = round(2.0 * float(np.sqrt(st.ew_var[ch])), 2)

            v = obs.get(ch, np.nan)
            if v is None or not np.isfinite(v):
                gates.append(("missing", ch)); continue

            lo, hi = GROSS_LIMITS[ch]
            if v < lo or v > hi:
                gates.append(("range", ch)); evidence[f"range_{ch}"] = 1.0

            if st.last[ch] is not None:
                d = abs(v - st.last[ch])
                if d > STEP_LIMITS[ch]:
                    gates.append(("step", ch)); evidence[f"step_{ch}"] = d
                st.runlen[ch] = st.runlen[ch] + 1 if v == st.last[ch] else 0
                if st.runlen[ch] >= FROZEN_MIN_RUN[ch]:
                    gates.append(("frozen", ch)); evidence[f"frozen_{ch}"] = st.runlen[ch]
            st.last[ch] = v

            # --- residual from this station's own harmonic signature -------
            r = v - float(np.dot(st.beta[ch], x))
            a = self.alpha
            st.ew_mean[ch] = (1-a)*st.ew_mean[ch] + a*r
            dev = r - st.ew_mean[ch]
            st.ew_var[ch] = (1-a)*st.ew_var[ch] + a*dev*dev
            s = np.sqrt(st.ew_var[ch]) + 1e-6
            z[ch] = dev / s
            evidence[f"z_{ch}"] = abs(z[ch])

            # --- CUSUM, recursive by definition ---------------------------
            st.cp[ch] = max(0.0, st.cp[ch] + z[ch] - self.k)
            st.cn[ch] = max(0.0, st.cn[ch] - z[ch] - self.k)
            cs = max(st.cp[ch], st.cn[ch])
            cs_peak = max(cs_peak, cs)
            if cs > self.h:
                gates.append(("drift", ch)); evidence[f"cusum_{ch}"] = cs
                st.cp[ch] = st.cn[ch] = 0.0

            # --- tide heartbeat, EW quadrature ----------------------------
            if ch == "P":
                ta = self.tide_alpha
                if st.detrend[ch] is None:
                    st.detrend[ch] = v
                st.detrend[ch] = (1-ta)*st.detrend[ch] + ta*v
                y = v - st.detrend[ch]
                w = 2*np.pi*lst/DOMINANT_PERIOD[ch]
                st.A[ch] = (1-ta)*st.A[ch] + ta*2*y*np.cos(w)
                st.B[ch] = (1-ta)*st.B[ch] + ta*2*y*np.sin(w)

        # --- dewpoint gate: physically impossible, no training needed -----
        # Needs T and RH together, so it runs once per reading, not per
        # channel. Matches detect.py's batch gate_dewpoint exactly (same
        # 0.5 deg / 100.5% tolerance) so batch and streaming agree.
        Tv, RHv = obs.get("T"), obs.get("RH")
        if (Tv is not None and RHv is not None
                and np.isfinite(Tv) and np.isfinite(RHv)):
            Td = float(dewpoint_from_T_RH(Tv, RHv))
            if Td > Tv + 0.5 or RHv > 100.5:
                gates.append(("impossible", "T_RH"))
                evidence["dewpoint_violation"] = round(Td - Tv, 3)
            if Td > DEWPOINT_CEILING:
                gates.append(("impossible", "T_RH"))
                evidence["dewpoint_ceiling"] = round(Td, 1)
        if Tv is not None and np.isfinite(Tv) and Tv > NATIONAL_T_MAX:
            gates.append(("impossible", "T"))
            evidence["t_record"] = round(float(Tv), 1)

        # --- physics verdict ---------------------------------------------
        hard = [g for g in gates if g[0] in ("range", "frozen", "step", "impossible")]
        physics = len(hard) > 0
        missing = any(g[0] == "missing" for g in gates)
        drift = any(g[0] == "drift" for g in gates)
        ml_like = any(abs(v) > self.z_cut for v in z.values())

        # --- degradation (tide) -------------------------------------------
        deg = 0.0
        if st.n > 24*14:
            amp = np.hypot(st.A["P"], st.B["P"])
            if st.amp_base["P"] is None:
                st.amp_base["P"] = amp
            else:
                # slow baseline so seasonal change is tracked, faults are not
                st.amp_base["P"] = 0.9995*st.amp_base["P"] + 0.0005*amp
            base = st.amp_base["P"]
            if base > 1e-6:
                deg = float(np.clip(1 - np.clip(amp/base, 0, 1), 0, 1))
                if deg > self.deg_cut:
                    evidence["tide_loss"] = deg

        flag = int(physics or missing or drift or ml_like or (deg > self.deg_cut))
        if hard:
            # an impossible value outranks the step it also causes
            kinds = {g[0] for g in hard}
            reason = next(k for k in ("impossible", "range", "frozen", "step") if k in kinds)
        elif missing:
            reason = "missing"
        elif deg > self.deg_cut:
            reason = "degrading"
        elif drift:
            reason = "drift"
        elif ml_like:
            reason = "anomaly"
        else:
            reason = "ok"

        sev = float(np.clip(max([abs(v) for v in z.values()] or [0])/8.0
                            + 0.5*physics + 0.5*missing + deg, 0, 1))
        top = sorted(evidence.items(), key=lambda kv: -kv[1])[:3]

        # confidence = margin past the deciding threshold (not a calibrated
        # probability). Physics and missing-data gates are deterministic rules.
        zmax = max([abs(v) for v in z.values()] or [0.0])
        if physics or missing:
            conf = 1.0
        elif flag:
            margins = []
            if deg > self.deg_cut:
                margins.append((deg - self.deg_cut) / self.deg_cut)
            if drift:
                margins.append((cs_peak - self.h) / self.h)
            if ml_like:
                margins.append((zmax - self.z_cut) / self.z_cut)
            conf = 0.5 + 0.5 * (1.0 - np.exp(-3.0 * max(margins + [0.0])))
        else:
            closeness = max(zmax / self.z_cut, cs_peak / self.h, deg / self.deg_cut)
            conf = 0.5 + 0.5 * (1.0 - min(closeness, 1.0))
        return {"flag": flag, "reason": reason, "severity": round(sev, 3),
                "evidence": top, "degradation": round(deg, 3),
                "confidence": round(float(conf), 3),
                "estimate": estimate, "band": band,
                "action": STREAM_ACTIONS.get(reason, "")}


def fit_coeffs(df, n_diurnal=3, n_irls=6):
    """One robust harmonic fit per station-channel. Done once, offline;
    afterwards the streaming detector never refits."""
    import pandas as pd
    lst_all = ((df["timestamp"].dt.hour + df["timestamp"].dt.minute/60.0)
               + df["lon"]/15.0) % 24.0
    doy_all = df["timestamp"].dt.dayofyear.to_numpy().astype(float)
    coeffs = {}
    for sid, idx in df.groupby("station_id", observed=True).indices.items():
        X = np.array([design_row(l, d) for l, d
                      in zip(lst_all.to_numpy()[idx], doy_all[idx])])
        per = {}
        for ch in CHANNELS:
            y = df[ch].to_numpy()[idx].astype(float)
            ok = np.isfinite(y)
            if ok.sum() < 100:
                per[ch] = np.zeros(X.shape[1]); continue
            b = np.linalg.lstsq(X[ok], y[ok], rcond=None)[0]
            for _ in range(n_irls):
                r = y[ok] - X[ok] @ b
                s = 1.4826*np.median(np.abs(r - np.median(r))) + 1e-6
                w = np.sqrt(1.0/(1.0 + (r/(2.5*s))**2))[:, None]
                b = np.linalg.lstsq(X[ok]*w, y[ok]*w.ravel(), rcond=None)[0]
            per[ch] = b
        coeffs[sid] = per
    return coeffs
