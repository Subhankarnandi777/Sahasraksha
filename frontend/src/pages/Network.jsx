import { useMemo, useState } from "react";
import BottomNav from "../components/BottomNav.jsx";
import FilterTabs from "../components/FilterTabs.jsx";
import Header from "../components/Header.jsx";
import MapPanel from "../components/MapPanel.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import TelemetryCard from "../components/TelemetryCard.jsx";
import { number, percent } from "../services/api.js";

export default function Network({ stations, selectedStation, selectedStationId, timeseries, openAlerts, loading, error }) {
  const [mode, setMode] = useState("health");
  const selected = selectedStation || stations[0];
  const latest = timeseries[timeseries.length - 1] || {};
  const mapStations = useMemo(() => stations.filter((station) => Number.isFinite(Number(station.lat)) && Number.isFinite(Number(station.lon))), [stations]);

  function selectStation(stationId) {
    window.location.href = `/stations/${encodeURIComponent(stationId)}`;
  }

  return (
    <main className="screen network-screen">
      <Header subtitle="Station Network Telemetry" liveText="LIVE - INSAT-3DR" />
      <div className="page-heading">
        <div>
          <h1>Station Network</h1>
          <p>{loading ? "Loading stations" : `${stations.length} Stations Monitored`}</p>
        </div>
        <div className="circle-actions"><button>⌕</button><button>☷</button></div>
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
      <MapPanel stations={mapStations} selectedId={selectedStationId} onSelect={selectStation} />
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
          <p>{selected.name}</p>
          <div className="telemetry-mini-grid">
            <TelemetryCard label="Temperature" value={latest.T} unit="C" status="Normal" values={timeseries.map((row) => row.T)} />
            <TelemetryCard label="Pressure" value={latest.P} unit=" hPa" status="Heartbeat" values={timeseries.map((row) => row.P)} tone="amber" />
            <TelemetryCard label="Humidity" value={latest.RH} unit="%" status="Stable" values={timeseries.map((row) => row.RH)} />
          </div>
          <small>Coordinates {number(selected.lat, 2)}, {number(selected.lon, 2)}</small>
        </section>
      ) : <p className="state">No stations available.</p>}
      <BottomNav active="map" alertCount={openAlerts.length} />
    </main>
  );
}
