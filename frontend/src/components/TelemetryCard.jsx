import { number, percent } from "../services/api.js";
import Sparkline from "./Sparkline.jsx";

// How many of the most recent readings the sparkline plots. Was labeled
// "24h diurnal trace" on the assumption that 24 points always means 24
// hourly readings -- true back when every station ingested once an hour,
// false now that the live keepalive ticks a rotating focus set every 5
// minutes (see keepalive_service.py). 24 points at that cadence is closer
// to 2 hours, not a day, so the label was overclaiming a full diurnal
// cycle by roughly 12x for whichever station the keepalive happened to be
// actively feeding. Rather than guess a cadence (which can change again),
// the label below is computed from the ACTUAL timestamps of whichever
// points get plotted, so it stays true regardless of ingestion rate.
const TRACE_POINTS = 24;

function traceSpanLabel(timestamps) {
  if (!timestamps || timestamps.length < 2) return "Recent trace";
  const first = new Date(timestamps[0]).getTime();
  const last = new Date(timestamps[timestamps.length - 1]).getTime();
  if (Number.isNaN(first) || Number.isNaN(last) || last <= first) return "Recent trace";

  const hours = (last - first) / 3600000;
  if (hours < 1) return `Last ${Math.max(1, Math.round(hours * 60))}m trace`;
  if (hours < 48) return `Last ${hours < 10 ? hours.toFixed(1) : Math.round(hours)}h trace`;
  return `Last ${Math.round(hours / 24)}d trace`;
}

export default function TelemetryCard({ label, value, unit, status, values = [], timestamps = [], tone = "blue", emptyLabel }) {
  const formatted = value === null || value === undefined ? "-" : `${number(value, label === "Humidity" ? 0 : 1)}${unit}`;
  const slicedValues = values.slice(-TRACE_POINTS);
  const slicedTimestamps = timestamps.slice(-TRACE_POINTS);

  return (
    <article className="telemetry-card">
      <div className="telemetry-top">
        <span>{label}</span>
        <em>{status}</em>
      </div>
      <strong>{formatted}</strong>
      <small>{traceSpanLabel(slicedTimestamps)}</small>
      <Sparkline values={slicedValues} tone={tone === "blue" ? "orange" : tone} height={72} showLabels={true} emptyLabel={emptyLabel} />
    </article>
  );
}
