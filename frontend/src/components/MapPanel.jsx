import { useEffect, useMemo, useRef, useState } from "react";
import { Circle, MapContainer, Marker, TileLayer, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import { daysToThreshold, effectiveStatus, isSilent, networkReferenceTime, number, percent, timeAgo } from "../services/api.js";
import { getStationImage } from "../services/stationImages.js";

const INDIA_CENTER = [21.8, 80.5];
const DEFAULT_ZOOM = 5;

const REGIONS = {
  all: { center: [21.8, 80.5], zoom: 5, label: "All India" },
  north: { center: [29.5, 77.5], zoom: 6, label: "North" },
  south: { center: [13.2, 78.5], zoom: 6, label: "South" },
  east: { center: [23.5, 87.5], zoom: 6, label: "East" },
  west: { center: [20.5, 73.5], zoom: 6, label: "West" }
};

// Automatic Leaflet Canvas Size Recalculation
function MapResizer({ basemap }) {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    const timers = [50, 150, 400, 800, 1500].map((ms) =>
      setTimeout(() => map.invalidateSize(), ms)
    );

    let ro;
    try {
      const container = map.getContainer();
      if (window.ResizeObserver && container) {
        ro = new ResizeObserver(() => map.invalidateSize());
        ro.observe(container);
      }
    } catch {
      // Fallback handled by resize listener
    }

    const handleResize = () => map.invalidateSize();
    window.addEventListener("resize", handleResize);
    return () => {
      timers.forEach(clearTimeout);
      if (ro) ro.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, [map, basemap]);
  return null;
}

// Apple Smooth Map Flight Controller
function MapController({ targetCenter, targetZoom }) {
  const map = useMap();
  useEffect(() => {
    if (targetCenter && targetZoom) {
      map.flyTo(targetCenter, targetZoom, {
        duration: 1.2,
        easeLinearity: 0.25
      });
    }
  }, [map, targetCenter, targetZoom]);
  return null;
}

// Exposes Leaflet Map instance to external Apple floating controls
function MapInstanceBridge({ setMapInstance }) {
  const map = useMap();
  useEffect(() => {
    setMapInstance(map);
  }, [map, setMapInstance]);
  return null;
}

function stationStatusClass(status) {
  if (status === "SERVICE NOW") return "service-now";
  if (status === "SCHEDULE") return "schedule";
  if (status === "MONITOR") return "monitor";
  return "ok";
}

function markerClass(station, referenceTime) {
  if (station.data_quality === "low_confidence") return "low-confidence";
  return stationStatusClass(effectiveStatus(station, referenceTime));
}

function markerLabel(station, mode) {
  if (mode === "temperature") {
    return station.latest_temperature !== null && station.latest_temperature !== undefined
      ? `${number(station.latest_temperature, 0)}°`
      : "";
  }
  if (mode === "pressure") {
    return station.latest_pressure !== null && station.latest_pressure !== undefined
      ? `${number(station.latest_pressure, 0)}`
      : "";
  }
  if (mode === "humidity") {
    return station.latest_humidity !== null && station.latest_humidity !== undefined
      ? `${number(station.latest_humidity, 0)}%`
      : "";
  }
  if (mode === "reporting") {
    return station.data_quality === "low_confidence" ? "Low" : "";
  }
  // health mode: properly converts 1.0 (or 0.98) to 100% (or 98%)
  if (mode === "health") {
    const healthVal = Number(station.health);
    if (Number.isNaN(healthVal)) return "100%";
    const h = Math.round(healthVal <= 1 ? healthVal * 100 : healthVal);
    return `${h}%`;
  }
  return "";
}

// Clean Animated Radar Beacon Dot Marker (User's preferred clean animation)
function createRadarDotMarkerIcon(station, mode, isSelected, referenceTime) {
  const label = markerLabel(station, mode);
  const statusCls = markerClass(station, referenceTime);
  const selectedClass = isSelected ? "selected-ping" : "";

  return L.divIcon({
    className: "radar-marker-anchor",
    html: `
      <div class="custom-station-pin ${statusCls} ${selectedClass}" data-id="${station.station_id}" title="${station.name}: ${label || effectiveStatus(station, referenceTime)}">
        <span class="pin-radar-wave"></span>
        <span class="pin-dot"></span>
        ${label ? `<span class="pin-badge">${label}</span>` : ""}
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16]
  });
}

function isMappable(station) {
  const lat = Number(station.lat);
  const lon = Number(station.lon);
  return Number.isFinite(lat) && Number.isFinite(lon);
}

function getThermalColor(temp) {
  if (temp === null || temp === undefined) return "#f59e0b";
  const t = Number(temp);
  if (t < 16) return "#0284c7"; // Cool Sky Blue (<16°C)
  if (t < 22) return "#10b981"; // Mild Emerald (16-22°C)
  if (t < 28) return "#f59e0b"; // Warm Amber (22-28°C)
  if (t < 33) return "#ea580c"; // Solar Orange (28-33°C)
  return "#dc2626";             // Extreme Heat (>33°C)
}

export default function MapPanel({
  stations = [],
  selectedId,
  mode = "temperature",
  onSelect,
  isDark = false,
  regionProp,
  basemapProp,
  radarEnabledProp,
  thermalEnabledProp,
  hideFloatingTopControls = false,
  onRadarStatusChange
}) {
  // 'apple': Clean unwatermarked Esri World Topo (Pastel relief terrain)
  // 'satellite': High-resolution Esri Imagery with places
  // 'dark': High-tech Command Dark Canvas
  const [internalBasemap, setInternalBasemap] = useState(isDark ? "dark" : "apple");
  const basemap = basemapProp !== undefined ? basemapProp : internalBasemap;
  const setBasemap = setInternalBasemap;

  const [activeMode, setActiveMode] = useState(mode || "temperature");

  const [internalRadar, setInternalRadar] = useState(false);
  const radarEnabled = radarEnabledProp !== undefined ? radarEnabledProp : internalRadar;
  const setRadarEnabled = setInternalRadar;

  const [internalThermal, setInternalThermal] = useState(false);
  const thermalEnabled = thermalEnabledProp !== undefined ? thermalEnabledProp : internalThermal;
  const setThermalEnabled = setInternalThermal;

  const [radarLayerUrl, setRadarLayerUrl] = useState(null);
  const [radarTimestamp, setRadarTimestamp] = useState(null);
  const [regionTarget, setRegionTarget] = useState(REGIONS.all);
  const [mapInstance, setMapInstance] = useState(null);

  // Search filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef(null);
  const searchInputRef = useRef(null);

  // Small card UI states (position docking & minimization & explicit dismiss)
  const [cardDockSide, setCardDockSide] = useState("left"); // 'left' or 'right'
  const [cardMinimized, setCardMinimized] = useState(false);
  const [cardDismissed, setCardDismissed] = useState(false);

  // Synchronize mode with parent if prop updates
  useEffect(() => {
    if (mode) setActiveMode(mode);
  }, [mode]);

  // Synchronize basemap with dark theme
  useEffect(() => {
    if (isDark) {
      setInternalBasemap("dark");
    } else {
      setInternalBasemap("apple");
    }
  }, [isDark]);

  // Handle external region prop changes
  useEffect(() => {
    if (regionProp && REGIONS[regionProp]) {
      setRegionTarget(REGIONS[regionProp]);
      if (mapInstance) {
        mapInstance.flyTo(REGIONS[regionProp].center, REGIONS[regionProp].zoom, {
          duration: 1.2,
          easeLinearity: 0.25
        });
      }
    }
  }, [regionProp, mapInstance]);

  // Handle selection changes (fly to station and reset dismissed state)
  useEffect(() => {
    if (selectedId) {
      setCardDismissed(false);
      if (mapInstance) {
        const station = stations.find((s) => s.station_id === selectedId);
        if (station && isMappable(station)) {
          mapInstance.flyTo([Number(station.lat), Number(station.lon)], 8, {
            duration: 1.2,
            easeLinearity: 0.25
          });
        }
      }
    }
  }, [selectedId, mapInstance, stations]);

  const mappableStations = useMemo(() => stations.filter(isMappable), [stations]);

  // Same network-clock reference the dashboard's own "N stations silent"
  // banner uses -- so a station is judged silent relative to how recently
  // its peers reported, not the browser's wall clock (which would be
  // wrong for a replayed historical dataset).
  const referenceTime = useMemo(() => networkReferenceTime(stations), [stations]);

  // For the bottom-left mini-HUD's "Live Telemetry" claim -- shown only
  // when nothing is selected, so it's the map's own ambient status line.
  const silentCount = useMemo(
    () => stations.filter((s) => isSilent(s, referenceTime)).length,
    [stations, referenceTime]
  );

  // Selected station object
  const activeStation = useMemo(
    () => stations.find((s) => s.station_id === selectedId) || null,
    [stations, selectedId]
  );

  // Filtered station suggestions for Apple Search Bar
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return mappableStations
      .filter(
        (s) =>
          (s.name || "").toLowerCase().includes(q) ||
          (s.station_id || "").toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [mappableStations, searchQuery]);

  // Fetch Live Weather Doppler Radar from RainViewer API
  useEffect(() => {
    let cancelled = false;
    fetch("https://api.rainviewer.com/public/weather-maps.json")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const pastFrames = data?.radar?.past;
        if (pastFrames && pastFrames.length > 0) {
          const latest = pastFrames[pastFrames.length - 1];
          setRadarLayerUrl(`${data.host}${latest.path}/256/{z}/{x}/{y}/2/1_1.png`);
          setRadarTimestamp(
            new Date(latest.time * 1000).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit"
            })
          );
          // Told the caller so a page-level pill can honestly say "Radar
          // Live" only once a real frame is actually in hand -- not just
          // because the toggle is on (see onRadarStatusChange(false) in
          // the catch below for the failure case).
          onRadarStatusChange?.(true);
        } else {
          onRadarStatusChange?.(false);
        }
      })
      .catch((err) => {
        console.warn("RainViewer radar notice:", err.message);
        onRadarStatusChange?.(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onRadarStatusChange]);

  // Handle station selection from search or marker
  const handleSelectStation = (station) => {
    onSelect?.(station.station_id);
    setCardDismissed(false);
    setSearchQuery("");
    setSearchOpen(false);
    setCardMinimized(false);
    if (mapInstance && isMappable(station)) {
      mapInstance.flyTo([Number(station.lat), Number(station.lon)], 8, {
        duration: 1.2,
        easeLinearity: 0.25
      });
    }
  };

  // Explicit close handler for datacard cross button: dismisses and zooms out to previous subcontinent view
  const handleCloseCard = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setCardDismissed(true);
    onSelect?.(null);
    if (mapInstance) {
      mapInstance.flyTo(INDIA_CENTER, DEFAULT_ZOOM, {
        duration: 1.2,
        easeLinearity: 0.25
      });
    }
  };

  // Recenter to Subcontinent
  const handleRecenter = () => {
    setRegionTarget(REGIONS.all);
    if (mapInstance) {
      mapInstance.flyTo(INDIA_CENTER, DEFAULT_ZOOM, {
        duration: 1.2,
        easeLinearity: 0.25
      });
    }
  };

  // Image for selected station
  const stationImage = activeStation ? getStationImage(activeStation.name) : null;
  const showDetailCard = activeStation && !cardDismissed;

  return (
    <div className="apple-map-container" aria-label="Sahasraksha Apple Map Canvas">
      {/* =========================================================================
          FLOATING APPLE DYNAMIC ISLANDS (Only rendered when not using external toolbar)
          ========================================================================= */}
      {!hideFloatingTopControls && (
        <div className="apple-top-nav-bar">
          {/* Left: Search with Autocomplete Dropdown */}
          <div className="apple-top-nav-left" ref={searchRef}>
            <div className="apple-search-pill">
              <span className="apple-search-icon">🔍</span>
              <input
                ref={searchInputRef}
                type="text"
                className="apple-search-input"
                placeholder="Search AWS nodes..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && searchResults.length > 0) {
                    handleSelectStation(searchResults[0]);
                  }
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="apple-search-clear"
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
                className="apple-search-action-btn"
                onClick={() => {
                  if (searchResults.length > 0) {
                    handleSelectStation(searchResults[0]);
                  } else if (searchInputRef.current) {
                    searchInputRef.current.focus();
                    setSearchOpen(true);
                  }
                }}
                title="Search Station"
              >
                Search
              </button>
            </div>

            {/* Live Search Autocomplete Dropdown */}
            {searchOpen && searchResults.length > 0 && (
              <div className="apple-search-dropdown">
                <div className="apple-dropdown-header">MATCHING AWS NODES</div>
                {searchResults.map((st) => (
                  <button
                    key={st.station_id}
                    type="button"
                    className="apple-dropdown-item"
                    onClick={() => handleSelectStation(st)}
                  >
                    <span className={`apple-dropdown-dot ${markerClass(st, referenceTime)}`} />
                    <div className="apple-dropdown-info">
                      <strong>{st.name}</strong>
                      <small>{st.station_id}</small>
                    </div>
                    <span className="apple-dropdown-val">
                      {st.latest_temperature !== null && st.latest_temperature !== undefined
                        ? `${number(st.latest_temperature, 1)}°`
                        : "--"}
                      {st.latest_humidity !== null && st.latest_humidity !== undefined
                        ? ` • ${number(st.latest_humidity, 0)}%`
                        : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Center: Subcontinent Region Focus Pills */}
          <div className="apple-region-strip">
            {Object.entries(REGIONS).map(([key, reg]) => (
              <button
                key={key}
                type="button"
                className={`apple-region-pill ${regionTarget.label === reg.label ? "active" : ""}`}
                onClick={() => setRegionTarget(reg)}
              >
                {reg.label}
              </button>
            ))}
          </div>

          {/* Right: Cartography Basemap & Quick Action Stack */}
          <div className="apple-top-nav-right">
            <div className="apple-segmented-capsule">
              <button
                type="button"
                className={basemap === "apple" ? "active" : ""}
                onClick={() => setBasemap("apple")}
                title="Apple Pastel Relief Cartography"
              >
                🗺️ Map
              </button>
              <button
                type="button"
                className={basemap === "satellite" ? "active" : ""}
                onClick={() => setBasemap("satellite")}
                title="High-Resolution Satellite"
              >
                🛰️ Sat
              </button>
              <button
                type="button"
                className={basemap === "dark" ? "active" : ""}
                onClick={() => setBasemap("dark")}
                title="Command Center Dark Canvas"
              >
                🌌 Dark
              </button>
            </div>

            <div className="apple-action-btn-row">
              {/* Live Doppler Radar Toggle */}
              <button
                type="button"
                className={`apple-glass-circle-btn ${radarEnabled ? "active-radar" : ""}`}
                onClick={() => setRadarEnabled(!radarEnabled)}
                title="Toggle Live RainViewer Doppler Radar Cloud Stream"
              >
                <span className="btn-icon">🌧️</span>
                {radarEnabled && <span className="active-glow-dot" />}
              </button>

              {/* Thermal Heatmap Toggle */}
              <button
                type="button"
                className={`apple-glass-circle-btn ${thermalEnabled ? "active-thermal" : ""}`}
                onClick={() => setThermalEnabled(!thermalEnabled)}
                title="Toggle Subcontinental Thermal Heatmap"
              >
                <span className="btn-icon">🌡️</span>
                {thermalEnabled && <span className="active-glow-dot orange" />}
              </button>

              {/* Recenter Location Button */}
              <button
                type="button"
                className="apple-glass-circle-btn"
                onClick={handleRecenter}
                title="Recenter Subcontinent Overview"
              >
                <span className="btn-icon">📍</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          4. LEAFLET MAP CANVAS (EDGE-TO-EDGE)
          ========================================================================= */}
      <div className="apple-map-viewport">
        <MapContainer
          key={`apple-subcontinent-${basemap}`}
          center={INDIA_CENTER}
          zoom={DEFAULT_ZOOM}
          minZoom={3}
          maxZoom={18}
          scrollWheelZoom={false}
          zoomControl={false}
          className={`leaflet-map apple-basemap-${basemap}`}
        >
          <MapResizer basemap={basemap} />
          <MapController targetCenter={regionTarget.center} targetZoom={regionTarget.zoom} />
          <MapInstanceBridge setMapInstance={setMapInstance} />

          {/* 🗺️ Apple Map / Topo Canvas (100% Free, NO API Key watermark) */}
          {basemap === "apple" && (
            <TileLayer
              key="tile-esri-topo-clean"
              attribution='&copy; <a href="https://www.esri.com/">Esri</a> &mdash; Sahasraksha Cartography'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"
              maxNativeZoom={15}
              maxZoom={18}
            />
          )}

          {/* 🛰️ High-Resolution Satellite with Boundaries */}
          {basemap === "satellite" && (
            <>
              <TileLayer
                key="tile-esri-sat"
                attribution='Tiles &copy; Esri'
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                maxNativeZoom={16}
                maxZoom={18}
              />
              <TileLayer
                key="tile-esri-sat-labels"
                attribution='&copy; Esri Places'
                url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
                opacity={0.8}
                maxNativeZoom={16}
                maxZoom={18}
              />
            </>
          )}

          {/* 🌌 High-Tech Command Dark Canvas (100% Free, NO Watermark) */}
          {basemap === "dark" && (
            <>
              <TileLayer
                key="tile-dark-canvas-base"
                attribution='&copy; <a href="https://www.esri.com/">Esri</a> &mdash; Dark Command'
                url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
                maxNativeZoom={15}
                maxZoom={18}
              />
              <TileLayer
                key="tile-dark-canvas-ref"
                attribution='&copy; Esri'
                url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
                opacity={0.8}
                maxNativeZoom={15}
                maxZoom={18}
              />
            </>
          )}

          {/* 🌡️ Dynamic Thermal Heat Surface Field */}
          {/* A station with no temperature reading (SWAMI VIVEKANANDA /
              42875099999 has no archived data at all) has nothing to
              plot here -- getThermalColor(null) used to fall back to the
              SAME amber as a genuine 22-28C reading, painting an 85km
              "warm" blob for a station that has never reported a
              temperature. Omitted entirely rather than given an
              invented color. */}
          {thermalEnabled &&
            mappableStations
              .filter(
                (station) =>
                  station.latest_temperature !== null && station.latest_temperature !== undefined
              )
              .map((station) => {
              const temp = station.latest_temperature;
              const color = getThermalColor(temp);
              return (
                <Circle
                  key={`thermal-circle-${station.station_id}`}
                  center={[Number(station.lat), Number(station.lon)]}
                  radius={85000}
                  pathOptions={{
                    color: "transparent",
                    fillColor: color,
                    fillOpacity: 0.35
                  }}
                >
                  <Tooltip sticky>
                    <div className="thermal-tooltip">
                      <strong>{station.name}</strong>
                      <span>
                        Surface Temp: <b>{temp !== null ? `${number(temp, 1)}°C` : "--"}</b>
                      </span>
                    </div>
                  </Tooltip>
                </Circle>
              );
            })}

          {/* 🌧️ Live RainViewer Doppler Weather Radar Stream */}
          {radarEnabled && radarLayerUrl && (
            <TileLayer
              key="tile-weather-radar"
              url={radarLayerUrl}
              opacity={0.72}
              zIndex={400}
              attribution='Radar &copy; <a href="https://www.rainviewer.com/" target="_blank" rel="noreferrer">RainViewer</a>'
            />
          )}

          {/* 60 AWS Station Radar Beacon Dot Markers (Clean Animated Radar Pulse) */}
          {mappableStations.map((station) => {
            const isSelected = selectedId === station.station_id;
            return (
              <Marker
                key={station.station_id}
                position={[Number(station.lat), Number(station.lon)]}
                icon={createRadarDotMarkerIcon(station, activeMode, isSelected, referenceTime)}
                eventHandlers={{
                  click: () => {
                    handleSelectStation(station);
                  }
                }}
              />
            );
          })}
        </MapContainer>
      </div>

      {/* =========================================================================
          5. ADJUSTABLE FLOATING APPLE DETAIL CARD (CLEAN, DOCKABLE & DISMISSIBLE)
          ========================================================================= */}
      {showDetailCard && (
        <div
          className={`apple-floating-detail-sheet dock-${cardDockSide} ${
            cardMinimized ? "is-minimized" : ""
          }`}
        >
          {/* Minimized Pill View */}
          {cardMinimized ? (
            <div className="sheet-minimized-pill">
              <span className={`sheet-status-dot ${markerClass(activeStation, referenceTime)}`} />
              <strong className="minimized-title">{activeStation.name}</strong>
              <span className="minimized-temp">
                {activeStation.latest_temperature !== null &&
                activeStation.latest_temperature !== undefined
                  ? `${number(activeStation.latest_temperature, 1)}°C`
                  : "--"}
              </span>
              <button
                type="button"
                className="sheet-mini-btn"
                onClick={() => setCardMinimized(false)}
                title="Expand Details"
              >
                ⤢
              </button>
              <button
                type="button"
                className="sheet-mini-btn close"
                onClick={handleCloseCard}
                title="Close"
              >
                ✕
              </button>
            </div>
          ) : (
            /* Full Sleek Apple Weather Card */
            <>
              <div className="sheet-image-container">
                <img
                  src={stationImage?.url}
                  alt={activeStation.name}
                  className="sheet-backdrop-img"
                  onError={(e) => {
                    e.currentTarget.src =
                      "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=600&q=80";
                  }}
                />
                <div className="sheet-image-scrim" />

                {/* Card Control Buttons (Dock side toggle, Minimize, Close) */}
                <div className="sheet-top-actions">
                  <button
                    type="button"
                    className="sheet-icon-btn"
                    onClick={() =>
                      setCardDockSide(cardDockSide === "left" ? "right" : "left")
                    }
                    title={
                      cardDockSide === "left"
                        ? "Dock to Bottom Right"
                        : "Dock to Bottom Left"
                    }
                  >
                    {cardDockSide === "left" ? "⇄ Right" : "⇄ Left"}
                  </button>
                  <button
                    type="button"
                    className="sheet-icon-btn"
                    onClick={() => setCardMinimized(true)}
                    title="Minimize to Pill"
                  >
                    _
                  </button>
                  <button
                    type="button"
                    className="sheet-icon-btn close"
                    onClick={handleCloseCard}
                    title="Close Inspector"
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>

                <div className="sheet-image-content">
                  <div className="sheet-pill-badge">
                    <span className={`sheet-status-dot ${markerClass(activeStation, referenceTime)}`} />
                    <span>{effectiveStatus(activeStation, referenceTime) || "NOMINAL"}</span>
                    <span>•</span>
                    <span>{percent(activeStation.health, 0)}</span>
                  </div>
                  <h3 className="sheet-station-title">{activeStation.name}</h3>
                  <p className="sheet-landmark-caption">
                    {stationImage?.landmark || "Indian Meteorological AWS"}
                  </p>
                </div>
              </div>

              <div className="sheet-body">
                {/* Big Apple Weather Temperature & Condition */}
                <div className="sheet-hero-metric">
                  <div className="sheet-big-temp">
                    {activeStation.latest_temperature !== null &&
                    activeStation.latest_temperature !== undefined
                      ? `${number(activeStation.latest_temperature, 1)}°`
                      : "--°"}
                    <span className="sheet-temp-unit">C</span>
                  </div>
                  <div className="sheet-hero-details">
                    <div className="sheet-condition-text">
                      {activeStation.latest_temperature === null ||
                      activeStation.latest_temperature === undefined
                        ? "📡 Awaiting Telemetry"
                        : activeStation.latest_temperature > 30
                        ? "☀️ High Solar Radiation"
                        : activeStation.latest_temperature < 15
                        ? "❄️ Montane Cold Airflow"
                        : "🌤️ Nominal Atmosphere"}
                    </div>
                    <div className="sheet-coords-text">
                      📍 {number(activeStation.lat, 2)}°N, {number(activeStation.lon, 2)}°E •{" "}
                      {timeAgo(activeStation.last_seen)}
                    </div>
                  </div>
                </div>

                {/* 4 Apple Glass Mini-Tiles */}
                <div className="sheet-glass-grid">
                  <div className="sheet-tile">
                    <span className="tile-label">PRESSURE</span>
                    <strong className="tile-value">
                      {number(activeStation.latest_pressure, 0)} hPa
                    </strong>
                    <span className="tile-sub">Surface Baro</span>
                  </div>
                  <div className="sheet-tile">
                    <span className="tile-label">HUMIDITY</span>
                    <strong className="tile-value">
                      {number(activeStation.latest_humidity, 0)}%
                    </strong>
                    <span className="tile-sub">Relative Dew</span>
                  </div>
                  <div className="sheet-tile">
                    <span className="tile-label">STATION ID</span>
                    <strong className="tile-value mono">{activeStation.station_id}</strong>
                    <span className="tile-sub">WMO Synoptic</span>
                  </div>
                  <div className="sheet-tile">
                    <span className="tile-label">SIGNAL</span>
                    <strong className="tile-value status-good">
                      {activeStation.data_quality === "low_confidence"
                        ? "Review"
                        : isSilent(activeStation, referenceTime)
                        ? "Silent"
                        : "Live"}
                    </strong>
                    <span className="tile-sub">Harmonic QC</span>
                  </div>
                </div>

                {/* Action CTA Pill */}
                <a
                  href={`/stations/${encodeURIComponent(activeStation.station_id)}`}
                  className="sheet-action-pill-btn"
                >
                  <span>Inspect Full Station Telemetry</span>
                  <span>→</span>
                </a>
              </div>
            </>
          )}
        </div>
      )}

      {/* =========================================================================
          6. FLOATING APPLE ZOOM PILL (BOTTOM-RIGHT)
          ========================================================================= */}
      <div className="apple-zoom-capsule">
        <button
          type="button"
          className="apple-zoom-btn"
          onClick={() => mapInstance?.zoomIn()}
          aria-label="Zoom In"
          title="Zoom In"
        >
          +
        </button>
        <div className="apple-zoom-divider" />
        <button
          type="button"
          className="apple-zoom-btn"
          onClick={() => mapInstance?.zoomOut()}
          aria-label="Zoom Out"
          title="Zoom Out"
        >
          −
        </button>
      </div>

      {/* =========================================================================
          7. DOPPLER RADAR SCALE (BOTTOM-CENTER, IF RADAR ACTIVE)
          ========================================================================= */}
      {radarEnabled && (
        <div className="apple-radar-scale-capsule">
          <div className="radar-scale-header">
            <span className="radar-live-blip" />
            <span>Live Doppler Cloud Stream {radarTimestamp ? `(${radarTimestamp})` : ""}</span>
          </div>
          <div className="radar-gradient-bar" />
          <div className="radar-scale-labels">
            <span>Light</span>
            <span>Moderate</span>
            <span>Heavy</span>
            <span>Severe</span>
          </div>
        </div>
      )}

      {/* =========================================================================
          8. MINI HUD STATUS BADGE (BOTTOM-LEFT, IF NO STATION SELECTED)
          ========================================================================= */}
      {!showDetailCard && (
        <div className="apple-mini-hud">
          <span className={`apple-hud-dot ${silentCount > 0 ? "is-degraded" : ""}`} />
          <span className="apple-hud-text">
            <b>{stations.length} Synoptic Nodes</b>
            {silentCount > 0
              ? ` • ${silentCount} Silent 6h+`
              : " • Live Telemetry • Streaming Sentinel QC"}
          </span>
        </div>
      )}
    </div>
  );
}
