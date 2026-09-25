import { useMemo, useState } from "react";
import FilterTabs from "../components/FilterTabs.jsx";
import MapPanel from "../components/MapPanel.jsx";
import MetricCard from "../components/MetricCard.jsx";
import Sparkline from "../components/Sparkline.jsx";
import StatusLegend from "../components/StatusLegend.jsx";
import { anomalyActionText, anomalyReasonText, effectiveStatus, estimateFor, healthOrNull, isSilent, networkReferenceTime, percent, number, severityLevel, timeAgo, injectDemoAnomaly } from "../services/api.js";
import { useTheme } from "../services/theme.js";

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
  //
  // Buckets are matched on the start of the viewer's LOCAL hour. They used
  // to be matched on a UTC "YYYY-MM-DDTHH" string, which only lines up
  // with local hours in whole-hour timezones. India is UTC+5:30, so every
  // alert raised in the second half of an IST hour landed in the next
  // hour's bar, and anything from the second half of the current hour
  // matched no bar at all and was dropped.
  const now = new Date();

  const buckets = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now);
    date.setHours(now.getHours() - 5 + index, 0, 0, 0);
    return {
      key: date.getTime(),
      label: date.toLocaleTimeString([], { hour: "numeric" }),
      value: 0
    };
  });

  for (const alert of alerts) {
    const created = new Date(alert.created_at);
    if (Number.isNaN(created.getTime())) continue;
    created.setMinutes(0, 0, 0);
    const bucket = buckets.find((item) => item.key === created.getTime());
    if (bucket) bucket.value += 1;
  }

  return buckets;
}

// Turns the verdict's evidence keys (emitted by ml/sahasraksha/stream.py)
// into short, plain sentences, so the demo result names the exact checks
// that fired instead of one generic "impossible" sentence.
const CHANNEL_NAMES = { T: "Temperature", P: "Pressure", RH: "Humidity" };
const CHANNEL_UNITS = { T: "°C", P: "hPa", RH: "%" };

function firedChecks(evidence) {
  const map = Object.fromEntries((evidence || []).map((p) => [String(p?.[0]), Number(p?.[1])]));
  const out = [];
  const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "");
  if ("t_record" in map) out.push(`Temperature ${fmt(map.t_record)} °C is above India's all-time record (51 °C)`);
  if ("dewpoint_ceiling" in map) out.push(`Dew point ${fmt(map.dewpoint_ceiling)} °C: no Indian station goes above 34 °C`);
  if ("dewpoint_violation" in map) out.push("Dew point is above the air temperature, which cannot happen");
  for (const ch of ["T", "P", "RH"]) {
    if (`range_${ch}` in map) out.push(`${CHANNEL_NAMES[ch]} is outside physical limits`);
    if (`step_${ch}` in map) out.push(`${CHANNEL_NAMES[ch]} jumped ${fmt(map[`step_${ch}`])} ${CHANNEL_UNITS[ch]} in one reading`);
    if (`frozen_${ch}` in map) out.push(`${CHANNEL_NAMES[ch]} stuck at one value for ${fmt(map[`frozen_${ch}`], 0)} readings`);
    if (`cusum_${ch}` in map) out.push(`Slow drift building up in ${CHANNEL_NAMES[ch].toLowerCase()}`);
  }
  if ("tide_loss" in map) out.push("Pressure's twice-daily rhythm (tide heartbeat) has faded");
  return out;
}

