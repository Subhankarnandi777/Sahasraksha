import { number, percent } from "../services/api.js";
import Sparkline from "./Sparkline.jsx";

export default function TelemetryCard({ label, value, unit, status, values = [], tone = "blue" }) {
  const formatted = value === null || value === undefined ? "-" : `${number(value, label === "Humidity" ? 0 : 1)}${unit}`;

  return (
    <article className="telemetry-card">
      <div className="telemetry-top">
        <span>{label}</span>
        <em>{status}</em>
      </div>
      <strong>{formatted}</strong>
      <small>24h diurnal trace</small>
      <Sparkline values={values.slice(-24)} tone={tone} />
    </article>
  );
}
