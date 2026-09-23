# Sahasraksha — final numbers sheet (SIH26073)

**Source:** final Kaggle commit, 23 Sept 2026 (log `6380e57a`), with `FAST_MODE = False`, the NOAA data cache attached and the regional veto (E27) active.

**Rule:** every number in the deck, site, chatbot, README and video must match this sheet. The last column is the text to Ctrl+F in the log.

---

## A. Headline (synthetic benchmark: 12 stations, 51,840 obs, 8 fault classes, known ground truth)

| Claim | Number | Say it like this | Ctrl+F |
|---|---|---|---|
| Precision / recall / false-alarm rate | **0.824 / 0.773 / 1.45%** | "catches 77% of faults with a 1.45% false-alarm rate" | `FINAL VALIDATED` |
| WMO threshold QC, same data | 0.943 / 0.551 / 0.29% | "WMO QC is more precise because it only answers the easy question" | `FINAL VALIDATED` |
| Extra faults caught vs WMO | **1.40×** recall (+22 points) | | `1.40x improvement` |
| Step faults (battery swap, relocation) | **89.7% vs WMO 0%** | "structurally invisible to threshold QC" | `STEP   WMO 0.00%` |
| Drift / noise / sluggish recall | 32.7% / 71.5% / 58.8% vs WMO 10.1% / 26.6% / 23.3% | **3.3× / 2.7× / 2.5×** | `DRIFT          10.06%` |
| Dropout / frozen / stale | parity with WMO (100 / 94.8 / 95.4%) | "we keep WMO QC as Layer 0 and add coverage above it" | `WHERE WE DELIBERATELY` |
| Root-cause naming precision | frozen 1.00, spike 1.00, stale 1.00, step 0.97, dropout 0.80, noise 0.61, drift 0.58, **sluggish 0.29** | Sluggish is *detected* 59% of the time but often *named* noise; say so plainly | `ROOT-CAUSE ATTRIBUTION PRECISION` |
| Severity grades | CRITICAL 806 (20.5%) / MAJOR 1,163 (29.6%) / MINOR 1,965 (49.9%) | Share of each grade that is a false positive: 9.7% / 7.2% / 26.9% | `SEVERITY GRADES` |
| Self-healing (repair error recovered) | T **79.2%**, P 66.5%, RH 62.3% | "a labelled estimate, never silently written into the warning path" | `SELF-HEALING` |
| Why repair never overrides raw data | If it did, it would have destroyed **17 of 35** real heat waves | | `17 of 35` |

## B. Honest causal numbers (walk-forward: the model only ever sees the past)

| Claim | Number | Ctrl+F |
|---|---|---|
| Causal walk-forward, 120 h refit | **P 0.671 / R 0.677 / FAR 2.29% / F1 0.674** | `PART 24 FINAL` |
| Leaky static fit evaluated causally | P 0.185 / FAR 23.8% → walk-forward is **3.6× more precise** | `CAUSAL SCORECARD` |
| Two operating modes | Network monitoring k=3: drift recall 0.23, FAR 2.3%. **Calibration hunt k=2: drift recall 0.70**, FAR 9.4% | `OPERATING FRONTIER` |
| Refit cadence (24–168 h) | F1 0.649–0.674; cadence is not a tuning lever | `SUB-WEEKLY REFIT` |

> If a judge asks "is 0.82 real?", answer: "0.82 is the benchmark. Under strict walk-forward, where the model never sees the future, it is 0.67 F1 with a 2.3% false-alarm rate. We report both."

## C. Real Indian data

| Claim | Number | Ctrl+F |
|---|---|---|
| Real data volume | **60 stations, 2,625,379 rows, 2020–2024** (plus 10 ISD stations, 175k rows, 2 years) | `2,625,379` |
| Generalisation to an unseen station (LOSO) | ROC-AUC **0.885** on 56 of 60 stations (worst 0.694); **0.856** on ISD (9 stations, worst 0.769) | `LOSO — big` |
| vs NOAA expert quality flags | ROC-AUC **0.839** (95% CI 0.823–0.854) vs WMO QC 0.684 | `On real expert labels` |
| PR-AUC | **0.774 vs 0.385** best baseline (2.0×); 4.2× WMO QC | `PR-AUC 0.774` |
| Anomalies that pass every threshold | 218 of 385 NOAA-confirmed (**57%**) | `pass every threshold check` |
| Caught by us, missed by NOAA | **Chennai, 26–27 May 2024**: 5 hours with dewpoint 34.1–35.7 °C, all marked good by NOAA | `Real ISD rows breaking` |
| WMO-flagged rows we miss | **0 of 2,452** | `WMO-flagged rows Sahasraksha misses` |
| Quiet on real weather: overall flag rate | **1.18%** of NOAA-clean hours (733k hours) | `FALSE-ALARM RATE UNDER ALL CONDITIONS` |
| … by season | 0.68–1.53% (0.58–1.30× baseline) | same |
| … by terrain | coastal 1.14%, plains 1.17%, upland 1.27% | same |
| … during heat waves (≥45 °C) | **0.88%**, below baseline: a real heat wave is *not* called a fault | same |
| … during deep lows (<995 hPa) | **4.5%**, down from about 25% before the regional veto (5.5× fewer); still 3.8× baseline | same |
| Genuine regional event (synthetic west-coast depression, 3 stations) | flagged **99.3% → 0.3%** with the regional veto | `GENUINE-EVENT TEST` |
| Real-weather fault injection (Benchmark 1) | P 0.24 / R 0.57 / FAR 4.7% (was 17% FAR before the fixes) | `ML at 1% rate` |
| Silent station (Gurugram-type outage) | alarm at **0 h** (Gurugram in reality: 480+ h) | `hours to alarm` |
| Heat-alert decisions (repair on real data) | errors 543 → 285 (**48% fewer**) vs 375 for naive repair; touched only 3.6% of samples | `decision errors` |

