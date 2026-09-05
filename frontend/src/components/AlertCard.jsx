import { evidenceText, percent, severityLevel, timeAgo } from "../services/api.js";

function evidenceValue(alert, prefix, fallback = "-") {
  const pair = (alert.evidence || []).find(([key]) => String(key).startsWith(prefix));
  return pair ? pair[1] : fallback;
}

export default function AlertCard({ alert }) {
  const severity = severityLevel(alert.severity);
  const spatial = evidenceValue(alert, "spatial_z_");
  const drift = evidenceValue(alert, "cusum_");
  const heartbeat = evidenceValue(alert, "tide_loss");

  return (
    <article className={`alert-card ${severity}`}>
      <div className="alert-card-top">
        <span className="station-id">{alert.station_id}</span>
        <span className="risk-pill">{percent(alert.severity, 1)} risk</span>
      </div>
      <h3>{alert.message || "Anomaly detected"}</h3>
      <p>{percent(alert.confidence, 0)} calibrated confidence - {timeAgo(alert.created_at)}</p>
      <div className="diagnostic-grid">
        <span><strong>{spatial === "-" ? "-" : Number(spatial).toFixed(1)}</strong><small>Spatial dev.</small></span>
        <span><strong>{drift === "-" ? "-" : Number(drift).toFixed(1)}</strong><small>Drift</small></span>
        <span><strong>{heartbeat === "-" ? "-" : `${Math.round(Number(heartbeat) * -100)}%`}</strong><small>Heartbeat</small></span>
      </div>
      <ul>
        {(alert.evidence || []).slice(0, 3).map((pair) => (
          <li key={`${pair[0]}-${pair[1]}`}>{evidenceText(pair)}</li>
        ))}
      </ul>
    </article>
  );
}
