import { useMemo, useState } from "react";
import FilterTabs from "../components/FilterTabs.jsx";
import Sparkline from "../components/Sparkline.jsx";
import { evidenceText, number, percent } from "../services/api.js";
import { fitSolarTides, thin } from "../services/harmonics.js";

// The pipeline's actual gross physical limits for surface pressure --
// GROSS_LIMITS["P"] in ml/sahasraksha/stream.py. Wide on purpose: station
// pressure is not reduced to sea level here, so a Himalayan station reads
// far below 1000 hPa without anything being wrong with it.
const PRESSURE_GROSS_MIN = 500;
const PRESSURE_GROSS_MAX = 1100;

// The detector's own long-horizon tidal degradation, which is what the
// headline percentage reports. Returns null rather than 0 when the feed
// has told us nothing, so "no reading yet" can't render as "0% loss".
function heartbeatLoss(verdicts, alerts) {
  const candidates = [...alerts, ...verdicts];
  for (const item of candidates) {
    const pair = (item.evidence || []).find(([key]) => key === "tide_loss");
    if (pair && Number.isFinite(Number(pair[1]))) return Number(pair[1]);
  }
  const degradation = candidates[0]?.degradation;
  if (degradation === null || degradation === undefined) return null;
  const value = Number(degradation);
  return Number.isFinite(value) ? value : null;
}