## D. PS-specific tests

| Claim | Number | Ctrl+F |
|---|---|---|
| PS example: reported 55 °C | 5 gates fire (`t_record`, `dewpoint_ceiling`, `moisture_jump`, `step_T`, `step_P`); labelled **impossible**; estimate **31.1 °C vs real 31.0 °C** | `reported : T=55.0` |
| New gates, false hits on real data | national record 0 of 2.8M; dewpoint ceiling 6 (5 of them the Chennai hours above); MSL 0; moisture jump 106 of 2.8M | `False-alarm check of the new gates` |
| Data corruption (6 types: °F for °C, T/RH swap, duplicate, kPa for hPa, missing decimal, out-of-order) | **98.1% caught**, 2.65% false alarms on clean rows | `DATA-CORRUPTION BENCHMARK` |
| Lead time vs WMO | step caught 100% vs 0%; drift 83% (median 21 h) vs 33%; **5 of 26** slow faults WMO never catches | `LEAD-TIME BACKTEST` |
| Work order mid-fault | sluggish stations escalate to **SERVICE NOW**; drift stations sit at MONITOR | `WORK ORDER, cut MID-FAULT` |
| Tamper/manipulation detector | 60 of 60 caught, 0 false alarms, no training data needed | `training_data_required` |
| Calibration (Brier) | 0.0675 vs 0.0935 base rate; over-confident in the top bin (say so) | `Brier score` |

## E. Explainability

| Claim | Number | Ctrl+F |
|---|---|---|
| Which layer decides each alert | physics 53.6%, CUSUM 23.5%, comms 11.8%, ML 6.5%, tide 4.7% | `WHICH LAYER DECIDED` |
| ML-only alerts that are real faults | 59.6% (n=255) | `ML-only alerts` |
| Top SHAP drivers of ML alerts | cusum_slow_RH, cusum_fast_RH, rollstd_ratio_P | `SHAP on 255` |
| SHAP vs LIME agreement (top 3) | 22%; LIME vs LIME with another seed: 88% | `SHAP vs LIME` |

> Framing: 93.5% of alerts are decided by named, rule-based evidence (physics, CUSUM, comms, tide), so the explanation is the rule itself. SHAP (exact TreeSHAP) covers the 6.5% decided by ML. LIME is shown as a cross-check.

## F. Speed and edge

| Claim | Number | Ctrl+F |
|---|---|---|
| Throughput, one CPU core | **12,462 obs/s**, 80 µs per observation. Across runs 10.9k–12.9k: quote "over 10,000 obs/s" | `throughput :` |
| Headroom vs IMD network (2,395 sites, hourly) | ~18,700× | `Headroom` |
| Streaming path (what the site runs) | P 0.835 / R 0.447 / flag rate 4.3% | `precision 0.835` |
| Per-station state on device | **116 bytes** (0.022% of ESP32 SRAM) | `per-station state` |
| Code size | 1,885 B `.text` **compiled for x86-64 host**. The ESP32 Xtensa build is pending (teammate) | `code size` |
| Arithmetic | ~102 flops per sample | `flops` |

---

## Do NOT say (stale or wrong)

| Stale claim | Use instead |
|---|---|
| LOSO 0.849 / 0.862 / "~0.85–0.86, worst ~0.72" | 0.885 (56 stations) / 0.856 (ISD) |
| 15,579 obs/s | >10,000 obs/s (12,462 this run) |
| "ESP32 1,885 B / 0.385% SRAM" | 116 B state = 0.022% SRAM; the 1,885 B code size is from an x86 host build |
| P 0.8217 / FAR 1.48% | 0.824 / 1.45% |
| Real-weather baseline 3.56% | 1.18% (after the regional veto) |
| "86% of alerts CRITICAL" | 20 / 30 / 50% split |
| Conformal coverage 0.951 / 0.901 / 0.803 | not printed in the final run; don't cite |
| "Energy efficient on ESP32" (as a measured claim) | "designed for MCU: 116 B state, ~102 flops/sample; hardware measurement in progress" until the teammate measures it |
