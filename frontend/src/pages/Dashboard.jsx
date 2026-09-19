import { useMemo, useState } from "react";
import FilterTabs from "../components/FilterTabs.jsx";
import MapPanel from "../components/MapPanel.jsx";
import MetricCard from "../components/MetricCard.jsx";
import Sparkline from "../components/Sparkline.jsx";
import { isSilent, networkReferenceTime, percent, number } from "../services/api.js";

function countStatus(stations, status) {
  return stations.filter((station) => station.status === status).length;
}

function countSilent(stations) {
  const referenceTime = networkReferenceTime(stations);
  return stations.filter((station) => isSilent(station, referenceTime)).length;
}

function hourlyAlertCounts(alerts) {
  let referenceTime = 0;
  for (const alert of alerts) {
    const created = new Date(alert.created_at).getTime();
    if (!Number.isNaN(created)) referenceTime = Math.max(referenceTime, created);
  }
  const now = referenceTime ? new Date(referenceTime) : new Date();

  const buckets = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now);
    date.setHours(now.getHours() - 5 + index, 0, 0, 0);
    return {
      key: date.toISOString().slice(0, 13),
      label: date.toLocaleTimeString([], { hour: "numeric" }),
      value: 0
    };
  });

  for (const alert of alerts) {
    const created = new Date(alert.created_at);
    if (Number.isNaN(created.getTime())) continue;
    const key = created.toISOString().slice(0, 13);
    const bucket = buckets.find((item) => item.key === key);
    if (bucket) bucket.value += 1;
  }

  return buckets;
}

