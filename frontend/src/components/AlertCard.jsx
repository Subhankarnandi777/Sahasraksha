import { anomalyActionText, anomalyReasonText, estimateFor, evidenceText, number, percent, severityLevel, stationDegradation, timeAgo } from "../services/api.js";

const UNITS = { T: "°C", P: "hPa", RH: "%" };

// The verdict's evidence list is the detector's top-3 items (truncated in
// stream.py) plus the spatial cross-check. cusum_* and tide_loss almost
// never survive that cut, so scraping evidence for them left the "Drift"
// and "Heartbeat" tiles reading "-" on every alert the network has ever
// raised. The tidal-loss tile now reads the station's recorded degradation
// (see below); there is no equivalent field for CUSUM, so the tile that
// could never be filled is gone rather than sitting there permanently
// blank.
// The channel the fault is actually on, from the gate evidence that fired
// (step_P, runlen_T, range_RH, cusum_P). Null for a purely z-driven flag.
function faultChannel(alert) {
  for (const pair of alert.evidence || []) {
    const key = String(pair?.[0] || "");
    const match = key.match(/^(?:step|runlen|range|cusum)_(T|P|RH)$/);
    if (match) return match[1];
    if (key === "t_record" || key === "dewpoint_ceiling") return "T";
  }
  return null;
}

// The neighbour cross-check for the channel that faulted. This used to take
// whichever spatial_z_* came first in the list, and the detector appends
// them T, P, RH -- so a pressure step at Tiruchirappalli showed the
// temperature neighbour comparison, labelled "T vs neighbours", on a card
// about pressure.
function spatialEvidence(alert) {
  const spatial = (alert.evidence || []).filter(([key]) => String(key).startsWith("spatial_z_"));
  if (!spatial.length) return null;
  const channel = faultChannel(alert);
  if (channel) {
    // No neighbour reading for the faulted channel: say so for that
    // channel rather than substituting a different channel's comparison.
    const own = spatial.find(([key]) => key === `spatial_z_${channel}`);
    return { channel, value: own ? Number(own[1]) : null };
  }
  const pair = spatial.reduce((best, item) =>
    Math.abs(Number(item[1])) > Math.abs(Number(best[1])) ? item : best
  );
  return { channel: String(pair[0]).replace("spatial_z_", ""), value: Number(pair[1]) };
}

export default function AlertCard({ alert, station }) {
  const severity = severityLevel(alert.severity);
  const spatial = spatialEvidence(alert);

  // The station's recorded tidal degradation -- the figure its detail page,
  // S2 page and the dashboard watchlist all show. alert.degradation is only
  // the value on the one reading that raised the alert, so Sagar's card
  // read 0% while every other page said 69%. Falls back to the alert's own
  // value when the station summary isn't available; a low-confidence
  // station has none (stationDegradation returns null) and shows "-".
  const alertDegradation =
    alert.degradation === null || alert.degradation === undefined || alert.degradation === ""
      ? null
      : Number(alert.degradation);
  const heartbeatLoss = station
    ? stationDegradation(station)
    : Number.isFinite(alertDegradation)
    ? alertDegradation
    : null;

  // `alert.message` is the bare detector reason, so an alert that arrived
  // without narration text rendered the single word "step" as its headline
  // diagnosis. Same mapping the station cards and the detail page use.
  const headline =
    alert.explanation ||
    (alert.message ? anomalyReasonText(alert.message) : null) ||
    "Anomaly detected";

  // confidence now comes from stream.py: 1.0 when a deterministic physics or
  // missing-data rule decided, otherwise how far the deciding statistic
  // cleared its threshold (0.5 = on the line). It is NOT a calibrated
  // probability, so it is not labelled as one. Shown only when it carries
  // something the risk figure does not.
  const riskPct = Math.round(Number(alert.severity || 0) * 100);
  const confidencePct = Math.round(Number(alert.confidence || 0) * 100);
  const confidenceAddsInfo = confidencePct !== riskPct;
  const estimate = estimateFor(alert.evidence, faultChannel(alert)) || estimateFor(alert.evidence);
  const action = anomalyActionText(alert.message);

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
          <strong>{spatial && Number.isFinite(spatial.value) ? (Math.abs(spatial.value) < 0.05 ? "0.0" : spatial.value.toFixed(1)) : "-"}</strong>
          <small>{spatial ? `${spatial.channel} vs neighbours` : "No neighbour data"}</small>
        </span>
        <span>
          <strong>{heartbeatLoss === null ? "-" : `${Math.round(heartbeatLoss * 100)}%`}</strong>
          <small>Tidal loss (recorded)</small>
        </span>
        {estimate ? (
          <span>
            <strong>
              {number(estimate.value, 1)}
              {estimate.band !== null ? ` ± ${number(estimate.band, 1)}` : ""} {UNITS[estimate.channel]}
            </strong>
            <small title="Own baseline plus what the neighbours read at the same hour. Shown as a labelled estimate; the reported value is kept in the record.">
              {estimate.channel} best estimate
            </small>
          </span>
        ) : null}
      </div>
      {action ? <p className="alert-action"><b>Action:</b> {action}</p> : null}
      <ul>
        {(alert.evidence || []).slice(0, 3).map((pair) => (
          <li key={`${pair[0]}-${pair[1]}`}>{evidenceText(pair)}</li>
        ))}
      </ul>
    </article>
  );
}
