import { useMemo, useState } from "react";
import FilterTabs from "../components/FilterTabs.jsx";
import MapPanel from "../components/MapPanel.jsx";
import MetricCard from "../components/MetricCard.jsx";
import Sparkline from "../components/Sparkline.jsx";
import { isSilent, networkReferenceTime, percent, number, timeAgo, injectDemoAnomaly } from "../services/api.js";
import { useTheme } from "../services/theme.js";

function countStatus(stations, status) {
  return stations.filter((station) => station.status === status).length;
}

function countSilent(stations, referenceTime) {
  return stations.filter((station) => isSilent(station, referenceTime)).length;
}

function hourlyAlertCounts(alerts) {
  // Anchored to the real wall clock, not the latest alert's own
  // created_at. Anchoring to the latest alert let an old batch of
  // replayed/historical alerts silently relabel themselves as "the last
  // 6 hours" just because nothing newer had happened yet -- which is
  // exactly the kind of implied-live claim this dashboard shouldn't make.
  // A genuinely quiet real last 6 hours should show as empty, not get
  // backfilled with whenever the last event happened to occur.
  const now = new Date();

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

export default function Dashboard({
  health,
  stations,
  openAlerts,
  networkTimeseries,
  loading,
  error
}) {
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoStatus, setDemoStatus] = useState(null);

  async function handleInjectDemo() {
    setDemoLoading(true);
    setDemoStatus(null);
    try {
      const verdict = await injectDemoAnomaly();
      setDemoStatus(
        verdict.flag
          ? `Detected: ${verdict.reason} (severity ${percent(verdict.severity, 0)})`
          : "No anomaly flagged this time — try again."
      );
    } catch (err) {
      setDemoStatus(`Failed: ${err.message}`);
    } finally {
      setDemoLoading(false);
    }
  }
  const [mapMode, setMapMode] = useState("health");
  const [selectedStationId, setSelectedStationId] = useState(null);
  const { isDark } = useTheme();

  const total = health?.station_count ?? stations.length;
  const referenceTime = networkReferenceTime(stations);
  // A station's persisted status is only recomputed when a new reading
  // arrives -- it never gets revisited just because time passed with no
  // reading at all. So an "OK" station that has gone silent for hours
  // keeps reading "OK" forever, and would otherwise get counted as
  // Healthy right next to this page's own "N stations silent" banner.
  // Folded into Monitoring instead (a station that stopped reporting
  // needs attention same as one showing active drift), which keeps
  // Healthy + Monitoring + Service summing to the real total rather than
  // just dropping silent-but-nominally-OK stations from the count
  // entirely.
  const silentButNominallyOk = stations.filter(
    (station) => station.status === "OK" && isSilent(station, referenceTime)
  ).length;
  const healthy = countStatus(stations, "OK") - silentButNominallyOk;
  const monitoring =
    countStatus(stations, "MONITOR") + countStatus(stations, "SCHEDULE") + silentButNominallyOk;
  const serviceNow = countStatus(stations, "SERVICE NOW");
  const silent = countSilent(stations, referenceTime);
  const scoredStations = stations.filter((station) => Number.isFinite(Number(station.health)));
  const networkHealth = scoredStations.length
    ? scoredStations.reduce((sum, station) => sum + Number(station.health), 0) / scoredStations.length
    : 0;
  // Network-wide hourly medians, NOT one station's raw trace. The live
  // feed deliberately injects transient anomalies into individual
  // stations so the detector has something real to catch; plotting a
  // single station here meant the headline chart read an impossible
  // "Min: 10.0" for an Indian September whenever that station happened
  // to be mid-injection -- and made the chart's own "Network" title an
  // overclaim. A median across ~60 stations barely moves for one
  // outlier, while a genuine network-wide shift still shows.
  const chartValues = (networkTimeseries || [])
    .map((row) => row.T)
    .filter((value) => value !== null && value !== undefined);
  const hourlyAlerts = hourlyAlertCounts(openAlerts);

  // The dataset this demo replays is real archival IMD/NOAA-ISD station
  // history, not a live wall-clock feed -- individual readings can (and do)
  // sit months behind today's date. We show that honestly instead of
  // implying every number on this page happened "just now": everything is
  // relative to the network's OWN latest reading (referenceTime, computed
  // above), matching the isSilent staleness check that already works this
  // way elsewhere in the app.
  const dataAsOf = referenceTime;

  // Top attention stations (real degradation only). Padding this list with
  // 0%-degradation stations just because we need 5 rows misrepresents a
  // quiet network as having an active priority queue -- an empty state is
  // more honest than a fake-looking ranked list.
  const priorityStations = useMemo(() => {
    return [...stations]
      .filter((station) => Number(station.degradation || 0) > 0)
      .sort((a, b) => (Number(b.degradation || 0) - Number(a.degradation || 0)))
      .slice(0, 5);
  }, [stations]);

  if (loading) {
    return (
      <main className="screen dashboard-screen">
        <div className="loading-state-card">
          <div className="loading-spinner" />
          <p>Loading network overview...</p>
        </div>
      </main>
    );
  }

  // Was a hardcoded "Nominal (Real-Time Streaming)" regardless of what
  // actually happened on the last fetch -- it would keep reading Nominal
  // even if the backend were unreachable (error set, showing stale
  // cached data) or if most of the fleet had gone silent. Tied to the
  // same signals this page already surfaces elsewhere (the error banner
  // below, the "N stations silent" flag above) rather than a fixed string.
  const pipelineDown = Boolean(error);
  const pipelineDegraded = !pipelineDown && total > 0 && silent >= Math.ceil(total / 2);
  const pipelineStatusClass = pipelineDown ? "is-down" : pipelineDegraded ? "is-degraded" : "";
  const pipelineLabel = pipelineDown
    ? "Offline (Fetch Failed)"
    : pipelineDegraded
    ? `Degraded (${silent} station${silent === 1 ? "" : "s"} silent)`
    : "Nominal (Real-Time Streaming)";

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
          <p className="dashboard-data-as-of" title="Timestamped to the network's own most recent reading, not assumed to be the browser's wall clock -- this stays accurate whether every station is currently live or the service just woke from an idle period.">
            Data as of {timeAgo(dataAsOf)} · {new Date(dataAsOf).toLocaleString()}
            {silent > 0 ? (
              <span className="dashboard-silent-flag">
                {" "}· {silent} station{silent === 1 ? "" : "s"} silent 6h+
              </span>
            ) : null}
          </p>
        </div>
        <div className="dashboard-badge-cluster">
          <div className={`telemetry-pill ${pipelineStatusClass}`}>
            <span className={`telemetry-live-dot ${pipelineStatusClass}`} />
            <span>Telemetry Pipeline: <b>{pipelineLabel}</b></span>
          </div>
          <a href="/alerts" className="alert-count-pill">
            <b>{openAlerts.length.toLocaleString()}</b> Active ML Flags
          </a>
          <button type="button" className="btn-reset-filters" onClick={handleInjectDemo} disabled={demoLoading}>
            {demoLoading ? "Injecting..." : "⚡ Inject Test Anomaly"}
          </button>
          {demoStatus && <span className="state">{demoStatus}</span>}
        </div>
      </div>

      {error ? <p className="state error">{error}</p> : null}

      {/* KPI Cards Strip */}
      <section className="kpi-grid">
        <div className="kpi-card hero-kpi">
          <div className="kpi-top-row">
            <span className="kpi-label">Network Sensor Synchrony</span>
            <span className="kpi-tag-good">{loading ? "--" : percent(networkHealth, 1)} Stability</span>
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
              // networkHealth is already a real computed number, defaulting to
              // 0 (not null/undefined) when no station has a scorable health
              // value -- so `networkHealth || 0.94` was replacing a
              // legitimate, real 0% with a fabricated 94% every time (0 is
              // falsy in JS). A genuine 0% must render as an empty bar, not
              // a fake near-full one.
              style={{ width: `${Math.min(100, networkHealth * 100)}%` }}
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
            <span className="kpi-tag-blue">{health?.active_work_order_count ?? 0} Scheduled</span>
          </div>
          <div className="kpi-big-value text-indigo">
            {health?.active_work_order_count ?? 0}
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
                { value: "humidity", label: "Humidity" },
                { value: "pressure", label: "Pressure" },
                { value: "reporting", label: "Quality" },
              ]}
            />
          </div>

          {/* Station Status Points Meaning Legend */}
          <div className="map-legend-bar">
            <span className="legend-title">Station Points Status:</span>
            <div className="legend-items">
              <span className="legend-badge" title="Health ≥ 90%, all sensor channels nominal">
                <span className="legend-dot ok" />
                <span className="legend-name">Nominal (OK)</span>
              </span>
              <span className="legend-badge" title="Routine maintenance calibration scheduled">
                <span className="legend-dot schedule" />
                <span className="legend-name">Schedule</span>
              </span>
              <span className="legend-badge" title="Elevated sensor degradation or drift detected">
                <span className="legend-dot monitor" />
                <span className="legend-name">Monitor</span>
              </span>
              <span className="legend-badge" title="Critical anomaly threshold exceeded - field service needed">
                <span className="legend-dot service-now" />
                <span className="legend-name">Service Now</span>
              </span>
              <span className="legend-badge" title="Data confidence low / harmonic flagging">
                <span className="legend-dot low-confidence" />
                <span className="legend-name">Low Confidence</span>
              </span>
            </div>
          </div>

          <div className="dashboard-map-wrapper">
            <MapPanel
              stations={stations}
              selectedId={selectedStationId}
              mode={mapMode}
              onSelect={setSelectedStationId}
              isDark={isDark}
              hideFloatingTopControls={false}
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
              {priorityStations.length === 0 ? (
                <p className="priority-list-empty-state">
                  No station is showing elevated degradation right now -- network nominal.
                </p>
              ) : null}
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
                      <span>{st.latest_humidity !== null && st.latest_humidity !== undefined ? `${number(st.latest_humidity, 0)}% RH` : "--"}</span>
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
