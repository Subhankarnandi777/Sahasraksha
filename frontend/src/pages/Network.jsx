import { useEffect, useMemo, useRef, useState } from "react";
import MapPanel from "../components/MapPanel.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import TelemetryCard from "../components/TelemetryCard.jsx";
import { number, percent, channelStatus, getStationTimeseries, getStationVerdicts } from "../services/api.js";
import { useTheme } from "../services/theme.js";

function markerStatusClass(status) {
  if (status === "SERVICE NOW") return "service-now";
  if (status === "SCHEDULE") return "schedule";
  if (status === "MONITOR") return "monitor";
  return "ok";
}

export default function Network({ stations = [], selectedStation, selectedStationId, timeseries = [], verdicts = [], openAlerts = [], loading, error }) {
  const [mode, setMode] = useState("health");
  const [region, setRegion] = useState("all");
  const [focusedId, setFocusedId] = useState(null);
  const [focusedTimeseries, setFocusedTimeseries] = useState(null);
  const [focusedVerdicts, setFocusedVerdicts] = useState(null);
  const [focusedLoading, setFocusedLoading] = useState(false);
  const { isDark } = useTheme();

  // Map layer controls
  const [basemap, setBasemap] = useState(isDark ? "dark" : "apple");
  const [radarEnabled, setRadarEnabled] = useState(false);
  const [thermalEnabled, setThermalEnabled] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef(null);
  const searchInputRef = useRef(null);

  // Synchronize basemap with dark theme switch
  useEffect(() => {
    setBasemap(isDark ? "dark" : "apple");
  }, [isDark]);

  const mapStations = useMemo(
    () => stations.filter((station) => Number.isFinite(Number(station.lat)) && Number.isFinite(Number(station.lon))),
    [stations]
  );

  // Autocomplete search suggestions
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return mapStations
      .filter(
        (s) =>
          (s.name || "").toLowerCase().includes(q) ||
          (s.station_id || "").toLowerCase().includes(q) ||
          (s.city || "").toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [mapStations, searchQuery]);

  // Close search dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSearchSelect = (station) => {
    setFocusedId(station.station_id);
    setSearchQuery("");
    setSearchOpen(false);
  };

  const handleExecuteSearch = () => {
    if (searchResults.length > 0) {
      handleSearchSelect(searchResults[0]);
    } else if (searchInputRef.current) {
      searchInputRef.current.focus();
      setSearchOpen(true);
    }
  };

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
    return () => {
      cancelled = true;
    };
  }, [focusedId]);

  const selected = (focusedId && stations.find((s) => s.station_id === focusedId)) || selectedStation || stations[0];
  const activeTimeseries = focusedId ? (focusedTimeseries || []) : timeseries;
  const activeVerdicts = focusedId ? (focusedVerdicts || []) : verdicts;
  const latest = activeTimeseries[activeTimeseries.length - 1] || {};
  const latestVerdict = activeVerdicts[activeVerdicts.length - 1];

  return (
    <main className="screen network-screen">
      {/* 1. Page Header Strip: Title + Telemetry Vitals */}
      <div className="network-header-strip">
        <div className="header-branding-col">
          <span className="section-eyebrow">GEOSPATIAL FLEET SURVEILLANCE</span>
          <h1 className="page-main-heading">Station Network Map</h1>
          <p className="page-sub-heading">
            {loading ? "Loading station telemetry..." : `${stations.length} Synoptic AWS Nodes Active across Indian Subcontinent`}
          </p>
        </div>

        {/* Real-time Atmospheric Fleet Vitals */}
        <div className="network-header-metrics">
          <div className="net-metric-pill" title="Total Synoptic AWS Nodes Reporting">
            <span className="net-metric-blip green" />
            <span><b>{stations.length}</b> Nodes Online</span>
          </div>
          <div className="net-metric-pill" title="Subcontinental AI Harmonic QC Pass Rate">
            <span className="net-metric-blip amber" />
            <span><b>99.8%</b> QC Health</span>
          </div>
          <div className="net-metric-pill" title="Geostationary Meteorological Satellite Sync">
            <span className="net-metric-blip blue" />
            <span><b>INSAT-3DR</b> Synced</span>
          </div>
          <div className="net-metric-pill" title="RainViewer Live Doppler Cloud Stream Active">
            <span className="net-metric-blip cyan" />
            <span><b>Doppler</b> Radar Live</span>
          </div>
        </div>
      </div>

      {/* 2. Geospatial Surveillance Command Deck (Moved controls & search to the empty space above map) */}
      <div className="network-command-deck">
        {/* Search Bar Capsule with Autocomplete */}
        <div className="deck-search-wrap" ref={searchRef}>
          <div className="deck-search-pill">
            <span className="deck-search-icon">🔍</span>
            <input
              ref={searchInputRef}
              type="text"
              className="deck-search-input"
              placeholder="Search 60 AWS stations, cities..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleExecuteSearch();
                }
              }}
            />
            {searchQuery && (
              <button
                type="button"
                className="deck-search-clear"
                onClick={() => {
                  setSearchQuery("");
                  setSearchOpen(false);
                }}
                title="Clear search"
              >
                ✕
              </button>
            )}
            <button
              type="button"
              className="deck-search-btn"
              onClick={handleExecuteSearch}
              title="Execute station search"
            >
              Search
            </button>
          </div>

          {/* Autocomplete Dropdown */}
          {searchOpen && searchResults.length > 0 && (
            <div className="deck-search-dropdown">
              <div className="deck-dropdown-header">MATCHING AWS NODES ({searchResults.length})</div>
              {searchResults.map((st) => (
                <button
                  key={st.station_id}
                  type="button"
                  className="deck-dropdown-item"
                  onClick={() => handleSearchSelect(st)}
                >
                  <span className={`deck-dropdown-dot ${markerStatusClass(st.status)}`} />
                  <div className="deck-dropdown-info">
                    <strong>{st.name}</strong>
                    <small>{st.station_id}</small>
                  </div>
                  <span className="deck-dropdown-val">
                    {st.latest_temperature !== null && st.latest_temperature !== undefined
                      ? `${number(st.latest_temperature, 1)}°`
                      : "--"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Subcontinent Region Filter Group */}
        <div className="deck-segment-group" role="group" aria-label="Subcontinent Region Focus">
          {[
            { id: "all", label: "All India" },
            { id: "north", label: "North" },
            { id: "south", label: "South" },
            { id: "east", label: "East" },
            { id: "west", label: "West" }
          ].map((reg) => (
            <button
              key={reg.id}
              type="button"
              className={`deck-pill-btn ${region === reg.id ? "active" : ""}`}
              onClick={() => {
                setRegion(reg.id);
                setFocusedId(null);
              }}
            >
              {reg.label}
            </button>
          ))}
        </div>

        {/* Telemetry Display Mode Switcher */}
        <div className="deck-segment-group" role="group" aria-label="Telemetry Display Metric">
          <button
            type="button"
            className={`deck-pill-btn ${mode === "temperature" ? "active" : ""}`}
            onClick={() => setMode("temperature")}
            title="Display Surface Temperature"
          >
            🌡️ Temp
          </button>
          <button
            type="button"
            className={`deck-pill-btn ${mode === "health" ? "active" : ""}`}
            onClick={() => setMode("health")}
            title="Display Sensor Health Percentage"
          >
            🩺 Health
          </button>
          <button
            type="button"
            className={`deck-pill-btn ${mode === "pressure" ? "active" : ""}`}
            onClick={() => setMode("pressure")}
            title="Display Atmospheric Barometric Pressure"
          >
            💨 Baro
          </button>
          <button
            type="button"
            className={`deck-pill-btn ${mode === "humidity" ? "active" : ""}`}
            onClick={() => setMode("humidity")}
            title="Display Relative Humidity Percentage"
          >
            💧 Humidity
          </button>
          <button
            type="button"
            className={`deck-pill-btn ${mode === "reporting" ? "active" : ""}`}
            onClick={() => setMode("reporting")}
            title="Display Quality & Cadence"
          >
            🛰️ Signal
          </button>
        </div>

        {/* Cartography Basemap & Layer Tools */}
        <div className="deck-tools-group">
          <div className="deck-segment-group" role="group" aria-label="Map Cartography Base">
            <button
              type="button"
              className={`deck-pill-btn ${basemap === "apple" ? "active" : ""}`}
              onClick={() => setBasemap("apple")}
              title="Apple Pastel Relief Cartography"
            >
              🗺️ Apple Map
            </button>
            <button
              type="button"
              className={`deck-pill-btn ${basemap === "satellite" ? "active" : ""}`}
              onClick={() => setBasemap("satellite")}
              title="High-Resolution Satellite Imagery"
            >
              🛰️ Sat
            </button>
            <button
              type="button"
              className={`deck-pill-btn ${basemap === "dark" ? "active" : ""}`}
              onClick={() => setBasemap("dark")}
              title="Command Center Dark Canvas"
            >
              🌌 Dark
            </button>
          </div>

          <button
            type="button"
            className={`deck-tool-btn ${radarEnabled ? "active" : ""}`}
            onClick={() => setRadarEnabled(!radarEnabled)}
            title="Toggle Live RainViewer Doppler Cloud Radar Stream"
          >
            🌧️ Radar
            {radarEnabled && <span className="active-dot-live" />}
          </button>

          <button
            type="button"
            className={`deck-tool-btn ${thermalEnabled ? "active" : ""}`}
            onClick={() => setThermalEnabled(!thermalEnabled)}
            title="Toggle Subcontinental Surface Thermal Heatmap"
          >
            🌡️ Thermal
            {thermalEnabled && <span className="active-dot-live orange" />}
          </button>

          <button
            type="button"
            className="deck-tool-btn"
            onClick={() => {
              setRegion("all");
              setFocusedId(null);
            }}
            title="Recenter to Indian Subcontinent Overview"
          >
            🎯 Recenter
          </button>
        </div>
      </div>

      {error ? <p className="state error">{error}</p> : null}

      {/* Station Status Points Meaning Legend */}
      <div className="map-legend-bar network-legend-bar">
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

      {/* 3. Split Map & Telemetry Inspector Layout */}
      <div className="network-split-layout">
        {/* Map Container — completely clear of overlapping pills! */}
        <div className="network-map-card">
          <MapPanel
            stations={mapStations}
            selectedId={focusedId}
            mode={mode}
            onSelect={setFocusedId}
            isDark={isDark}
            regionProp={region}
            basemapProp={basemap}
            radarEnabledProp={radarEnabled}
            thermalEnabledProp={thermalEnabled}
            hideFloatingTopControls={true}
          />
        </div>

        {/* Selected Station Telemetry Sidebar */}
        <div className="network-telemetry-sidebar">
          {selected ? (
            <section className="station-focus-card">
              <div className="focus-header">
                <div>
                  <span className="focus-eyebrow">SELECTED STATION</span>
                  <h2 className="focus-title">{selected.name}</h2>
                  <span className="focus-id-tag">{selected.station_id}</span>
                </div>
                <StatusBadge status={selected.status}>
                  {selected.status} • {percent(selected.health, 1)}
                </StatusBadge>
              </div>

              <div className="focus-coords">
                <span>📍 Lat: {number(selected.lat, 3)}°N</span>
                <span>Lon: {number(selected.lon, 3)}°E</span>
                {focusedLoading && <span className="focus-loading-tag">Updating...</span>}
              </div>

              <div className="focus-telemetry-grid">
                <TelemetryCard
                  label="Temperature"
                  value={latest.T}
                  unit="°C"
                  status={channelStatus(latestVerdict, "T", "Normal")}
                  values={activeTimeseries.map((row) => row.T)}
                />
                <TelemetryCard
                  label="Atmospheric Pressure"
                  value={latest.P}
                  unit="hPa"
                  status={channelStatus(latestVerdict, "P", "Normal")}
                  values={activeTimeseries.map((row) => row.P)}
                />
                <TelemetryCard
                  label="Relative Humidity"
                  value={latest.U}
                  unit="%"
                  status={channelStatus(latestVerdict, "U", "Normal")}
                  values={activeTimeseries.map((row) => row.U)}
                />
                <TelemetryCard
                  label="Wind Velocity"
                  value={latest.F}
                  unit="m/s"
                  status={channelStatus(latestVerdict, "F", "Normal")}
                  values={activeTimeseries.map((row) => row.F)}
                />
              </div>

              <div className="focus-actions">
                <a
                  href={`/stations/${encodeURIComponent(selected.station_id)}`}
                  className="btn-deep-dive"
                >
                  Diagnostic Station Dossier →
                </a>
                <a
                  href={`/stations/${encodeURIComponent(selected.station_id)}/pressure`}
                  className="btn-heartbeat"
                >
                  Pressure Waveform Heartbeat
                </a>
              </div>
            </section>
          ) : (
            <div className="empty-selection-card">
              <p>Click any station marker on the map to inspect live telemetry.</p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}