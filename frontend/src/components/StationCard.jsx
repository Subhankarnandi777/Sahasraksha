import { daysToThreshold, percent, statusTone, timeAgo } from "../services/api.js";
import StatusBadge from "./StatusBadge.jsx";

export default function StationCard({ station, alert, onOpen }) {
  const tone = statusTone(station.status);
  const days = daysToThreshold(station.days_to_threshold);
  const anomaly = alert?.message || (station.status === "OK" ? "No active anomaly" : "Station requires monitoring");

  return (
    <article className={`station-card ${tone}`}>
      <button type="button" onClick={() => onOpen(station.station_id)} aria-label={`Open ${station.station_id}`}>
        <span className="station-id">{station.station_id}</span>
        <strong>{station.name}</strong>
        <span className="station-health">{percent(station.health, 1)}</span>
        <span className="station-meta">Last seen: {timeAgo(station.last_seen)}</span>
        <span className="station-service">{days === "-" ? "No service date" : `${days} days to service`}</span>
        <StatusBadge status={station.status}>{station.status}</StatusBadge>
        <span className="station-anomaly">{anomaly}</span>
      </button>
    </article>
  );
}
