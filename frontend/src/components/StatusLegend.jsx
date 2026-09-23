// One legend for both maps. The Dashboard and Fleet Map each carried their
// own copy, and both described the statuses wrongly: "OK" was explained as
// "Health >= 90%", but station_service._status_from_verdict never looks at
// a health threshold for OK -- Ganganagar, Satna, Gorakhpur and Varanasi
// were all OK at 88-90% health on the live network. These descriptions
// follow the backend's actual rules.
const ITEMS = [
  {
    dot: "ok",
    name: "Nominal (OK)",
    title: "Latest reading raised no flag, and recorded tidal degradation is below 45%"
  },
  {
    dot: "schedule",
    name: "Schedule",
    title: "Latest reading flagged while recorded tidal degradation is 20-45%: plan a calibration visit"
  },
  {
    dot: "monitor",
    name: "Monitor",
    title: "Latest reading flagged at under 80% severity, or the station has gone silent 6h+"
  },
  {
    dot: "service-now",
    name: "Service Now",
    title: "Anomaly severity of 80% or more, or recorded tidal degradation of 45% or more"
  },
  {
    dot: "low-confidence",
    name: "Low Confidence",
    title: "The station's archived record was flagged as unreliable, so its health and readings are withheld"
  }
];

export default function StatusLegend({ className = "" }) {
  return (
    <div className={`map-legend-bar ${className}`.trim()}>
      <span className="legend-title">Station Points Status:</span>
      <div className="legend-items">
        {ITEMS.map((item) => (
          <span key={item.dot} className="legend-badge" title={item.title}>
            <span className={`legend-dot ${item.dot}`} />
            <span className="legend-name">{item.name}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
