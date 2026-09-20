import StatusBadge from "../components/StatusBadge.jsx";
import TelemetryCard from "../components/TelemetryCard.jsx";
import { channelStatus, daysToThreshold, percent, timeAgo, number } from "../services/api.js";

export default function StationDetail({ selectedStation, timeseries, verdicts, openAlerts, loading, error }) {
  const station = selectedStation;
  const latest = timeseries[timeseries.length - 1] || {};
  const latestVerdict = verdicts[verdicts.length - 1];

  if (!station && !loading) {
    return (
      <main className="screen station-detail-screen">
        <div className="breadcrumb-row">
          <a href="/stations" className="back-link">← Return to Station Fleet</a>
        </div>
        <div className="empty-state-card">
          <span className="empty-icon">⚠️</span>
          <h2>Station Not Found</h2>
          <p>The requested station code could not be resolved in the synoptic database.</p>
          <a href="/stations" className="btn-reset-filters">View All Stations</a>
        </div>
      </main>
    );
  }

  return (
    <main className="screen station-detail-screen">
      {/* Breadcrumb Navigation */}
      <div className="breadcrumb-row">
        <a href="/stations" className="back-link">
          ← Back to Station Fleet
        </a>
        <span className="breadcrumb-separator">/</span>
        <span className="breadcrumb-current">{station?.name || "Station Telemetry"}</span>
      </div>

      {error ? <p className="state error">{error}</p> : null}

      {station ? (
        <>
          {/* Station Overview Hero Banner */}
          <section className="station-hero-card">
            <div className="hero-main-details">
              <div className="hero-id-row">
                <span className="station-code-badge">{station.station_id}</span>
                <StatusBadge status={station.status}>
                  {station.status} • {percent(station.health, 1)} Health
                </StatusBadge>
              </div>
              <h1 className="hero-station-name">{station.name}</h1>
              <p className="hero-station-coords">
                📍 Coordinates: {number(station.lat, 4)}°N, {number(station.lon, 4)}°E • Last Seen: {timeAgo(station.last_seen)}
              </p>
            </div>

            <div className="hero-health-meter">
              <div className="health-score-cluster">
                <span className="score-value">{percent(station.health, 1)}</span>
                <span className="score-label">Station Health Score</span>
              </div>
              <div className="health-service-estimate">
                <span>Estimated Service Window:</span>
                <b>{daysToThreshold(station.days_to_threshold)} days</b>
              </div>
            </div>
          </section>

          {/* Real-time Telemetry Sensor Cards */}
          <div className="detail-section-title">
            <h2>Real-Time Meteorological Channels</h2>
            <span>Synchronized with INSAT-3DR Atmospheric Stream</span>
          </div>

          <div className="telemetry-three-grid">
            <TelemetryCard
              label="Atmospheric Temperature"
              value={latest.T}
              unit="°C"
              status={channelStatus(latestVerdict, "T", "Normal")}
              values={timeseries.map((row) => row.T)}
            />
            <TelemetryCard
              label="Barometric Pressure"
              value={latest.P}
              unit=" hPa"
              status={latestVerdict?.degradation ? `Harmonic Loss ${percent(latestVerdict.degradation, 0)}` : "Stable"}
              values={timeseries.map((row) => row.P)}
              tone="amber"
            />
            <TelemetryCard
              label="Relative Humidity"
              value={latest.RH}
              unit="%"
              status={channelStatus(latestVerdict, "RH", "Nominal")}
              values={timeseries.map((row) => row.RH)}
              tone="blue"
            />
          </div>

          {/* AI Explainability Verdict & Innovation Link */}
          <section className="verdict-explain-card">
            <div className="verdict-header">
              <div>
                <span className="card-tag">EXPLAINABLE ML VERDICT</span>
                <h2>Conformal Anomaly Diagnostics</h2>
              </div>
              {latestVerdict && (
                <div className="verdict-metrics-pill">
                  <span>Confidence: <b>{percent(latestVerdict.confidence, 0)}</b></span>
                  <span>Severity: <b>{percent(latestVerdict.severity, 0)}</b></span>
                </div>
              )}
            </div>

            {latestVerdict ? (
              <div className="verdict-body">
                <div className="verdict-status-banner">
                  <span className="verdict-icon">⚠️</span>
                  <p className="verdict-text">
                    {(() => {
                      const r = String(latestVerdict.reason || "").trim().toLowerCase();
                      if (r === "step") return "Abrupt step displacement detected across telemetry channels.";
                      if (r === "drift" || r === "cusum") return "Continuous cumulative sum (CUSUM) calibration drift detected.";
                      if (r === "tide_loss") return "Significant S₂ harmonic tidal resonance loss: diaphragm fatigue or port obstruction.";
                      if (r === "flatline" || r === "frozen") return "Persistent static sensor reading (flatline) detected.";
                      if (r === "spike" || r === "noise") return "High-frequency non-physical impulse spikes detected.";
                      return latestVerdict.reason || "Autonomous QC anomaly flag active.";
                    })()}
                  </p>
                </div>
                {latestVerdict.evidence && latestVerdict.evidence.length > 0 && (
                  <div className="verdict-evidence-strip">
                    <span className="evidence-title">Physics Evidence Markers:</span>
                    <div className="evidence-pills">
                      {latestVerdict.evidence.map(([k, v]) => {
                        const valDisplay = v !== null && v !== undefined && v !== ""
                          ? (typeof v === "number" ? v.toFixed(2) : String(v))
                          : "Detected";
                        return (
                          <span key={k} className="evidence-pill">
                            <b>{k}:</b> {valDisplay}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="state">Telemetry channels currently operating within nominal bounds.</p>
            )}

            <div className="verdict-footer-actions">
              <a
                className="btn-open-heartbeat"
                href={`/stations/${encodeURIComponent(station.station_id)}/pressure`}
              >
                🔬 Inspect S2 Harmonic Solar Atmospheric Tide →
              </a>
            </div>
          </section>
        </>
      ) : (
        <div className="loading-state-card">
          <div className="loading-spinner" />
          <p>Retrieving synoptic telemetry stream...</p>
        </div>
      )}
    </main>
  );
}
