import BottomNav from "../components/BottomNav.jsx";
import Header from "../components/Header.jsx";
import MetricCard from "../components/MetricCard.jsx";
import Sparkline from "../components/Sparkline.jsx";
import { percent } from "../services/api.js";

function countStatus(stations, status) {
  return stations.filter((station) => station.status === status).length;
}

function hourlyAlertCounts(alerts) {
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

export default function Dashboard({ health, stations, openAlerts, timeseries, loading, error }) {
  const total = health?.station_count ?? stations.length;
  const healthy = countStatus(stations, "OK");
  const monitoring = countStatus(stations, "MONITOR") + countStatus(stations, "SCHEDULE");
  const serviceNow = countStatus(stations, "SERVICE NOW");
  const scoredStations = stations.filter((station) => Number.isFinite(Number(station.health)));
  const networkHealth = scoredStations.length
    ? scoredStations.reduce((sum, station) => sum + Number(station.health), 0) / scoredStations.length
    : 0;
  const chartValues = timeseries.map((row) => row.T).filter((value) => value !== null);
  const hourlyAlerts = hourlyAlertCounts(openAlerts);

  return (
    <main className="screen dashboard-screen">
      <Header subtitle="National Network" />
      {error ? <p className="state error">{error}</p> : null}
      <section className="hero-card">
        <div className="status-line"><span />System Operational</div>
        <p>Network Health</p>
        <h1>{loading ? "--" : percent(networkHealth, 1)}</h1>
        <small>{total} AWS Stations Online</small>
        <div className="summary-pill">
          <b>{healthy}<small>Healthy</small></b>
          <b>{monitoring}<small>Monitoring</small></b>
          <b>{serviceNow}<small>Service Now</small></b>
        </div>
      </section>

      <section className="photo-card">
        <div>
          <span>Nationwide AWS Grid</span>
          <h2>Real-Time Sensor Synchrony: {stations.length ? percent(networkHealth, 1) : "--"}</h2>
          <p>Continuous micro-telemetry verification active</p>
        </div>
      </section>

      <div className="section-title">
        <h2>Current Network Fleet</h2>
        <a href="/network">Live Sync</a>
      </div>
      <div className="metric-grid two">
        <MetricCard tone="critical" label="Service Now" value={serviceNow} subtext={`${total ? (serviceNow / total * 100).toFixed(1) : 0}% faulted`} />
        <MetricCard tone="nodata" label="Offline / Silent" value={serviceNow} subtext="Inactive" />
      </div>

      <section className="card">
        <h2>Hourly Telemetry Anomaly Detections</h2>
        <div className="hour-row">
          {hourlyAlerts.map(({ key, label, value }) => (
            <span key={key} className={value >= 3 ? "danger" : value ? "warn" : "ok"}>
              <b>{label}</b>
              <strong>{value ? "!" : "OK"}</strong>
              <small>{value}</small>
            </span>
          ))}
        </div>
        <Sparkline values={chartValues} />
      </section>

      <BottomNav active="home" alertCount={openAlerts.length} />
    </main>
  );
}
