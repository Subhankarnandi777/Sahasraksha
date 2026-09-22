import { anomalyReasonText, evidenceText, percent, severityLevel, timeAgo } from "../services/api.js";

// The verdict's evidence list is the detector's top-3 items (truncated in
// stream.py) plus the spatial cross-check. cusum_* and tide_loss almost
// never survive that cut, so scraping evidence for them left the "Drift"
// and "Heartbeat" tiles reading "-" on every alert the network has ever
// raised. degradation is a real top-level field on the alert, so the
// heartbeat figure is read from there instead; there is no equivalent
// field for CUSUM, so the tile that could never be filled is gone rather
// than sitting there permanently blank.
function spatialEvidence(alert) {
  const pair = (alert.evidence || []).find(([key]) => String(key).startsWith("spatial_z_"));
  if (!pair) return null;
  return { channel: String(pair[0]).replace("spatial_z_", ""), value: Number(pair[1]) };
}

export default function AlertCard({ alert }) {
  const severity = severityLevel(alert.severity);
  const spatial = spatialEvidence(alert);

  const degradation =
    alert.degradation === null || alert.degradation === undefined || alert.degradation === ""
      ? null
      : Number(alert.degradation);
  const heartbeatLoss = Number.isFinite(degradation) ? degradation : null;

  // `alert.message` is the bare detector reason, so an alert that arrived
  // without narration text rendered the single word "step" as its headline
  // diagnosis. Same mapping the station cards and the detail page use.
  const headline =
    alert.explanation ||
    (alert.message ? anomalyReasonText(alert.message) : null) ||
    "Anomaly detected";

  // confidence is max(severity, degradation, 0.6) in anomaly_detector.py --
  // the backend's own docstring calls it "a heuristic floor, not a
  // calibrated probability", and the conformal machinery in
  // ml/sahasraksha/gapfill.py is not wired into this path at all. Calling
  // it "calibrated confidence" claimed a guarantee nothing here provides.
  // It is also derived from severity, so it matched the risk pill exactly
  // on all seven live alerts -- one number wearing two labels. Shown only
  // when it actually carries something the risk figure does not.
  const riskPct = Math.round(Number(alert.severity || 0) * 100);
  const confidencePct = Math.round(Number(alert.confidence || 0) * 100);
  const confidenceAddsInfo = confidencePct !== riskPct;

  return (
    <article className={`alert-card ${severity}`}>
      <div className="alert-card-top">
        <span className="station-id">{alert.station_id}</span>
        <span className="risk-pill">{percent(alert.severity, 1)} risk</span>
      </div>
      <h3>{headline}</h3>
      <p>
        {confidenceAddsInfo ? `${percent(alert.confidence, 0)} detector confidence - ` : ""}
        {timeAgo(alert.created_at)}
      </p>
      <div className="diagnostic-grid">
        <span>
          <strong>{spatial && Number.isFinite(spatial.value) ? spatial.value.toFixed(1) : "-"}</strong>
          <small>{spatial ? `${spatial.channel} vs neighbours` : "No neighbour data"}</small>
        </span>
        <span>
          <strong>{heartbeatLoss === null ? "-" : `${Math.round(heartbeatLoss * 100)}%`}</strong>
          <small>Heartbeat loss</small>
        </span>
      </div>
      <ul>
        {(alert.evidence || []).slice(0, 3).map((pair) => (
          <li key={`${pair[0]}-${pair[1]}`}>{evidenceText(pair)}</li>
        ))}
      </ul>
    </article>
  );
}
