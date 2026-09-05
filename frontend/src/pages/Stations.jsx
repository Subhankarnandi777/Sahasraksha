import { useMemo, useState } from "react";
import BottomNav from "../components/BottomNav.jsx";
import FilterTabs from "../components/FilterTabs.jsx";
import Header from "../components/Header.jsx";
import StationCard from "../components/StationCard.jsx";
import { percent } from "../services/api.js";

export default function Stations({ stations, openAlerts, loading, error }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("risk");

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return stations
      .filter((station) => {
        if (filter === "healthy" && station.status !== "OK") return false;
        if (filter === "monitor" && !["MONITOR", "SCHEDULE", "SERVICE NOW"].includes(station.status)) return false;
        if (!normalizedQuery) return true;
        return `${station.station_id} ${station.name}`.toLowerCase().includes(normalizedQuery);
      })
      .sort((a, b) => {
        if (sort === "health") return Number(b.health || 0) - Number(a.health || 0);
        return Number(a.health || 0) - Number(b.health || 0);
      });
  }, [filter, query, sort, stations]);

  const activePercent = stations.length
    ? stations.filter((station) => station.status !== "SERVICE NOW").length / stations.length
    : 0;

  function stationAlert(stationId) {
    return openAlerts.find((alert) => alert.station_id === stationId);
  }

  function openStation(stationId) {
    window.location.href = `/stations/${encodeURIComponent(stationId)}`;
  }

  return (
    <main className="screen stations-screen">
      <Header subtitle="Atmospheric Network" liveText="LIVE - INSAT-3DR" />
      <section className="intro-card">
        <div>
          <span>IMD National Network</span>
          <h1>Stations</h1>
          <p>{loading ? "Loading monitored stations" : `${stations.length} Stations Monitored across 36 meteorological subdivisions`}</p>
        </div>
        <strong>{percent(activePercent, 1)} Active</strong>
      </section>
      {error ? <p className="state error">{error}</p> : null}
      <label className="search-box">
        <span>⌕</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search station or city" />
      </label>
      <FilterTabs
        value={filter}
        onChange={setFilter}
        tabs={[
          { value: "all", label: `All ${stations.length}` },
          { value: "healthy", label: `Healthy ${stations.filter((station) => station.status === "OK").length}` },
          { value: "monitor", label: `Monitor ${stations.filter((station) => station.status !== "OK").length}` }
        ]}
      />
      <div className="list-toolbar">
        <span>Showing {filtered.length} telemetry pods</span>
        <select value={sort} onChange={(event) => setSort(event.target.value)}>
          <option value="risk">Sort: Risk Priority</option>
          <option value="health">Sort: Health</option>
        </select>
      </div>
      <section className="station-list">
        {filtered.length ? filtered.map((station) => (
          <StationCard key={station.station_id} station={station} alert={stationAlert(station.station_id)} onOpen={openStation} />
        )) : <p className="state">No stations match this view.</p>}
      </section>
      <BottomNav active="stations" alertCount={openAlerts.length} />
    </main>
  );
}
