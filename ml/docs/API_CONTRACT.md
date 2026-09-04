# API Contract — build the frontend against this

The ML engine is done. You do not need to wait for it, and you do not need to
read the model code. These are the shapes it produces.

---

## 1. Station summary — the main screen

`GET /stations` → array of:

```json
{
  "station_id": "AWS_PNQ",
  "name": "Pune",
  "lat": 18.52,
  "lon": 73.86,
  "health": 0.912,
  "status": "MONITOR",
  "degradation": 0.088,
  "trend_per_day": 0.00123,
  "days_to_threshold": 88,
  "high_conf_alerts": 412,
  "alert_rate_pct": 2.35,
  "rate_vs_network": 1.8,
  "last_seen": "2024-12-31T23:00:00"
}
```

`status` is one of `SERVICE NOW` · `SCHEDULE` · `MONITOR` · `OK`.

**Colour the map by `status`, not by `health` or `degradation`.** Status is
triaged relative to the whole network and is what an engineer acts on. A raw
score is not.

`days_to_threshold` may be `null` — that means no degradation trend is
detectable, not that the station is fine. Render it as `—`, never as `0`.

---

## 2. Per-observation verdict — the live stream

`POST /ingest` → single observation in, verdict out:

```json
{
  "flag": 1,
  "reason": "degrading",
  "severity": 0.734,
  "confidence": 0.83,
  "degradation": 0.512,
  "evidence": [
    ["spatial_z_P", 6.2],
    ["cusum_P", 14.1],
    ["tide_loss", 0.51]
  ]
}
```

`reason` ∈ `ok` · `range` · `step` · `frozen` · `missing` · `drift` ·
`degrading` · `anomaly` · `unclassified`

**`unclassified` is a real value, not an error.** It means a gate fired but no
signature matched. Display it honestly — do not map it to something prettier.

`confidence` is calibrated: when it says 0.83, it is right about 83% of the
time. It is not a made-up severity number, so it is safe to show to a user.

---

## 3. Alert detail — the explainability screen

This screen is **10% of the SIH rubric**. It matters more than the map.

Render `evidence` as a ranked list in plain language:

```
AWS_HYD · 14 May 2024, 15:00 · FLAGGED

Why:
  • Temperature 8.2 standard deviations from every neighbour
  • The other 9 stations agree with each other to within 1.4 °C
  • Drift tally has been climbing for 31 hours

Confidence:   0.83  (calibrated — 83% means 83%)
Likely cause: sensor drift
Suggested:    recalibrate, offset −0.257 °C
```

Map the raw keys to readable text:

| key | render as |
|---|---|
| `spatial_z_T` / `_P` / `_RH` | "N standard deviations from every neighbour" |
| `cusum_T` / `_P` / `_RH` | "drift tally climbing for N hours" |
| `tide_loss` | "pressure heartbeat down to N% of normal" |
| `runlen_T` | "identical value for N hours" |
| `gate_dewpoint` | "physically impossible — dewpoint above air temperature" |

---

## 4. Time series — the station detail chart

`GET /stations/{id}/timeseries?from=&to=` → array of:

```json
{
  "timestamp": "2024-05-14T15:00:00",
  "T": 34.2, "P": 948.1, "RH": 62.0,
  "flag": 0,
  "amp_ratio_P": 0.97
}
```

**The single most persuasive visual in the whole project** is two stacked
plots for one station:

- **top** — raw pressure over several weeks, which looks completely normal
- **bottom** — `amp_ratio_P` (the tide heartbeat) visibly fading, crossing an
  alarm line at 0.55

Annotate the crossing: *"SkyGuard raises the alarm here — days before any
reading looked wrong."* Give this chart room.

---

## 5. Priorities

Build in this order. Visualisation is only 5% of the rubric — do not
gold-plate it.

1. **Station map**, coloured by `status`
2. **Alert detail** with the evidence list
3. **Work order table** — sortable by status then health. *This is the product.*
4. **Tide heartbeat chart** — the best 20 seconds of the demo
5. **Live stream ticker** with a throughput counter (real-time is 15% of the
   rubric; a moving number proves it better than a slide)

### Worth adding if there's time

- **"Show me a fault"** button that injects a fault live so a judge can watch
  the system catch it on demand. Best interactive moment available.
- Before/after toggle on any chart, with neighbours overlaid as proof
- Export the work order as CSV

---

## Design notes

- **Dark background.** It is an operations tool, it will be on a wall display,
  and it makes the status colours read.
- **One accent colour for alarm.** Do not rainbow the interface.
- **Numbers large enough to read from three metres.**
- **Nothing on the main screen should require scrolling.** A judge will not
  scroll.

---

## Backend endpoints

```
GET  /stations                     → §1
GET  /stations/{id}/timeseries     → §4
GET  /stations/{id}/alerts         → flagged rows + evidence
POST /ingest                       → §2
GET  /health                       → network summary
```

`StreamingSkyGuard` holds O(1) state per station — keep it in memory, no
database round-trip per observation. At 15,579 obs/sec you will not be the
bottleneck.