function DemoIcon({ name }) {
  const paths = {
    thermo: <path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0zM12 9v7" />,
    bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
    arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
  };
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export default function Dashboard({
  health,
  stations,
  alerts = [],
  openAlerts,
  networkTimeseries,
  loading,
  error,
  refresh
}) {
  const [demoLoading, setDemoLoading] = useState(null); // null | "ps55" | "random"
  const [demoResult, setDemoResult] = useState(null);

  async function handleInjectDemo(scenario) {
    setDemoLoading(scenario || "random");
    setDemoResult(null);
    try {
      const verdict = await injectDemoAnomaly(undefined, scenario);
      if (!verdict.flag) {
        setDemoResult({ kind: "none" });
      } else {
        const reason = String(verdict.reason || "").toLowerCase();
        setDemoResult({
          kind: "caught",
          scenario,
          reason,
          title: reason === "impossible" ? "Impossible reading" : reason === "step" ? "Sudden jump" : "Fault detected",
          summary: anomalyReasonText(reason),
          checks: firedChecks(verdict.evidence),
          estimate: estimateFor(verdict.evidence, scenario === "ps55" ? "T" : undefined),
          confidence: verdict.confidence,
          critical: severityLevel(verdict.severity) === "critical",
          action: anomalyActionText(reason),
        });
      }
      // Refresh so the alert count and charts show the fault just caught.
      refresh?.(true);
    } catch (err) {
      setDemoResult({ kind: "error", message: err.message });
    } finally {
      setDemoLoading(null);
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
  // Tallied from the same effectiveStatus() the Stations page uses, so the
  // two pages agree. Counting the raw column here left a low-confidence
  // station whose stored status is "OK" (Bangalore) under Healthy on this
  // page while the Stations page -- correctly -- listed it under Requires
  // Attention.
  const shown = stations.map((station) => effectiveStatus(station, referenceTime));
  const healthy = shown.filter((status) => status === "OK").length;
  const monitoring = shown.filter((status) => status === "MONITOR" || status === "SCHEDULE").length;
  const serviceNow = shown.filter((status) => status === "SERVICE NOW").length;
  const silent = countSilent(stations, referenceTime);
  const scoredStations = stations.filter((station) => healthOrNull(station.health) !== null);
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
  // Every alert RAISED in each hour, open or since resolved. Counting only
  // still-open alerts undercounted the cadence: the live feed's faults
  // clear within a few readings and their alerts resolve with them, so an
  // hour with four detections could show one bar or none.
  const hourlyAlerts = hourlyAlertCounts(alerts.length ? alerts : openAlerts);
  const alertBands = {
    critical: openAlerts.filter((alert) => severityLevel(alert.severity) === "critical").length,
    elevated: openAlerts.filter((alert) => severityLevel(alert.severity) === "monitoring").length,
    low: openAlerts.filter((alert) => severityLevel(alert.severity) === "nodata").length
  };
  const workOrderCount = health?.active_work_order_count ?? 0;
  const workOrderStations = health?.stations_with_open_work_orders;

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
    ? "offline"
    : pipelineDegraded
    ? `degraded · ${silent} silent`
    : "streaming";

  return (
    <main className="screen dashboard-screen">
      {/* Page header */}
      <div className="dashboard-top-bar">
        <div className="dashboard-heading">
          <span className="section-eyebrow">Live demo · SIH26073</span>
          <h1 className="dashboard-main-title">Network Overview</h1>
          <p className="dashboard-subtitle">
            {total
              ? `Watching ${total} Indian weather stations for sensor faults, in real time`
              : "Connecting to the station network…"}
          </p>
          <p className="dashboard-data-as-of" title="Timestamped to the network's own most recent reading, not the browser's clock.">
            Updated {timeAgo(dataAsOf)} · {new Date(dataAsOf).toLocaleString()}
            {silent > 0 ? (
              <span className="dashboard-silent-flag">
                {" "}· {silent} station{silent === 1 ? "" : "s"} silent for 6 h+
              </span>
            ) : null}
          </p>
          {/* The live feed replays each station's real archived NOAA-ISD
              observations against the current clock (keepalive_service.py)
              and periodically injects step and frozen-sensor faults, so the
              detector has something to catch. Without this note, a demo
              alert reads as a real fault at a real IMD station. */}
          <p className="dashboard-demo-note">
            <DemoIcon name="info" />
            <span>
              Demo feed: real archived NOAA station data replayed on today's clock, with test faults
              added now and then so you can watch detection happen.
            </span>
          </p>
        </div>

        <div className="dashboard-side">
          <div className="dashboard-status-row">
            <div className={`telemetry-pill ${pipelineStatusClass}`} title="State of the data pipeline behind this page">
              <span className={`telemetry-live-dot ${pipelineStatusClass}`} />
              <span>Pipeline <b>{pipelineLabel}</b></span>
            </div>
            <a href="/alerts" className="alert-count-pill" title="Open alerts from all six checks">
              <b>{openAlerts.length.toLocaleString()}</b> open alert{openAlerts.length === 1 ? "" : "s"}
              <DemoIcon name="arrow" />
            </a>
          </div>

          <section className="demo-panel" aria-labelledby="demo-panel-title">
            <div className="demo-panel-head">
              <h2 id="demo-panel-title">Try the detector</h2>
              <p>Sends one test reading to a healthy station and shows what the system decides.</p>
            </div>
            <div className="demo-actions">
              {/* The problem statement's own example: one station reports
                  55 °C, 95% RH and a +9 hPa jump while its neighbours read
                  normally. */}
              <button
                type="button"
                className="demo-btn demo-btn-primary"
                onClick={() => handleInjectDemo("ps55")}
                disabled={Boolean(demoLoading)}
                title="The problem statement's example: 55 °C, 95% humidity and a +9 hPa pressure jump"
              >
                <DemoIcon name="thermo" />
                {demoLoading === "ps55" ? "Checking…" : "Run PS example (55 °C)"}
              </button>
              <button
                type="button"
                className="demo-btn demo-btn-secondary"
                onClick={() => handleInjectDemo()}
                disabled={Boolean(demoLoading)}
                title="A sudden jump on one channel of a random healthy station"
              >
                <DemoIcon name="bolt" />
                {demoLoading === "random" ? "Checking…" : "Inject random fault"}
              </button>
            </div>

          </section>
        </div>
      </div>

      {/* Detector result: full-width strip under the header. It used to open
          inside the narrow right-hand panel, which made that column far taller
          than the heading beside it and left a large empty gap on the left. */}
      {demoResult ? (
        <div className={`demo-result demo-result-wide is-${demoResult.kind}`} role="status" aria-live="polite">
          <button type="button" className="demo-result-close" onClick={() => setDemoResult(null)} aria-label="Dismiss result">
            <DemoIcon name="close" />
          </button>
          {demoResult.kind === "caught" ? (
            <div className="demo-result-grid">
              <div className="demo-result-col">
                <div className="demo-result-head">
                  <span className={`demo-chip ${demoResult.critical ? "is-critical" : "is-major"}`}>
                    {demoResult.critical ? "Critical" : "Flagged"}
                  </span>
                  <strong>Caught: {demoResult.title}</strong>
                </div>
                <p className="demo-confidence">
                  {Number.isFinite(Number(demoResult.confidence)) ? `Confidence ${percent(demoResult.confidence, 0)}` : null}
                  {["impossible", "range", "step", "frozen"].includes(demoResult.reason)
                    ? " · decided by physics rules"
                    : ""}
                </p>
                {demoResult.estimate ? (
                  <p className="demo-estimate">
                    Best estimate: <b>{CHANNEL_NAMES[demoResult.estimate.channel]} {number(demoResult.estimate.value, 1)}
                    {demoResult.estimate.band !== null ? ` ± ${number(demoResult.estimate.band, 1)}` : ""} {CHANNEL_UNITS[demoResult.estimate.channel]}</b>
                  </p>
                ) : null}
              </div>
              <div className="demo-result-col">
                <span className="demo-col-label">Checks that fired</span>
                {demoResult.checks.length ? (
                  <ul className="demo-checks">
                    {demoResult.checks.map((c) => <li key={c}>{c}</li>)}
                  </ul>
                ) : (
                  <p className="demo-summary">{demoResult.summary}</p>
                )}
              </div>
              <div className="demo-result-col">
                <span className="demo-col-label">What the operator should do</span>
                {demoResult.action ? <p className="demo-action">{demoResult.action}</p> : null}
                <a href="/alerts" className="demo-link">See it in Alerts <DemoIcon name="arrow" /></a>
              </div>
            </div>
          ) : demoResult.kind === "none" ? (
            <p className="demo-summary">Nothing was flagged this time. The reading looked normal for that station, so try again.</p>
          ) : (
            <p className="demo-summary">Could not reach the detector: {demoResult.message}. The server may be waking up, so try again in a few seconds.</p>
          )}
        </div>
      ) : null}

      {error ? <p className="state error">{error}</p> : null}

      {/* KPI Cards Strip */}
      <section className="kpi-grid">
        <div className="kpi-card hero-kpi">
          <div className="kpi-top-row">
            {/* Was "Network Sensor Synchrony ... Stability / Harmonic
                diurnal variance removed". The number is the plain mean of
                station health scores (health = 1 - recorded tidal
                degradation) -- the Fleet Map shows the same figure as
                "QC Health". Nothing about synchrony or variance removal
                goes into it. */}
            <span className="kpi-label">Mean Station Health</span>
            <span className="kpi-tag-good">{scoredStations.length} scored</span>
          </div>
          <div className="kpi-big-value">
            {loading ? "--" : percent(networkHealth, 1)}
          </div>
          <div className="kpi-meta-text">
            <span>Average across stations with a trusted health score</span>
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
            {/* Tagged "Calibrated" -- alert confidence is a heuristic
                (max(severity, degradation, 0.6) in anomaly_detector.py),
                not a calibrated probability. */}
            <span className="kpi-label">Open Alerts</span>
            <span className="kpi-tag-warning">Open</span>
          </div>
          <div className="kpi-big-value text-amber">
            {openAlerts.length.toLocaleString()}
          </div>
          <div className="kpi-meta-text">
            <span>Raised by the 6 checks (physics, drift, tide, AI)</span>
          </div>
          <div className="kpi-sub-breakdown">
            {/* Was "High Conf" / "Early Drift", split at severity 0.7.
                Neither label described the split -- it is severity, not
                confidence, and step and frozen-sensor faults landed under
                "drift". Same bands as the Alerts page tabs. */}
            <span>Critical: <b>{alertBands.critical}</b></span>
            <span>Elevated: <b>{alertBands.elevated}</b></span>
            {alertBands.low > 0 ? <span>Low: <b>{alertBands.low}</b></span> : null}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-top-row">
            <span className="kpi-label">Field Work Orders</span>
            <span className="kpi-tag-blue">
              {workOrderStations !== undefined && workOrderStations !== null
                ? `${workOrderStations} station${workOrderStations === 1 ? "" : "s"}`
                : "Open"}
            </span>
          </div>
          <div className="kpi-big-value text-indigo">
            {workOrderCount}
          </div>
          {/* One station can hold several open orders -- each high-severity
              alert raises its own, and a chronically degraded station keeps
              them open after the alert clears -- so the station count is
              shown beside the order count rather than implied by it. */}
          <div className="kpi-meta-text">
            <span>Open work orders raised automatically by high-severity alerts</span>
          </div>
          <div className="kpi-sub-breakdown">
            {/* Was "Review Field Queue" -- there is no work-order page; this
                goes to the station list, filtered to the ones needing
                attention. */}
            <a href="/stations?filter=monitor" className="kpi-link">Stations needing attention →</a>
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

          <StatusLegend />

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
                      {/* Amber from 20% -- the backend's SCHEDULE floor and
                          the S2 page's own threshold. It was 10%, so
                          Ganganagar at 12% was amber here and "intact" on
                          its own tide page. */}
                      <span className={`deg-badge ${degPct >= 20 ? "warn" : "ok"}`}>
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
