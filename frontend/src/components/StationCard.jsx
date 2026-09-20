import { daysToThreshold, number, percent, statusTone, timeAgo } from "../services/api.js";
import { getStationImage } from "../services/stationImages.js";
import StatusBadge from "./StatusBadge.jsx";

export default function StationCard({ station, alert, onOpen }) {
  const tone = statusTone(station.status);
  const days = daysToThreshold(station.days_to_threshold);
  const anomaly = alert?.message || (station.status === "OK" ? "Nominal physical bounds" : "Requires attention");
  const photo = getStationImage(station.name);
  const healthVal = station.health === null || station.health === undefined ? null : Number(station.health);

  return (
    <article className={`station-card ${tone}`} onClick={() => onOpen(station.station_id)}>
      <div className="station-card-inner">
        {/* Left Side: Station Telemetry & Diagnostics */}
        <div className="station-card-content">
          <div className="station-card-header">
            <span className="station-id">{station.station_id}</span>
            <StatusBadge status={station.status}>{station.status}</StatusBadge>
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
            <span className="service-text">
              {days === "-" ? "No maintenance due" : `~${days}d to service window`}
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