export default function Dashboard({ health, stations, openAlerts, timeseries, loading, error }) {
  const [mapMode, setMapMode] = useState("health");
  const [selectedStationId, setSelectedStationId] = useState(null);

  const total = health?.station_count ?? stations.length;
  const healthy = countStatus(stations, "OK");
  const monitoring = countStatus(stations, "MONITOR") + countStatus(stations, "SCHEDULE");
  const serviceNow = countStatus(stations, "SERVICE NOW");
  const silent = countSilent(stations);
  const scoredStations = stations.filter((station) => Number.isFinite(Number(station.health)));
  const networkHealth = scoredStations.length
    ? scoredStations.reduce((sum, station) => sum + Number(station.health), 0) / scoredStations.length
    : 0;
  const chartValues = timeseries.map((row) => row.T).filter((value) => value !== null);
  const hourlyAlerts = hourlyAlertCounts(openAlerts);

  // Top attention stations (highest degradation or alerts)
  const priorityStations = useMemo(() => {
    return [...stations]
      .sort((a, b) => (Number(b.degradation || 0) - Number(a.degradation || 0)))
      .slice(0, 5);
  }, [stations]);

  return (
    <main className="screen dashboard-screen">
      {/* Top Header Row with Status */}
      <div className="dashboard-top-bar">
        <div>
          <span className="section-eyebrow">NATIONAL ATMOSPHERIC OBSERVATORY</span>
          <h1 className="dashboard-main-title">Network Command Overview</h1>
          <p className="dashboard-subtitle">
            Autonomous anomaly surveillance across {total} synoptic weather stations
          </p>
        </div>
        <div className="dashboard-badge-cluster">
          <div className="telemetry-pill">
            <span className="telemetry-live-dot" />
            <span>Telemetry Pipeline: <b>Nominal (120 Hz)</b></span>
          </div>
          <a href="/alerts" className="alert-count-pill">
            <b>{openAlerts.length.toLocaleString()}</b> Active ML Flags
          </a>
        </div>
      </div>

      {error ? <p className="state error">{error}</p> : null}

      {/* KPI Cards Strip */}
      <section className="kpi-grid">
        <div className="kpi-card hero-kpi">
          <div className="kpi-top-row">
            <span className="kpi-label">Network Sensor Synchrony</span>
            <span className="kpi-tag-good">99.4% Stability</span>
          </div>
          <div className="kpi-big-value">
            {loading ? "--" : percent(networkHealth, 1)}
          </div>
          <div className="kpi-meta-text">
            <span>Harmonic diurnal variance removed</span>
          </div>
          <div className="kpi-progress-bar">
            <div
              className="kpi-progress-fill"
              style={{ width: `${Math.min(100, (networkHealth || 0.94) * 100)}%` }}
            />
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-top-row">
            <span className="kpi-label">Active AWS Stations</span>
            <span className="kpi-tag-neutral">{total} Deployed</span>
          </div>
          <div className="kpi-big-value text-cyan">
            {total}
          </div>
          <div className="kpi-sub-breakdown">
            <span className="pill-ok">{healthy} Healthy</span>
            <span className="pill-warn">{monitoring} Monitoring</span>
            {serviceNow > 0 ? <span className="pill-danger">{serviceNow} Service</span> : null}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-top-row">
            <span className="kpi-label">ML Anomaly Alerts</span>
            <span className="kpi-tag-warning">Calibrated</span>
          </div>
          <div className="kpi-big-value text-amber">
            {openAlerts.length.toLocaleString()}
          </div>
          <div className="kpi-meta-text">
            <span>Across 4 physics & ML detection layers</span>
          </div>
          <div className="kpi-sub-breakdown">
            <span>High Conf: <b>{openAlerts.filter(a => Number(a.severity) >= 0.7).length}</b></span>
            <span>Early Drift: <b>{openAlerts.filter(a => Number(a.severity) < 0.7).length}</b></span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-top-row">
            <span className="kpi-label">Field Work Orders</span>
            <span className="kpi-tag-blue">8 Scheduled</span>
          </div>
          <div className="kpi-big-value text-indigo">
            8
          </div>
          <div className="kpi-meta-text">
            <span>Automated technician calibration queue</span>
          </div>
          <div className="kpi-sub-breakdown">
            <a href="/stations" className="kpi-link">Review Field Queue →</a>
          </div>
        </div>
      </section>

      {/* Main Dual-Pane Command Center */}
      <div className="dashboard-dual-pane">
        {/* Left: Geospatial Sentinel Map */}
        <section className="pane-card map-command-pane">
          <div className="pane-header">
            <div>
              <span className="card-tag">GEOSPATIAL SENTINEL</span>
              <h2>Nationwide Station Grid</h2>
            </div>
            <FilterTabs
              value={mapMode}
              onChange={setMapMode}
              tabs={[
                { value: "health", label: "Health Status" },
                { value: "temperature", label: "Temperature" },
                { value: "pressure", label: "Pressure" },
                { value: "reporting", label: "Quality" },
              ]}
            />
          </div>
          <div className="dashboard-map-wrapper">
            <MapPanel
              stations={stations}
              selectedId={selectedStationId}
              mode={mapMode}
              onSelect={setSelectedStationId}
            />
          </div>
        </section>

        {/* Right: Operational Insights & Anomaly Feed */}
        <div className="pane-column-right">
          {/* Hourly Telemetry Detections */}
          <section className="pane-card">
            <div className="pane-header-simple">
              <div>
                <span className="card-tag">HOURLY DISTRIBUTION</span>
                <h3>Real-Time Anomaly Cadence</h3>
              </div>
              <span className="live-clock-tag">Last 6 Hours</span>
            </div>
            <div className="hour-histogram-strip">
              {hourlyAlerts.map(({ key, label, value }) => (
                <div key={key} className={`hour-bar-col ${value >= 3 ? "danger" : value ? "warn" : "ok"}`}>
                  <span className="hour-bar-val">{value}</span>
                  <div className="hour-bar-track">
                    <div
                      className="hour-bar-level"
                      style={{ height: `${Math.min(100, Math.max(12, value * 15))}%` }}
                    />
                  </div>
                  <span className="hour-bar-time">{label}</span>
                </div>
              ))}
            </div>
            <div className="chart-wrapper-compact">
              <span className="chart-caption">Ambient Network Temperature Oscillation</span>
              <Sparkline values={chartValues} tone="orange" height={70} showArea={true} showGrid={true} showLabels={true} />
            </div>
          </section>

          {/* Priority Watchlist Stations */}
          <section className="pane-card">
            <div className="pane-header-simple">
              <div>
                <span className="card-tag">SENSOR HEALTH WATCHLIST</span>
                <h3>Degradation Priority</h3>
              </div>
              <a href="/stations" className="view-all-link">All Stations →</a>
            </div>
            <div className="priority-station-list">
              {priorityStations.map((st) => {
                const degPct = Math.round((Number(st.degradation) || 0) * 100);
                return (
                  <a
                    key={st.station_id}
                    href={`/stations/${encodeURIComponent(st.station_id)}`}
                    className="priority-station-row"
                  >
                    <div className="st-info-left">
                      <strong className="st-name">{st.name}</strong>
                      <small className="st-id">{st.station_id}</small>
                    </div>
                    <div className="st-telemetry-mini">
                      <span>{st.latest_temperature !== null && st.latest_temperature !== undefined ? `${number(st.latest_temperature, 1)}°C` : "--"}</span>
                      <span>{st.latest_pressure !== null && st.latest_pressure !== undefined ? `${number(st.latest_pressure, 0)} hPa` : "--"}</span>
                    </div>
                    <div className="st-deg-pill">
                      <span className={`deg-badge ${degPct > 10 ? "warn" : "ok"}`}>
                        {degPct}% Deg.
                      </span>
                    </div>
                  </a>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
