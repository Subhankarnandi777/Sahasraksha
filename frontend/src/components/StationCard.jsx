import { anomalyReasonText, daysToThreshold, effectiveStatus, number, percent, statusTone, timeAgo } from "../services/api.js";
import { getStationImage } from "../services/stationImages.js";
import StatusBadge from "./StatusBadge.jsx";

// Was reading station.status directly -- a station that stopped reporting
// hours ago keeps whatever status it last earned ("OK" included), so this
// card could show a healthy badge for a station the Fleet Map already
// marks MONITOR for going silent. Routes through the same effectiveStatus
// helper every other status display in the app uses.
export default function StationCard({ station, alert, onOpen, referenceTime }) {
  const status = effectiveStatus(station, referenceTime);
  const tone = statusTone(status);
  const days = daysToThreshold(station.days_to_threshold);
  const lowConfidence = station.data_quality === "low_confidence";
  const needsService = status === "SERVICE NOW" || status === "SCHEDULE";
  // `alert.message` is the bare detector reason, so this used to print the
  // single word "step" on Sagar's card whenever an alert carried no
  // explanation text. And a station the pipeline does not trust cannot
  // claim "Nominal physical bounds" -- it has no readings to be nominal.
  const anomaly = lowConfidence
    ? "Data quality too low to assess this station."
    : alert?.explanation ||
      (alert?.message ? anomalyReasonText(alert.message) : null) ||
      (status === "OK" ? "Nominal physical bounds" : "Requires attention");
  const photo = getStationImage(station.name);
  const healthVal = station.health === null || station.health === undefined ? null : Number(station.health);

  return (
    <article className={`station-card ${tone}`} onClick={() => onOpen(station.station_id)}>
      <div className="station-card-inner">
        {/* Left Side: Station Telemetry & Diagnostics */}
        <div className="station-card-content">
          <div className="station-card-header">
            <span className="station-id">{station.station_id}</span>
            <StatusBadge status={status}>{status}</StatusBadge>
          </div>

          <h3 className="station-name-title">{station.name}</h3>

          {/* Real-time Telemetry Mini Grid */}
          <div className="station-telemetry-strip">
            <div className="st-metric-pill" title="Current Temperature">
              <span className="metric-icon">🌡️</span>
              <span className="metric-val">
                {station.latest_temperature !== null && station.latest_temperature !== undefined
                  ? `${number(station.latest_temperature, 1)}°C`
                  : "--"}
              </span>
            </div>
            <div className="st-metric-pill" title="Surface Barometric Pressure">
              <span className="metric-icon">⏱️</span>
              <span className="metric-val">
                {station.latest_pressure !== null && station.latest_pressure !== undefined
                  ? `${number(station.latest_pressure, 0)} hPa`
                  : "--"}
              </span>
            </div>
            <div className="st-metric-pill" title="Relative Humidity">
              <span className="metric-icon">💧</span>
              <span className="metric-val">
                {station.latest_humidity !== null && station.latest_humidity !== undefined
                  ? `${number(station.latest_humidity, 0)}%`
                  : "--"}
              </span>
            </div>
          </div>

          {/* Health Score & Anomaly Status */}
          <div className="station-health-row">
            <div className="health-score-pill">
              <span className="health-dot" />
              <span>Health: <b>{healthVal === null ? "--" : percent(healthVal, 1)}</b></span>
            </div>
            <span className="station-seen-meta">{timeAgo(station.last_seen)}</span>
          </div>

          <div className="station-anomaly-pill" title={anomaly}>
            <span className="anomaly-dot" />
            <span className="anomaly-text">{anomaly}</span>
          </div>

          <div className="station-card-footer">
            {/* "No maintenance due" on a SERVICE NOW station at 2.9% health
                read as reassurance. No projection exists there because the
                threshold has already been crossed. Matches the wording the
                detail page uses for the same case. */}
            <span className="service-text">
              {days !== "-"
                ? `~${days}d to service window`
                : needsService
                ? "Service required now"
                : "No maintenance due"}
            </span>
            <span className="card-cta-link">Inspect Telemetry →</span>
          </div>
        </div>

        {/* Right Side: High-Resolution Scenic Area Photography */}
        <div className="station-card-photo-pane">
          <img
            src={photo.url}
            alt={photo.landmark}
            className="station-photo-img"
            loading="lazy"
            onError={(e) => {
              e.currentTarget.onerror = null;
              e.currentTarget.src = "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=600&q=80";
            }}
          />
          <div className="photo-overlay-scrim" />
          <div className="photo-caption-badge">
            <span className="photo-pin">📍</span>
            <span className="photo-landmark-text">{photo.landmark}</span>
          </div>
        </div>
      </div>
    </article>
  );
}
