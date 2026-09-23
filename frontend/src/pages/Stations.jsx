import { useMemo, useState } from "react";
import FilterTabs from "../components/FilterTabs.jsx";
import StationCard from "../components/StationCard.jsx";
import { effectiveStatus, healthOrNull, networkReferenceTime, percent, statusRank } from "../services/api.js";

const FILTERS = ["all", "healthy", "monitor"];

// Lets another page link straight to a filtered list (the Dashboard's work
// order card links to /stations?filter=monitor).
function initialFilter() {
  try {
    const requested = new URLSearchParams(window.location.search).get("filter");
    return FILTERS.includes(requested) ? requested : "all";
  } catch {
    return "all";
  }
}

export default function Stations({ stations, openAlerts, loading, error }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(initialFilter);
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
        // Number(null) is 0, and 0 is finite, so a station with no health
        // score at all was scoring as 0.0 -- the most critical value there
        // is. healthOrNull keeps "no score" out of the ranking entirely.
        const aHealth = healthOrNull(a.health);
        const bHealth = healthOrNull(b.health);

        // "Risk Priority" used to rank on health alone. Health tracks slow
        // calibration wear, so a station with an acute step fault -- SERVICE
        // NOW at 100% health -- sat 51st of 60, below every healthy
        // station. Status is what says how urgently a person is needed, so
        // it leads, and health orders stations within each status.
        if (sort === "risk") {
          const byStatus =
            statusRank(effectiveStatus(b, referenceTime)) - statusRank(effectiveStatus(a, referenceTime));
          if (byStatus !== 0) return byStatus;
        }

        if (aHealth === null && bHealth === null) return 0;
        if (aHealth === null) return 1;
        if (bHealth === null) return -1;
        // "Sensor Health (Lowest First)" sorted HIGHEST first: the two
        // branches were the wrong way round. Both orders are ascending now.
        return aHealth - bHealth;
      });
  }, [filter, query, sort, stations, referenceTime]);

  // A station whose data the pipeline does not trust cannot be counted as
  // demonstrably operational -- there are no readings behind it to say so.
  const activePercent = stations.length
    ? stations.filter(
        (station) =>
          station.data_quality !== "low_confidence" &&
          effectiveStatus(station, referenceTime) !== "SERVICE NOW"
      ).length / stations.length
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
            // Was "e.g. AWS-DEL-01", a format no station in this network
            // uses -- the IDs are NOAA-ISD composites like 42182099999.
            placeholder={`Search ${stations.length} stations by code (e.g. ${stations[0]?.station_id || "42182099999"}) or name...`}
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
