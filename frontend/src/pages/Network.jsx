import { useEffect, useMemo, useState } from "react";
import BottomNav from "../components/BottomNav.jsx";
import FilterTabs from "../components/FilterTabs.jsx";
import Header from "../components/Header.jsx";
import MapPanel from "../components/MapPanel.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import TelemetryCard from "../components/TelemetryCard.jsx";
import { number, percent, channelStatus, getStationTimeseries, getStationVerdicts } from "../services/api.js";

export default function Network({ stations, selectedStation, selectedStationId, timeseries, verdicts, openAlerts, loading, error }) {
  const [mode, setMode] = useState("health");
  // Local, in-page selection driven by map clicks -- independent of the
  // URL-driven selectedStationId, so clicking a marker updates this card
  // without navigating away.
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

  // Whichever station is actually being shown in the bottom card right now.
  const selected = (focusedId && stations.find((s) => s.station_id === focusedId))
    || selectedStation || stations[0];
  const activeTimeseries = focusedId ? (focusedTimeseries || []) : timeseries;
  const activeVerdicts = focusedId ? (focusedVerdicts || []) : verdicts;
  const latest = activeTimeseries[activeTimeseries.length - 1] || {};
  const latestVerdict = activeVerdicts[activeVerdicts.length - 1];

  return (
    <main className="screen network-screen">
      <Header subtitle="Station Network Telemetry" liveText="LIVE - INSAT-3DR" />
      <div className="page-heading">
        <div>
          <h1>Station Network</h1>
          <p>{loading ? "Loading stations" : `${stations.length} Stations Monitored`}</p>
        </div>
      </div>
      {error ? <p className="state error">{error}</p> : null}
      <FilterTabs
        value={mode}
        onChange={setMode}
        tabs={[
          { value: "health", label: "Health" },
          { value: "temperature", label: "Temperature" },
          { value: "pressure", label: "Pressure" },
          { value: "reporting", label: "Reporting" }
        ]}
      />
      <MapPanel stations={mapStations} selectedId={focusedId || selectedStationId} mode={mode} onSelect={setFocusedId} />
      <section className="live-stream">
        <button type="button">▶</button>
        <div><span>Live Stream</span><i /></div>
        <b>{new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</b>
      </section>
      {selected ? (
        <section className="selected-station card">
          <div className="station-card-top">
            <h2>{selected.station_id}</h2>
            <StatusBadge status={selected.status}>{selected.status} - {percent(selected.health, 1)}</StatusBadge>
          </div>
          <p>{selected.name}{focusedLoading ? " (loading...)" : ""}</p>
          <div className="telemetry-mini-grid">
            <TelemetryCard label="Temperature" value={latest.T} unit="C" status={channelStatus(latestVerdict, "T", "Normal")} values={activeTimeseries.map((row) => row.T)} />
            <TelemetryCard label="Pressure" value={latest.P} unit=" hPa" status={latestVerdict?.degradation ? `Heartbeat ${percent(latestVerdict.degradation, 0)}` : "Stable"} values={activeTimeseries.map((row) => row.P)} tone="amber" />
            <TelemetryCard label="Humidity" value={latest.RH} unit="%" status={channelStatus(latestVerdict, "RH", "Stable")} values={activeTimeseries.map((row) => row.RH)} />
          </div>
          <small>Coordinates {number(selected.lat, 2)}, {number(selected.lon, 2)}</small>
          <a className="inline-action" href={`/stations/${encodeURIComponent(selected.station_id)}`}>Open full station detail</a>
        </section>
      ) : <p className="state">No stations available.</p>}
      <BottomNav active="map" alertCount={openAlerts.length} />
    </main>
  );
}