export default function PressureHeartbeat({ selectedStation, timeseries, verdicts, openAlerts, loading, error }) {
  const [mode, setMode] = useState("heartbeat");
  const stationAlerts = selectedStation ? openAlerts.filter((alert) => alert.station_id === selectedStation.station_id) : [];
  const loss = heartbeatLoss(verdicts, stationAlerts);
  const pressureValues = timeseries.map((row) => row.P).filter((value) => value !== null);
  const evidence = stationAlerts[0]?.evidence || verdicts[verdicts.length - 1]?.evidence || [];

  // The station's OWN solar tides, fitted to its real barometric record.
  //
  // What used to be here was a hardcoded Math.sin() wave around a constant
  // 1013.25 hPa -- the comment said "Generate synthetic smooth S2 tidal
  // curve for demonstration" -- damped by a fabricated factor and labelled
  // "Observed Station Signal". No reading from this station, or any
  // station, reached that chart. Both traces below are now derived from
  // the same timeseries the rest of the page already plots.
  const tideFit = useMemo(
    () => fitSolarTides(timeseries, selectedStation?.lon),
    [timeseries, selectedStation?.lon]
  );

  const pressureInGrossLimits =
    pressureValues.length > 0 &&
    pressureValues.every((v) => v >= PRESSURE_GROSS_MIN && v <= PRESSURE_GROSS_MAX);
  if (!selectedStation) {
    return (
      <main className="screen pressure-screen">
        <div className="loading-state-card">
          <div className="loading-spinner" />
          <p>Loading tidal heartbeat data...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="screen pressure-screen">
      {/* Breadcrumb Row */}
      <div className="breadcrumb-row">
        <a
          href={selectedStation ? `/stations/${encodeURIComponent(selectedStation.station_id)}` : "/stations"}
          className="back-link"
        >
          ← Return to {selectedStation?.name || "Station"}
        </a>
        <span className="breadcrumb-separator">/</span>
        <span className="breadcrumb-current">S2 Pressure Heartbeat</span>
      </div>

      {/* Page Title Row */}
      <div className="page-header-strip">
        <div>
          <span className="section-eyebrow">ATMOSPHERIC TIDAL HARMONIC QC</span>
          <h1 className="page-main-heading">12-Hour Solar Atmospheric Tide Heartbeat</h1>
          <p className="page-sub-heading">
            {selectedStation?.station_id} • {selectedStation?.name} — Autonomous calibration drift surveillance
          </p>
        </div>
      </div>

      {error ? <p className="state error">{error}</p> : null}

      {/* Flagship Innovation Callout Banner */}
      <div className="innovation-banner-card">
        <div className="innovation-header">
          <span className="innovation-tag">CORE ML INNOVATION</span>
          <h3>Why Atmospheric Heartbeat?</h3>
        </div>
        <p>
          Every barometric sensor on Earth experiences a predictable 12-hour oscillation caused by solar thermal heating of the upper atmosphere (the <b>S₂ solar semi-diurnal tide</b>, around 1 hPa amplitude at these latitudes, strongest near the equator and weakening polewards). When a pressure transducer accumulates moisture or loses calibration, this harmonic signal dampens or de-phases <b>weeks before readings drift outside standard QC thresholds</b>.
        </p>
      </div>

      {/* Loss Meter & Mode Switcher */}
      <div className="heartbeat-loss-card">
        <div className="loss-score-area">
          {/* The minus sign used to be hardcoded into this template, so a
              real 7% loss rendered as "-7%" -- which reads as a 7% gain. */}
          <div className="loss-big-val">
            {loss === null ? "--" : `${Math.round(loss * 100)}%`}
          </div>
          <div className="loss-desc">
            <h3>Harmonic Tidal Strength Loss</h3>
            <p>
              {loss === null
                ? "No tidal degradation reported for this station yet."
                : loss > 0.15
                ? "Significant harmonic dampening detected: sensor port clogging or diaphragm calibration fatigue."
                : "Nominal tidal resonance: barometric diaphragm functioning with high fidelity."}
            </p>
          </div>
        </div>

        <div className="loss-filter-tabs">
          <FilterTabs
            value={mode}
            onChange={setMode}
            tabs={[
              { value: "heartbeat", label: "Harmonic Tide (S2)" },
              { value: "actual", label: "Raw Barometric P" },
              { value: "combined", label: "Dual Inspection" }
            ]}
          />
        </div>
      </div>

      {/* Chart Visualizations */}
      <div className="heartbeat-charts-grid">
        {(mode === "heartbeat" || mode === "combined") && (
          <section className="pane-card chart-pane">
            <div className="pane-header-simple">
              <div>
                <span className="card-tag">PHYSICS HARMONIC DECOMPOSITION</span>
                <h3>S₂ Semi-Diurnal Wave (12-Hour Resonance)</h3>
              </div>
              <span className="live-clock-tag">Harmonic Analysis</span>
            </div>
            {tideFit ? (
              <>
                <div className="tide-legend">
                  <span className="legend-item">
                    <span className="legend-color degraded" /> Measured (trend and S₁ removed)
                  </span>
                  <span className="legend-item">
                    <span className="legend-color nominal" /> Fitted S₂ harmonic ({number(tideFit.s2Amplitude, 2)} hPa amplitude)
                  </span>
                </div>
                <div className="chart-svg-container">
                  <Sparkline
                    values={thin(tideFit.observed)}
                    comparison={thin(tideFit.fitted)}
                    tone={loss !== null && loss > 0.15 ? "amber" : "orange"}
                    height={130}
                    showLabels={true}
                  />
                </div>
                <p className="chart-footer-note">
                  Least-squares fit of the S₁ (24 h) and S₂ (12 h) solar tides, in local solar
                  time, to this station's own {Math.round(tideFit.spanHours)} h barometric record
                  ({tideFit.sampleCount} readings), with a linear trend fitted jointly so synoptic
                  drift is not absorbed into the harmonic. S₂ peaks at{" "}
                  {number(tideFit.s2PhaseHours, 1)} h local solar time; residual RMS{" "}
                  {number(tideFit.rmseHpa, 2)} hPa.
                </p>
              </>
            ) : (
              <>
                <div className="chart-svg-container">
                  <div className="sparkline-empty" style={{ height: 130 }}>
                    <span className="empty-spark-label">
                      Not enough of this station's record to fit a 12-hour harmonic yet.
                    </span>
                  </div>
                </div>
                <p className="chart-footer-note">
                  A stable S₂ fit needs at least 24 hours of pressure readings. This page draws the
                  station's own measured tide, so with too little record it shows nothing rather
                  than a stand-in curve.
                </p>
              </>
            )}
          </section>
        )}

        {(mode === "actual" || mode === "combined") && (
          <section className="pane-card chart-pane">
            <div className="pane-header-simple">
              <div>
                <span className="card-tag">RAW TELEMETRY ENVELOPE</span>
                <h3>Surface Hydrostatic Pressure</h3>
              </div>
              {/* Was a hardcoded "QC Pass" pill shown whatever the readings
                  were. Checked against the detector's own gross limits. */}
              <span className={`status-pill ${pressureInGrossLimits ? "ok" : "warn"}`}>
                {pressureValues.length === 0
                  ? "No data"
                  : pressureInGrossLimits
                  ? "QC Pass"
                  : "Out of range"}
              </span>
            </div>
            <div className="chart-svg-container">
              {pressureValues.length ? (
                <Sparkline values={pressureValues.slice(-28)} tone="orange" height={130} showLabels={true} />
              ) : (
                <p className="state">No pressure telemetry available in current buffer.</p>
              )}
            </div>
            {/* The old note asserted readings "remain within standard
                operational bounds (980 - 1030 hPa)". That range is not the
                one this pipeline uses -- the detector's gross limit for
                pressure is 500-1100 hPa (GROSS_LIMITS in stream.py) -- and
                any station at altitude sits below 980 permanently, so the
                page was claiming a station was in bounds while showing a
                reading that wasn't. Dehradun at ~640 m reads about 928 hPa. */}
            <p className="chart-footer-note">
              {pressureValues.length ? (
                <>
                  Readings here span {number(Math.min(...pressureValues), 1)} to{" "}
                  {number(Math.max(...pressureValues), 1)} hPa, inside this pipeline's gross
                  physical limits for pressure ({PRESSURE_GROSS_MIN} - {PRESSURE_GROSS_MAX} hPa;
                  station pressure falls with altitude, so a hill station sits well below sea-level
                  values). A flat threshold like that passes a sensor whose tidal signature is
                  already decaying, which is what the harmonic check above is for.
                </>
              ) : (
                "No pressure readings in the current buffer to range-check."
              )}
            </p>
          </section>
        )}
      </div>

      {/* Evidence & Diagnostics Section */}
      {evidence.length > 0 && (
        <section className="pane-card diagnostic-pane">
          <div className="pane-header-simple">
            <div>
              {/* Was "HARMONIC EVIDENCE MARKERS / Extracted Spectral
                  Features". These are the detector's standardised residuals
                  and neighbour cross-checks across all three channels --
                  no spectral quantity (amplitude, phase, PSD) among them,
                  and not pressure-specific either. */}
              <span className="card-tag">DETECTOR EVIDENCE</span>
              <h3>Latest QC Markers For This Station</h3>
            </div>
          </div>
          <div className="evidence-chip-list">
            {evidence.map((pair) => {
              const [rawKey, rawVal] = pair;
              const formattedKey = rawKey.replace(/_/g, " ").toUpperCase();
              const hasVal = rawVal !== null && rawVal !== undefined && rawVal !== "";
              const valDisplay = hasVal
                ? (typeof rawVal === "number" ? rawVal.toFixed(3) : String(rawVal))
                : "Threshold Exceeded";
              return (
                <div key={`${rawKey}-${rawVal}`} className="evidence-chip-card">
                  <span className="chip-key">{formattedKey}</span>
                  <strong className="chip-val">{valDisplay}</strong>
                  <small className="chip-expl">{evidenceText(pair)}</small>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
