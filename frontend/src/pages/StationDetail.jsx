import StatusBadge from "../components/StatusBadge.jsx";
import TelemetryCard from "../components/TelemetryCard.jsx";

// The detector's own threshold for treating tidal amplitude decay as
// actionable -- StreamingSahasraksha(deg_cut=0.45) in stream.py, which is
// also the only point at which it emits tide_loss evidence at all.
const TIDE_DEGRADATION_CUT = 0.45;
import { channelStatus, daysToThreshold, effectiveStatus, evidenceText, networkReferenceTime, percent, timeAgo, number } from "../services/api.js";

export default function StationDetail({ selectedStation, stations = [], timeseries, verdicts, openAlerts, loading, error }) {
  const station = selectedStation;
  const latest = timeseries[timeseries.length - 1] || {};
  const latestVerdict = verdicts[verdicts.length - 1];
  // Same fleet-wide reference time every other page uses, so a station
  // that's gone quiet doesn't get to look "OK" here while Fleet Map and
  // the Stations list both already call it MONITOR.
  const referenceTime = networkReferenceTime(stations);
  const status = station ? effectiveStatus(station, referenceTime) : null;

  // A verdict exists for every reading; only a flagged one is an anomaly.
  const verdictIsAnomalous = Boolean(
    latestVerdict &&
      Number(latestVerdict.flag || 0) === 1 &&
      String(latestVerdict.reason || "").trim().toLowerCase() !== "ok"
  );

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
                <StatusBadge status={status}>
                  {status} • {percent(station.health, 1)} Health
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
              {/* Rendered as a bare "- days" when there was no estimate.
                  StationCard already words this case properly. */}
              <div className="health-service-estimate">
                {daysToThreshold(station.days_to_threshold) === "-" ? (
                  <span>No maintenance currently projected</span>
                ) : (
                  <>
                    <span>Estimated Service Window:</span>
                    <b>{daysToThreshold(station.days_to_threshold)} days</b>
                  </>
                )}
              </div>
            </div>
          </section>

          {/* Real-time Telemetry Sensor Cards */}
          <div className="detail-section-title">
            <h2>Real-Time Meteorological Channels</h2>
            <span>Live Automatic Weather Station Telemetry Channel</span>
          </div>

          <div className="telemetry-three-grid">
            <TelemetryCard
              label="Atmospheric Temperature"
              value={latest.T}
              unit="°C"
              status={channelStatus(latestVerdict, "T", "Normal")}
              values={timeseries.map((row) => row.T)}
              timestamps={timeseries.map((row) => row.timestamp)}
            />
            <TelemetryCard
              label="Barometric Pressure"
              value={latest.P}
              unit=" hPa"
              // Any non-zero degradation used to print "Harmonic Loss X%",
              // so a routine 7% reading on an unflagged station announced a
              // failing diaphragm. The detector only treats tidal decay as
              // actionable past its own deg_cut, and only emits tide_loss
              // evidence then; below that this falls through to the same
              // per-channel check the other two cards use.
              status={
                Number(latestVerdict?.degradation || 0) > TIDE_DEGRADATION_CUT
                  ? `Harmonic Loss ${percent(latestVerdict.degradation, 0)}`
                  : channelStatus(latestVerdict, "P", "Normal")
              }
              values={timeseries.map((row) => row.P)}
              timestamps={timeseries.map((row) => row.timestamp)}
              tone="amber"
            />
            <TelemetryCard
              label="Relative Humidity"
              value={latest.RH}
              unit="%"
              // Was "Nominal" here and "Stable" on pressure while temperature
              // said "Normal" -- three words for one state, side by side.
              status={channelStatus(latestVerdict, "RH", "Normal")}
              values={timeseries.map((row) => row.RH)}
              timestamps={timeseries.map((row) => row.timestamp)}
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
              {/* Severity/confidence describe an anomaly, so they only
                  belong here when one was actually raised. */}
              {verdictIsAnomalous && (
                <div className="verdict-metrics-pill">
                  <span>Confidence: <b>{percent(latestVerdict.confidence, 0)}</b></span>
                  <span>Severity: <b>{percent(latestVerdict.severity, 0)}</b></span>
                </div>
              )}
            </div>

            {/* The detector writes a verdict for EVERY reading, including
                reason "ok" with flag 0, and this page reads the latest one.
                Nothing here checked flag, so a nominal reading rendered as a
                warning banner whose text fell through to printing the raw
                reason string -- the live site showed a warning triangle
                followed by the word "ok" under "Conformal Anomaly
                Diagnostics". Same root cause as the channel cards. */}
            {verdictIsAnomalous ? (
              <div className="verdict-body">
                <div className="verdict-status-banner">
                  <span className="verdict-icon">⚠️</span>
                  <p className="verdict-text">
                    {(() => {
                      const r = String(latestVerdict.reason || "").trim().toLowerCase();
                      if (r === "step") return "Abrupt step displacement detected across telemetry channels.";
                      if (r === "drift" || r === "cusum") return "Continuous cumulative sum (CUSUM) calibration drift detected.";
                      if (r === "tide_loss" || r === "degrading") return "Significant S₂ harmonic tidal resonance loss: diaphragm fatigue or port obstruction.";
                      if (r === "range") return "Reading outside gross physical limits for this channel.";
                      if (r === "impossible") return "Physically impossible combination: dewpoint above air temperature.";
                      if (r === "missing") return "Expected telemetry channel absent from this reading.";
                      if (r === "flatline" || r === "frozen") return "Persistent static sensor reading (flatline) detected.";
                      if (r === "spike" || r === "noise") return "High-frequency non-physical impulse spikes detected.";
                      // Never print the bare enum value -- that is how the
                      // word "ok" ended up rendered as a diagnosis.
                      return "Autonomous QC anomaly flag active.";
                    })()}
                  </p>
                </div>
                {latestVerdict.evidence && latestVerdict.evidence.length > 0 && (
                  <div className="verdict-evidence-strip">
                    <span className="evidence-title">Physics Evidence Markers:</span>
                    <div className="evidence-pills">
                      {/* Was printing raw keys and values ("z_RH: 2.28").
                          evidenceText already renders these in words, and
                          the pressure page has used it all along. */}
                      {latestVerdict.evidence.map((pair) => (
                        <span key={pair[0]} className="evidence-pill">
                          {evidenceText(pair)}
                        </span>
                      ))}
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
