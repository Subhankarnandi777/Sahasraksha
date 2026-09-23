# Sahasraksha — operational use cases (SIH26073)

Each case follows the same pattern: what happens in the field, what Sahasraksha does, the measured result, and who acts on it.

All numbers come from the final validation run. `FINAL_NUMBERS.md` gives the log reference for each one.

---

## 1. The impossible reading (the PS example)
**Field:** Mumbai AWS reports **55 °C** at 16:00 in May. Neighbours are reporting 27–35 °C.
**Sahasraksha:**
- Five physics gates fire in the same hour:
  - above the Indian national record (52 °C)
  - dewpoint 53.9 °C, above the physical ceiling of 34 °C
  - impossible moisture jump
  - temperature step
  - pressure step
- The reading is labelled **impossible**, quarantined from forecast assimilation, and replaced by a labelled estimate of **31.1 °C** (the true value was 31.0 °C).
**Who acts:** the forecaster gets a clean input; a technician is dispatched only if the fault recurs within 24 h.

## 2. The station that goes silent
**Field:** a station's modem or battery fails. In the Gurugram case the station stayed silent for **480+ hours** before anyone noticed.
**Sahasraksha:**
- The comms layer knows each station's normal reporting cadence (hourly or 3-hourly).
- It raises a dropout alarm at **0 h**, on the first missed report.
- Dropout recall on the benchmark is 100%.
**Who acts:** the network operator, the same day.

## 3. Calibration drift (the fault threshold QC can't see)
**Field:** a humidity sensor drifts by 0.1 %RH per day. Every value stays in range, so threshold QC never fires.
**Sahasraksha:** the slow CUSUM on the physics residual accumulates the small bias. There are two operating modes:
- **Network monitoring (k=3):**
  - Drift recall is 3.3× WMO QC.
  - 83% of drift faults are caught at a median 21 h, versus 33% for WMO QC.
  - False-alarm rate is 2.3%.
- **Calibration hunt (k=2):**
  - Recall on drift rises to **70%**, at a 9.4% false-alarm rate.
  - Run it monthly as a sweep.
**Who acts:** the calibration team, which gets a ranked list instead of a fixed rotation.

## 4. The sluggish barometer (degradation before failure)
**Field:** a pressure sensor ages and its response slows. Its readings stay plausible, but the daily swing shrinks.
**Sahasraksha:**
- The **tide heartbeat** tracks the amplitude of the semidiurnal atmospheric tide, which every healthy barometer reproduces.
- Losing that amplitude is a degradation signal that appears before outright failure.
- Mid-fault, the work order escalates these stations to **SERVICE NOW**.
- Sluggish detection is 2.5× WMO QC.
**Who acts:** maintenance, *before* the sensor fails.
**Honest limit:** the fault is detected 59% of the time but named correctly only 29% of the time (it is often called "noise"). The technician still goes to the right station.

## 5. Real weather is not a fault
**Field:** a heat wave (≥45 °C), a monsoon depression, or a cold wave.
**Sahasraksha:**
- The **regional-event veto** checks whether neighbours show the same departure.
  - If they do, the soft layers (CUSUM, ML, tide) stand down.
  - Physics and comms are never vetoed.
- Measured results:
  - Heat-wave hours are flagged at 0.88%, *below* the 1.18% baseline.
  - A 3-station depression drops from **99.3% flagged to 0.3%**.
  - Deep-low hours on real data dropped 5.5×.
- Repairs are never written into the warning path. Doing so would have erased 17 of 35 real heat waves.
**Who acts:** nobody. That is the point: forecasters keep the extreme values that matter most.

## 6. Data corruption in the pipeline
**Field:** a logger firmware update sends °F instead of °C, or pressure in kPa, or drops a decimal point. A datalogger may also swap the T and RH columns, or resend and reorder records.
**Sahasraksha:**
- Unit, range, hydrostatic (MSL) and timestamp-integrity gates catch **98.1%** of six corruption types.
- The false-alarm rate on clean rows is 2.65%.
- Corrupt rows are labelled **corrupt**, not "sensor fault", so the ticket goes to IT and not to a field technician.
**Who acts:** the data/IT team.

## 7. Trust weights for forecast assimilation
**Field:** NWP data assimilation ingests AWS observations.
**Sahasraksha:**
- Every observation carries a flag, a root cause, a severity grade and a **confidence**.
- Low-confidence or flagged observations can be down-weighted or replaced with the labelled estimate.
- Measured on real data: heat-alert decision errors fell **48%** (543 → 285) when flagged values were repaired. Naive repair only reduced them to 375.
- The Chennai case shows what this catches: 5 hours on 26–27 May 2024 with dewpoint 34–36 °C passed NOAA QC. Sahasraksha flagged them.
**Who acts:** the NWP/assimilation team.

## 8. A station that checks itself, with no uplink
**Field:** a remote AWS with intermittent connectivity.
**Sahasraksha:**
- The physics gates, harmonic residual, CUSUM and tide amplitude all run on the station's microcontroller.
- The whole on-device state is **116 bytes** (0.022% of ESP32 SRAM) and costs about 102 flops per sample.
- The station can flag itself locally and send the verdict when the link returns.
- The server adds the network-level layers: spatial consistency and IsolationForest.
**Who acts:** the station itself, then the server on reconnect.
**Status:** the C firmware compiles and runs on the host; the ESP32 hardware build and energy measurement are in progress.

---

### What an operator sees for each alert (site / API / CSV)
| Field | Example |
|---|---|
| flag | 1 |
| root cause | impossible / corrupt / drift / noise / sluggish / frozen / step / spike / dropout / stale_repeat |
| severity | CRITICAL / MAJOR / MINOR (top 20% / next 30% / rest of the queue) |
| confidence | 0–1 |
| estimate | 31.1 °C (labelled, ± band) |
| action | "Quarantine from assimilation; dispatch if recurs in 24 h" |
