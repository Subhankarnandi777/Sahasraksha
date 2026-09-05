import BottomNav from "../components/BottomNav.jsx";
import Header from "../components/Header.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import TelemetryCard from "../components/TelemetryCard.jsx";
import { daysToThreshold, percent, timeAgo } from "../services/api.js";

export default function StationDetail({ selectedStation, timeseries, verdicts, openAlerts, loading, error }) {
  const station = selectedStation;
  const latest = timeseries[timeseries.length - 1] || {};
  const latestVerdict = verdicts[verdicts.length - 1];

  if (!station && !loading) {
    return (
      <main className="screen">
        <Header subtitle="Station Deep Dive" />
        <p className="state error">Station was not found.</p>
        <BottomNav active="stations" alertCount={openAlerts.length} />
      </main>
    );
  }

  return (
    <main className="screen station-detail-screen">
      <Header subtitle="Station Deep Dive" liveText="INSAT-3DR Synced" />
      <a className="back-link" href="/stations">Back to Station Network</a>
      {error ? <p className="state error">{error}</p> : null}
      {station ? (
        <>
          <section className="deep-card">
            <span>Station Node - {station.station_id}</span>
            <h1>{station.name}</h1>
            <strong>{percent(station.health, 1)}</strong>
            <p>Station Health Score</p>
            <div>
              <StatusBadge status={station.status}>{station.status}</StatusBadge>
              <small>Last updated {timeAgo(station.last_seen)}</small>
            </div>
            <small>Service window: {daysToThreshold(station.days_to_threshold)} days</small>
          </section>
          <TelemetryCard label="Temperature" value={latest.T} unit="C" status="Normal" values={timeseries.map((row) => row.T)} />
          <TelemetryCard label="Pressure" value={latest.P} unit=" hPa" status={latestVerdict?.degradation ? `Heartbeat ${percent(latestVerdict.degradation, 0)}` : "Stable"} values={timeseries.map((row) => row.P)} tone="amber" />
          <TelemetryCard label="Humidity" value={latest.RH} unit="%" status="Stable" values={timeseries.map((row) => row.RH)} tone="blue" />
          <section className="card">
            <h2>Latest AI Verdict</h2>
            {latestVerdict ? (
              <p>{latestVerdict.reason} - Confidence {percent(latestVerdict.confidence, 0)} - Severity {percent(latestVerdict.severity, 0)}</p>
            ) : (
              <p className="state">No verdicts available for this station.</p>
            )}
            <a className="inline-action" href={`/stations/${encodeURIComponent(station.station_id)}/pressure`}>Open Pressure Heartbeat</a>
          </section>
        </>
      ) : <p className="state">Loading station detail...</p>}
      <BottomNav active="stations" alertCount={openAlerts.length} />
    </main>
  );
}
