import { useEffect, useMemo, useRef, useState } from "react";
import MapPanel from "../components/MapPanel.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import StatusLegend from "../components/StatusLegend.jsx";
import TelemetryCard from "../components/TelemetryCard.jsx";
import { anomalyReasonText, healthOrNull, number, percent, channelStatus, effectiveStatus, isSilent, networkReferenceTime, getStationTimeseries, getStationVerdicts } from "../services/api.js";
import { useTheme } from "../services/theme.js";

function markerStatusClass(status) {
  if (status === "SERVICE NOW") return "service-now";
  if (status === "SCHEDULE") return "schedule";
  if (status === "MONITOR") return "monitor";
  return "ok";
}

export default function Network({ stations = [], selectedStation, selectedStationId, timeseries = [], verdicts = [], openAlerts = [], loading, error }) {
  // Real network-average health, computed the same way Dashboard does --
  // not a fixed "99.8%" that never moves regardless of what the network
  // is actually reporting.
  // healthOrNull, not Number.isFinite(Number(...)): the latter counted the
  // three low-confidence stations' null health as 0% in this average.
  const scoredStations = stations.filter((station) => healthOrNull(station.health) !== null);
  const networkHealth = scoredStations.length
    ? scoredStations.reduce((sum, station) => sum + Number(station.health), 0) / scoredStations.length
    : 0;

  // Same staleness check the Dashboard's own tallies use -- "Nodes Online"
  // was a raw stations.length with no regard for whether a station had
  // actually reported anything recently.
  const referenceTime = networkReferenceTime(stations);
  const silentCount = stations.filter((s) => isSilent(s, referenceTime)).length;
  const onlineCount = stations.length - silentCount;

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
  // Set by MapPanel once its RainViewer fetch actually succeeds -- so the
  // "Doppler Radar Live" pill can say Live only when a real frame is in
  // hand, not just because the toggle happens to be on (it's off by
  // default) or before the fetch has even resolved.
  const [radarAvailable, setRadarAvailable] = useState(false);
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
  // openAlerts was passed into this page and never read, so a station
  // sitting at SERVICE NOW showed that badge above three "Normal" channel
  // cards with nothing to say why. Same pattern the detail page had.
  const selectedAlert = selected
    ? openAlerts.find((alert) => alert.station_id === selected.station_id) || null
    : null;
  // Same rule as the detail page: a low-confidence station's readings are
  // withheld everywhere else, so they are not shown here under "Normal".
  const withheld = selected?.data_quality === "low_confidence";
  function channelProps(channel) {
    if (withheld) {
      return { value: null, values: [], timestamps: [], status: "Withheld", emptyLabel: "Withheld: data not trusted" };
    }
    const value = latest[channel];
    return {
      value,
      values: activeTimeseries.map((row) => row[channel]),
      timestamps: activeTimeseries.map((row) => row.timestamp),
      status: value === null || value === undefined ? "No data" : channelStatus(latestVerdict, channel, "Normal")
    };
  }

  if (loading) {
    return (
      <main className="screen network-screen">
        <div className="loading-state-card">
          <div className="loading-spinner" />
          <p>Connecting to live station stream...</p>
        </div>
      </main>
    );
  }

  // "Station Network Synced" was a fixed string with no condition
  // attached -- same fabricated-nominal pattern the Dashboard's telemetry
  // pill had. Tied to this page's own error state and silent-station
  // count instead.
  const pipelineDown = Boolean(error);
  const pipelineDegraded = !pipelineDown && stations.length > 0 && silentCount >= Math.ceil(stations.length / 2);
  const pipelineLabel = pipelineDown ? "Offline" : pipelineDegraded ? "Degraded" : "Synced";
  const radarLive = radarEnabled && radarAvailable;

  return (
    <main className="screen network-screen">
      {/* 1. Page Header Strip: Title + Telemetry Vitals */}
      <div className="network-header-strip">
        <div className="header-branding-col">
          <span className="section-eyebrow">GEOSPATIAL FLEET SURVEILLANCE</span>
          <h1 className="page-main-heading">Station Network Map</h1>
          <p className="page-sub-heading">
            {loading
              ? "Loading station telemetry..."
              : silentCount > 0
              ? `${onlineCount} of ${stations.length} Synoptic AWS Nodes Active across Indian Subcontinent`
              : `${stations.length} Synoptic AWS Nodes Active across Indian Subcontinent`}
          </p>
        </div>

        {/* Real-time Atmospheric Fleet Vitals */}
        <div className="network-header-metrics">
          <div className="net-metric-pill" title="Synoptic AWS nodes that have reported within the last 6 hours">
            <span className={`net-metric-blip ${silentCount > 0 ? "amber" : "green"}`} />
            <span>
              <b>{onlineCount}</b> Nodes Online
              {silentCount > 0 ? ` (${silentCount} Silent)` : ""}
            </span>
          </div>
          <div className="net-metric-pill" title="Network-average station health score">
            <span className="net-metric-blip amber" />
            {/* Same number the Dashboard shows as Mean Station Health. */}
            <span><b>{percent(networkHealth, 1)}</b> Avg Health</span>
          </div>
          <div className="net-metric-pill" title="Live automatic weather station network feed">
            <span className={`net-metric-blip ${pipelineDown ? "red" : pipelineDegraded ? "amber" : "blue"}`} />
            <span><b>Station Network</b> {pipelineLabel}</span>
          </div>
          <div
            className="net-metric-pill"
            title={
              radarLive
                ? "RainViewer live Doppler cloud stream active"
                : radarEnabled
                ? "Waiting on RainViewer's public radar feed"
                : "Doppler radar overlay is switched off"
            }
          >
            <span className={`net-metric-blip ${radarLive ? "cyan" : ""}`} />
            <span>
              <b>Doppler</b> Radar {radarLive ? "Live" : radarEnabled ? "Connecting" : "Off"}
            </span>
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
              placeholder={`Search ${stations.length} AWS stations, cities...`}
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
                  <span className={`deck-dropdown-dot ${markerStatusClass(effectiveStatus(st, referenceTime))}`} />
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
              title="Esri World Topographic basemap"
            >
              {/* Labelled "Apple Map" -- these are Esri World Topo tiles
                  (see MapPanel and the map's own attribution line); nothing
                  here comes from Apple. */}
              🗺️ Map
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

      <StatusLegend className="network-legend-bar" />

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
            onRadarStatusChange={setRadarAvailable}
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
                <StatusBadge status={effectiveStatus(selected, referenceTime)}>
                  {effectiveStatus(selected, referenceTime)} • {percent(selected.health, 1)}
                </StatusBadge>
              </div>

              {selectedAlert ? (
                <p className="state">
                  Open alert: {selectedAlert.explanation || anomalyReasonText(selectedAlert.message)}
                </p>
              ) : null}

              <div className="focus-coords">
                <span>📍 Lat: {number(selected.lat, 3)}°N</span>
                <span>Lon: {number(selected.lon, 3)}°E</span>
                {focusedLoading && <span className="focus-loading-tag">Updating...</span>}
              </div>

              <div className="focus-telemetry-grid">
                <TelemetryCard label="Temperature" unit="°C" {...channelProps("T")} />
                <TelemetryCard label="Atmospheric Pressure" unit="hPa" {...channelProps("P")} />
                {/* Was `latest.U` / channelStatus(..., "U", ...) -- the API
                    serializes humidity as RH (TimeSeriesRow's real fields
                    are T/P/RH), never U. `U` is undefined for every
                    station, always, which is why this card only ever
                    showed "-" and "Awaiting telemetry frames..." even for
                    stations with real, live humidity data one field over
                    on StationDetail. `U`/`F` are NOAA-ISD's raw archive
                    column codes, not this app's own API contract. */}
                <TelemetryCard label="Relative Humidity" unit="%" {...channelProps("RH")} />
                {/* "Wind Velocity" removed: no wind channel exists anywhere
                    in this pipeline. The DB has wind_speed_mps/
                    wind_direction_deg columns, but nothing ever ingests or
                    serializes them -- the timeseries API never returns a
                    wind field, the ML detector never evaluates one, and
                    the only wind values in the whole codebase are on a
                    hardcoded dev seed fixture. This card showed "-" and
                    "Normal" for every station, forever -- a sensor
                    reading marked Normal when it never existed. */}
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