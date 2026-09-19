import { useEffect, useMemo, useState } from "react";
import FilterTabs from "../components/FilterTabs.jsx";
import MapPanel from "../components/MapPanel.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import TelemetryCard from "../components/TelemetryCard.jsx";
import { number, percent, channelStatus, getStationTimeseries, getStationVerdicts } from "../services/api.js";

export default function Network({ stations, selectedStation, selectedStationId, timeseries, verdicts, openAlerts, loading, error }) {
  const [mode, setMode] = useState("health");
  const [focusedId, setFocusedId] = useState(null);
  const [focusedTimeseries, setFocusedTimeseries] = useState(null);
  const [focusedVerdicts, setFocusedVerdicts] = useState(null);
  const [focusedLoading, setFocusedLoading] = useState(false);

  const mapStations = useMemo(() => stations.filter((station) => Number.isFinite(Number(station.lat)) && Number.isFinite(Number(station.lon))), [stations]);

  useEffect(() => {
    if (!focusedId) return;
    let cancelled = false;
    setFocusedLoading(true);
    Promise.all([
      getStationTimeseries(focusedId).catch(() => []),
      getStationVerdicts(focusedId).catch(() => [])
    ]).then(([ts, vd]) => {
      if (cancelled) return;
      setFocusedTimeseries(ts);
      setFocusedVerdicts(vd);
      setFocusedLoading(false);
    });
    return () => { cancelled = true; };
  }, [focusedId]);

  const selected = (focusedId && stations.find((s) => s.station_id === focusedId))
    || selectedStation || stations[0];
  const activeTimeseries = focusedId ? (focusedTimeseries || []) : timeseries;
  const activeVerdicts = focusedId ? (focusedVerdicts || []) : verdicts;
  const latest = activeTimeseries[activeTimeseries.length - 1] || {};
  const latestVerdict = activeVerdicts[activeVerdicts.length - 1];

  return (
    <main className="screen network-screen">
      {/* Page Header */}
      <div className="page-header-strip">
        <div>
          <span className="section-eyebrow">GEOSPATIAL FLEET SURVEILLANCE</span>
          <h1 className="page-main-heading">Station Network Map</h1>
          <p className="page-sub-heading">
            {loading ? "Loading station telemetry..." : `${stations.length} Synoptic AWS Nodes Active across Indian Subcontinent`}
          </p>
        </div>
        <div className="map-layer-controls">
          <FilterTabs
            value={mode}
            onChange={setMode}
            tabs={[
              { value: "health", label: "Health Status" },
              { value: "temperature", label: "Temperature" },
              { value: "pressure", label: "Barometric" },
              { value: "reporting", label: "Signal Quality" }
            ]}
          />
        </div>
      </div>

      {error ? <p className="state error">{error}</p> : null}

      {/* Split Map & Telemetry Inspector Layout */}
      <div className="network-split-layout">
        {/* Map Container */}
        <div className="network-map-card">
          <MapPanel
            stations={mapStations}
            selectedId={focusedId || selectedStationId}
            mode={mode}
            onSelect={setFocusedId}
          />
        </div>

        {/* Selected Station Telemetry Sidebar */}
        <div className="network-telemetry-sidebar">
          {selected ? (
            <section className="station-focus-card">
              <div className="focus-header">
                <div>
                  <span className="focus-eyebrow">SELECTED STATION</span>
                  <h2 className="focus-title">{selected.name}</h2>
                  <span className="focus-id-tag">{selected.station_id}</span>
                </div>
                <StatusBadge status={selected.status}>
                  {selected.status} • {percent(selected.health, 1)}
                </StatusBadge>
              </div>

              <div className="focus-coords">
                <span>📍 Lat: {number(selected.lat, 3)}°N</span>
                <span>Lon: {number(selected.lon, 3)}°E</span>
                {focusedLoading && <span className="focus-loading-tag">Updating...</span>}
              </div>

              <div className="focus-telemetry-grid">
                <TelemetryCard
                  label="Temperature"
                  value={latest.T}
                  unit="°C"
                  status={channelStatus(latestVerdict, "T", "Normal")}
                  values={activeTimeseries.map((row) => row.T)}
                />
                <TelemetryCard
                  label="Surface Pressure"
                  value={latest.P}
                  unit=" hPa"
                  status={latestVerdict?.degradation ? `Harmonic Loss ${percent(latestVerdict.degradation, 0)}` : "Stable"}
                  values={activeTimeseries.map((row) => row.P)}
                  tone="amber"
                />
                <TelemetryCard
                  label="Relative Humidity"
                  value={latest.RH}
                  unit="%"
                  status={channelStatus(latestVerdict, "RH", "Nominal")}
                  values={activeTimeseries.map((row) => row.RH)}
                  tone="blue"
                />
              </div>

              <div className="focus-actions">
                <a
                  className="btn-deep-dive"
                  href={`/stations/${encodeURIComponent(selected.station_id)}`}
                >
                  Inspect Full Telemetry & AI Verdict →
                </a>
                <a
                  className="btn-heartbeat"
                  href={`/stations/${encodeURIComponent(selected.station_id)}/pressure`}
                >
                  S2 Harmonic Tide Curve →
                </a>
              </div>
            </section>
          ) : (
            <div className="empty-focus-card">
              <p>Click any station pin on the map to inspect its real-time telemetry stream.</p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}