"""
SkyGuard AI - the fault injector.

Problem statement 26073 says evaluation happens "in anomaly injected data".
So the injector is not a testing afterthought -- it IS the benchmark, and it
is built before any model.

Seven failure modes, each drawn from a documented real AWS failure:

  spike       Single-sample excursion. Power glitch, telemetry bit error.
  frozen      Value held constant. The dangerous one: every reading is in
              range and looks plausible. Haryana's AWS did this for months.
  drift       Slow ramp. Calibration decay -- invisible to any threshold.
  step        Abrupt constant bias. Post-maintenance, battery swap, resiting.
  noise       Variance inflates while the mean stays correct. Loose wiring,
              failing ADC, moisture ingress.
  dropout     Missing samples, or the last good value repeated on comms loss.
  sluggish    Signal amplitude damped toward its own mean. Blocked pressure
              port, fouled hygrometer, degraded radiation shield.

`sluggish` is the reason this project exists. Every value stays in range,
every step is smooth, no conventional QC test fires -- and the station is
lying. It is caught by watching the atmospheric tide, not by thresholds.
"""
import numpy as np
import pandas as pd

FAULT_CLASSES = ["spike", "frozen", "drift", "step", "noise", "dropout", "sluggish"]
CHANNELS = ["T", "P", "RH"]

# Per-channel scale so that "severity 1.0" means a comparable insult
CHANNEL_SCALE = {"T": 1.0, "P": 0.6, "RH": 6.0}


def inject_faults(df, n_events=90, seed=7, severity=1.0,
                  min_len=6, max_len=240):
    """
    Inject faults into a clean network record.

    Returns (faulty_df, events_df). The faulty frame carries three extra
    columns per channel-agnostic row:
        is_fault      1 if this sample is corrupted
        fault_class   which of the seven modes
        fault_channel which sensor
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
    for _ in range(n_events):
        sid = rng.choice(stations)
        ch = rng.choice(CHANNELS)
        cls = rng.choice(FAULT_CLASSES)
        rows = idx_map[sid]
        n = len(rows)

        if cls == "spike":
            length = 1
        elif cls == "sluggish":
            length = int(rng.integers(240, max(241, max_len)))
        else:
            length = int(rng.integers(min_len, max_len))
        length = min(length, n // 4)
        start = int(rng.integers(48, n - length - 48))
        sel = rows[start:start + length]

        vals = out.loc[sel, ch].to_numpy(dtype=float).copy()
        scale = CHANNEL_SCALE[ch] * severity
        m = len(vals)

        if cls == "spike":
            mag = rng.uniform(6, 15) * scale * rng.choice([-1, 1])
            vals = vals + mag

        elif cls == "frozen":
            vals[:] = vals[0]

        elif cls == "drift":
            rate = rng.uniform(3, 9) * scale * rng.choice([-1, 1])
            vals = vals + rate * np.linspace(0, 1, m)

        elif cls == "step":
            mag = rng.uniform(2.5, 6) * scale * rng.choice([-1, 1])
            vals = vals + mag

        elif cls == "noise":
            infl = rng.uniform(4, 10)
            base_sd = max(np.std(np.diff(vals)) / np.sqrt(2), 1e-3)
            vals = vals + rng.normal(0, base_sd * infl, m)

        elif cls == "dropout":
            if rng.random() < 0.5:
                vals[:] = np.nan                    # true gap
            else:
                vals[:] = vals[0]                   # stale repeat
        elif cls == "sluggish":
            # Progressive damping toward the local mean: amplitude decays
            # from 100% to as little as 15% while the mean is preserved.
            local_mean = np.nanmean(vals)
            damp = np.linspace(1.0, rng.uniform(0.15, 0.45), m)
            vals = local_mean + (vals - local_mean) * damp

        if ch == "RH":
            # A broken hygrometer can and does report impossible values;
            # only clip the physically hard floor.
            vals = np.where(np.isnan(vals), np.nan, np.maximum(vals, -20))

        out.loc[sel, ch] = np.round(vals, 2)
        out.loc[sel, "is_fault"] = 1
        out.loc[sel, "fault_class"] = cls
        out.loc[sel, "fault_channel"] = ch

        events.append({
            "station_id": sid, "channel": ch, "fault_class": cls,
            "start_time": out.loc[sel[0], "timestamp"],
            "end_time": out.loc[sel[-1], "timestamp"],
            "n_samples": m,
        })

    return out, pd.DataFrame(events)
