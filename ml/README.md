# SkyGuard AI — ML Engine

**SIH26073** · AI/ML-Based Intelligent Anomaly Detection for Automatic Weather Stations
Ministry of Earth Sciences · India Meteorological Department

> **Status: the detection engine is complete and validated.** This is not a
> prototype waiting on the finale. The frontend in `/pages` should build
> against the contract in [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md).

---

## What this does

India runs roughly 2,595 automatic weather instruments. When one breaks it
usually keeps transmitting, so the archive fills with plausible-looking numbers
that are wrong. Gurugram's station was dead for over twenty days while the city
recorded 128 mm of rain — its heaviest since 2010 — and the official record
shows none of it.

SkyGuard finds the stations that are lying.

---

## Quick start

```bash
pip install -r requirements.txt
jupyter notebook notebooks/SkyGuard_SIH26073.ipynb
```

Turn **Internet ON** in the notebook settings, then Run All. About five minutes.
Cells 1–30 run offline; the rest download real Indian station records from NOAA.

To use the modules directly:

```python
from skyguard.network import generate_network
from skyguard.model import build_feature_frame, fit_score_models, threshold_at_budget, fuse

df = generate_network(days=180, seed=42)
F  = build_feature_frame(df)
scores, fitted = fit_score_models(F, train_mask)
flag, *_ = fuse(F, scores["IsolationForest"],
                threshold_at_budget(scores["IsolationForest"], 0.05),
                degradation_cut=0.45)
```

---

## Architecture

Four independent layers, OR-ed together. **The ordering is the argument.**

```
   raw observation (T °C, P hPa, RH %)
            │
   ┌────────▼────────┐
   │ L0  PHYSICS     │  untrained · deterministic
   │  dewpoint ≤ air │  lift 12.32x · 0 false positives / 95,326 obs
   │  temperature    │
   └────────┬────────┘
   ┌────────▼────────┐
   │ L1  HARMONIC +  │  subtract the station's own climatology,
   │     SPATIAL     │  then subtract the neighbours
   │                 │  removes 51% of residual variance
   └────────┬────────┘
   ┌────────▼────────┐
   │ L2  TIDE        │  pressure carries a 12-hour solar tide
   │     HEARTBEAT   │  lift 9.37x · warns BEFORE readings look wrong
   └────────┬────────┘
   ┌────────▼────────┐
   │ L2b CUSUM       │  slow drift · lift 1.79x
   ├─────────────────┤
   │ L3  ML on       │  isolation forest on residuals ONLY
   │     residuals   │  lift 4.03x
   └────────┬────────┘
            ▼
   flag → confidence → root cause → maintenance work order
```

A model trained on raw values wastes capacity relearning the daily cycle,
cannot separate weather from sensor error, and cannot be cross-examined. We let
physics do what physics does exactly and ask ML only for the residual.

**And we can prove the ordering isn't just a story:** a logistic stack given
free rein over the four layer outputs independently weighted physics highest
(3.04) and the tide second (2.27).

---

## Results

Validated on **NOAA Integrated Surface Database** — real Indian station
records with NOAA's own quality experts' flags. **The model never sees those
labels.**

### The finding that justifies the project

> **57% of expert-confirmed anomalies pass every threshold check that
> operational QC applies today.**

Threshold QC is *excellent* when it fires — but it has a hard ceiling at 38%.

### On the invisible majority

93,988 observations that pass every threshold check, 240 expert-confirmed:

| Method | ROC-AUC | recall@top5% |
|---|---|---|
| **SkyGuard** | **0.780** | **0.196** |
| Raw IsolationForest | 0.660 | 0.087 |
| Raw One-Class SVM | 0.519 | 0.158 |
| Threshold QC | 0.500 | no signal by construction |

**2.25× more of the invisible anomalies than a conventional detector.**

### Layer contributions — 4 hourly stations, 2 years

| Layer | Fires on | Lift |
|---|---|---|
| L0 physics | 0.84% | **12.32×** |
| L2 tide heartbeat | 0.19% | **9.37×** |
| L3 IsolationForest | 7.16% | 4.03× |
| L2b CUSUM | 1.76% | 1.79× |

### Generalisation — 25 held-out stations, 5 years

Leave-one-station-out, 2,785 expert-flagged anomalies:

```
mean 0.862 · std 0.054 · worst station 0.723
```

### Engineering

