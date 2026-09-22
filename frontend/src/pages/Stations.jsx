import { useMemo, useState } from "react";
import FilterTabs from "../components/FilterTabs.jsx";
import StationCard from "../components/StationCard.jsx";
import { effectiveStatus, networkReferenceTime, percent } from "../services/api.js";

export default function Stations({ stations, openAlerts, loading, error }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("risk");

  // Same staleness-aware status every other page now uses -- a station
  // silent for hours no longer counts as "healthy" here just because it
  // hasn't reported a new reading since it last earned an OK.
  const referenceTime = networkReferenceTime(stations);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return stations
      .filter((station) => {
        const status = effectiveStatus(station, referenceTime);
        if (filter === "healthy" && status !== "OK") return false;
        if (filter === "monitor" && !["MONITOR", "SCHEDULE", "SERVICE NOW"].includes(status)) return false;
        if (!normalizedQuery) return true;
        return `${station.station_id} ${station.name}`.toLowerCase().includes(normalizedQuery);
      })
      .sort((a, b) => {
        const aHealth = Number.isFinite(Number(a.health)) ? Number(a.health) : null;
        const bHealth = Number.isFinite(Number(b.health)) ? Number(b.health) : null;
        if (aHealth === null && bHealth === null) return 0;
        if (aHealth === null) return 1;
        if (bHealth === null) return -1;
        if (sort === "health") return bHealth - aHealth;
        return aHealth - bHealth;
      });
  }, [filter, query, sort, stations, referenceTime]);

  const activePercent = stations.length
    ? stations.filter((station) => effectiveStatus(station, referenceTime) !== "SERVICE NOW").length / stations.length
    : 0;

  function stationAlert(stationId) {
    return openAlerts.find((alert) => alert.station_id === stationId);
  }

  function openStation(stationId) {
    window.location.href = `/stations/${encodeURIComponent(stationId)}`;
  }

    if (loading) {
    return (
      <main className="screen stations-screen">
        <div className="loading-state-card">
          <div className="loading-spinner" />
          <p>Connecting to live station stream...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="screen stations-screen">
      {/* Page Header */}
      <div className="page-header-strip">
        <div>
          <span className="section-eyebrow">IMD SYNOPTIC OBSERVATION FLEET</span>
          <h1 className="page-main-heading">Monitored AWS Stations</h1>
          <p className="page-sub-heading">
            {loading
              ? "Connecting to live station stream..."
              : `${stations.length} Indian Automatic Weather Stations operating under harmonic diurnal QC`}
          </p>
        </div>
        <div className="page-header-metrics">
          <div className="metric-badge-chip">
            <span className="chip-indicator active" />
            <span>Operational Fleet: <b>{percent(activePercent, 1)}</b></span>
          </div>
          <div className="metric-badge-chip neutral">
            <span>Total Nodes: <b>{stations.length} AWS</b></span>
          </div>
        </div>
      </div>

      {error ? <p className="state error">{error}</p> : null}

      {/* Control Bar: Search, Filters & Sort */}
      <div className="stations-controls-row">
        <div className="search-bar-wrap">
          <span className="search-icon">🔍</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by station code (e.g. AWS-DEL-01) or city..."
            aria-label="Search station"
          />
          {query && (
            <button type="button" className="search-clear-btn" onClick={() => setQuery("")}>
              ✕
            </button>
          )}
        </div>

        <FilterTabs
          value={filter}
          onChange={setFilter}
          tabs={[
            { value: "all", label: `All (${stations.length})` },
            { value: "healthy", label: `Healthy (${stations.filter((s) => effectiveStatus(s, referenceTime) === "OK").length})` },
            { value: "monitor", label: `Requires Attention (${stations.filter((s) => effectiveStatus(s, referenceTime) !== "OK").length})` }
          ]}
        />

        <div className="sort-dropdown-wrap">
          <label htmlFor="station-sort-select">Sort by:</label>
          <select
            id="station-sort-select"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="risk">Risk Priority (Highest First)</option>
            <option value="health">Sensor Health (Lowest First)</option>
          </select>
        </div>
      </div>

      <div className="stations-results-meta">
        <span>Showing <b>{filtered.length}</b> of <b>{stations.length}</b> stations across India</span>
      </div>

      {/* Stations Grid */}
      <section className="station-grid-container">
        {filtered.length ? (
          filtered.map((station) => (
            <StationCard
              key={station.station_id}
              station={station}
              alert={stationAlert(station.station_id)}
              onOpen={openStation}
              referenceTime={referenceTime}
            />
          ))
        ) : (
          <div className="empty-state-card">
            <span className="empty-icon">📡</span>
            <h3>No stations match your criteria</h3>
            <p>Try refining your search keyword or switching the filter tab.</p>
            <button type="button" className="btn-reset-filters" onClick={() => { setQuery(""); setFilter("all"); }}>
              Reset Filters
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