| | |
|---|---|
| Throughput | 15,579 obs/sec, O(1) memory per station |
| Headroom vs IMD network | 16,378× |
| ESP32 firmware | 1,885 B code, 116 B state, 0.385% SRAM, compiles clean |
| Impossible-value detection | 60/60, zero false alarms, zero training data |
| Confidence calibration | says 95%, is right 95.1% (conformal, verified) |

---

## Read this before changing anything

Eight bugs are already fixed here. **Several look like sensible
simplifications** — undoing one silently destroys a result.

| Change | What breaks |
|---|---|
| Put `gate_missing` back inside `physics_flag` | physics drops 12.32× → **1.0×** (chance) |
| Apply the tide to T and RH as well as P | fires on the monsoon, scores **0.24×** — below chance |
| Fill a NaN `amp_ratio` with 0 | every data gap becomes a max-severity alert |
| Use an adaptive `degradation_cut` quantile | forces 3% flagging regardless of the data |
| Compute cadence from timestamp gaps | on a reindexed grid every station reads "hourly" |
| Sum ISD `AA1` precipitation reports | they are running accumulations — inflates rainfall 6× |
| Default root cause to `"step"` | becomes the largest category and means nothing |
| Score rows the archive never had | ordinary telemetry gaps count as missed faults |

**Debugging lesson:** check `count` before interpreting `std`. Bengaluru's
pressure looked like a wildly unstable barometer at 35.8 hPa standard
deviation. It had **twenty readings in two years**.

---

## Known limitations — state these, don't hide them

- **The tide heartbeat requires hourly reporting.** On three-hourly data a
  12-hour harmonic sits at the Nyquist limit and collapses (9.37× → 0.00×).
  The code detects cadence and **stays silent** rather than emit a number it
  cannot support. IMD's AWS network transmits hourly by design.
- **`gate_dewpoint` reads zero on ISD, and that is not a success.** ISD supplies
  dewpoint and we derive humidity from it, so the two cannot contradict. The
  test is *unavailable*, not passed. Evidenced separately by injection: 60/60.
- **`gate_range` reads zero, and that IS a result.** No physically impossible
  value in 95,326 observations — no false positives on QC'd data.
- **Our false positives may not be false.** NOAA flags what NOAA caught, so
  measured precision is a **lower bound**.
- **PR-AUC ties with the baseline** on the invisible subset (0.0080 vs 0.0081).
  At a 0.255% base rate PR-AUC is dominated by imbalance and cannot separate
  methods. Point at ROC-AUC and recall@5%.

### Things we tried that failed — and we say so

- **Auto-correcting data for warnings** destroyed 17 of 35 real heat waves. A
  heat wave looks exactly like the anomaly repair removes.
- **Auto-correcting advisories** made them worse: 156 wrong → 206.
- **Abstaining on advisories** was worse still: 156 → 596.
- **Rain forecasting from T/P/RH** could not beat climatology. Dropped.
- **Humidity drift correction** — noise floor 5.9–10.8%, no threshold works.
  Dropped.

**The conclusion across all four: SkyGuard's value is knowing what to
distrust, not inventing replacements.** It flags; it does not silently rewrite.

---

## Module map

| Module | What it does |
|---|---|
| `physics.py` | Magnus/dewpoint, MSL reduction, heat index, WBGT, WMO limits |
| `network.py` | Physically-grounded synthetic AWS network incl. the S2 tide |
| `injector.py` | Seven fault classes — the benchmark, built before any model |
| `detect.py` | Layers 0, 1, 2, 2b — gates, harmonics, spatial, tide, CUSUM |
| `model.py` | Feature assembly, ML, fusion, root cause, evaluation |
| `stream.py` | O(1) streaming detector + `fit_coeffs` |
| `operate.py` | Calibration, maintenance work order, safe repair, `SkyGuard` class |
| `validate.py` | LOSO, bootstrap CIs, balanced injection |
| `compare.py` | Baselines + ESP32 C source generation |
| `gapfill.py` | Conformal confidence, trust scores, recalibration offsets |
| `scale_up.py` | NCEI station index, multi-station download, long-window tide |

---

## Reproducibility

- All randomness seeded (`generate_network(seed=42)`, `inject_balanced(seed=7)`)
- Thresholds set from an **alarm budget**, never tuned on labels
- Harmonic fit uses IRLS so faults in the fitting window cannot capture it
- Multi-seed results reported with mean and spread, never a single lucky run
