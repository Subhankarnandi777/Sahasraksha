import { useEffect, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer, ZoomControl, useMap } from "react-leaflet";
import L from "leaflet";
import { daysToThreshold, number, percent, timeAgo } from "../services/api.js";

const INDIA_CENTER = [21.5, 78.5];

const REGIONS = {
  all: { center: [21.5, 78.5], zoom: 5, label: "All India" },
  north: { center: [28.6, 77.2], zoom: 6, label: "North" },
  south: { center: [13.0, 77.6], zoom: 6, label: "South" },
  east: { center: [22.5, 88.3], zoom: 6, label: "East" },
  west: { center: [19.0, 72.8], zoom: 6, label: "West" }
};

// Ensures map canvas recalculates its bounding box and fills 100% of height without blank tiles
function MapResizer({ basemap }) {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    const t1 = setTimeout(() => map.invalidateSize(), 50);
    const t2 = setTimeout(() => map.invalidateSize(), 150);
    const t3 = setTimeout(() => map.invalidateSize(), 400);
    const t4 = setTimeout(() => map.invalidateSize(), 800);
    const t5 = setTimeout(() => map.invalidateSize(), 1500);

    let ro;
    try {
      const container = map.getContainer();
      if (window.ResizeObserver && container) {
        ro = new ResizeObserver(() => {
          map.invalidateSize();
        });
        ro.observe(container);
      }
    } catch {
      // Fallback handled by resize listener
    }

    const handleResize = () => map.invalidateSize();
    window.addEventListener("resize", handleResize);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      clearTimeout(t5);
      if (ro) ro.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, [map, basemap]);
  return null;
}

function MapController({ targetCenter, targetZoom }) {
  const map = useMap();
  useEffect(() => {
    if (targetCenter && targetZoom) {
      map.flyTo(targetCenter, targetZoom, { duration: 1.2 });
    }
  }, [map, targetCenter, targetZoom]);
  return null;
}

function stationStatusClass(status) {
  if (status === "SERVICE NOW") return "service-now";
  if (status === "SCHEDULE") return "schedule";
  if (status === "MONITOR") return "monitor";
  return "ok";
}

function markerClass(station) {
  if (station.data_quality === "low_confidence") return "low-confidence";
  return stationStatusClass(station.status);
}

function markerLabel(station, mode) {
  if (mode === "temperature") {
    return station.latest_temperature === null || station.latest_temperature === undefined
      ? ""
      : `${number(station.latest_temperature, 0)}°`;
  }
  if (mode === "pressure") {
    return station.latest_pressure === null || station.latest_pressure === undefined
      ? ""
      : `${number(station.latest_pressure, 0)}`;
  }
  if (mode === "reporting") {
    if (station.data_quality === "low_confidence") return "Low";
    if (!station.last_seen) return "";
    return station.data_quality === "good" ? "✓" : "";
  }
  return "";
}

function markerIcon(station, mode, isSelected) {
  const label = markerLabel(station, mode);
  const selectedClass = isSelected ? "selected-ping" : "";
  return L.divIcon({
    className: "",
    html: `
      <div class="custom-station-pin ${markerClass(station)} ${selectedClass}">
        <span class="pin-dot"></span>
        ${label ? `<span class="pin-badge">${label}</span>` : ""}
      </div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12]
  });
}

function isMappable(station) {
  const lat = Number(station.lat);
  const lon = Number(station.lon);
  return Number.isFinite(lat) && Number.isFinite(lon);
}

export default function MapPanel({ stations, selectedId, mode = "health", onSelect }) {
  // 'street' (Esri World Street Map - 100% Free, zero watermarks)
  // 'satellite' (Esri High-Res Imagery)
  // 'osm' (OpenStreetMap)
  const [basemap, setBasemap] = useState("street");
  const [radarEnabled, setRadarEnabled] = useState(true);
  const [radarLayerUrl, setRadarLayerUrl] = useState(null);
  const [radarTimestamp, setRadarTimestamp] = useState(null);
  const [regionTarget, setRegionTarget] = useState(REGIONS.all);

  const mappableStations = stations.filter(isMappable);

  // Fetch Live Weather Radar from RainViewer API
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
          setRadarTimestamp(new Date(latest.time * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
        }
      })
      .catch((err) => {
        console.warn("RainViewer radar notice:", err.message);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <section className="map-panel">
      {/* Top Map Control Bar */}
      <div className="map-super-toolbar">
        {/* Basemap Switcher (100% Free, Zero Key Required) */}
        <div className="map-layer-selector">
          <span className="toolbar-label">Base:</span>
          <div className="segmented-pills">
            <button
              type="button"
              className={basemap === "street" ? "active" : ""}
              onClick={() => setBasemap("street")}
            >
              🗺️ Clean Street
            </button>
            <button
              type="button"
              className={basemap === "satellite" ? "active" : ""}
              onClick={() => setBasemap("satellite")}
            >
              🛰️ Satellite
            </button>
            <button
              type="button"
              className={basemap === "osm" ? "active" : ""}
              onClick={() => setBasemap("osm")}
            >
              🌐 OpenStreetMap
            </button>
          </div>
        </div>

        {/* Live Weather Radar API Toggle */}
        <div className="radar-api-control">
          <button
            type="button"
            className={`radar-toggle-btn ${radarEnabled && radarLayerUrl ? "active" : ""}`}
            onClick={() => setRadarEnabled(!radarEnabled)}
            title="Toggle Live RainViewer Doppler Radar Cloud/Precipitation Stream"
          >
            <span className="radar-live-blip" />
            <span className="radar-label">
              🌧️ Live Weather Radar {radarTimestamp ? `(${radarTimestamp})` : ""}
            </span>
            <span className="radar-switch-badge">{radarEnabled && radarLayerUrl ? "ON" : "OFF"}</span>
          </button>
        </div>

        {/* Regional Quick Jumps */}
        <div className="region-pills">
          <span className="toolbar-label">Focus:</span>
          {Object.entries(REGIONS).map(([key, reg]) => (
            <button
              key={key}
              type="button"
              className={regionTarget.label === reg.label ? "active" : ""}
              onClick={() => setRegionTarget(reg)}
            >
              {reg.label}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="map-legend">
        <span className="legend-title">Station Status:</span>
        <span><i className="ok" /> Nominal (OK)</span>
        <span><i className="schedule" /> Scheduled Drift</span>
        <span><i className="monitor" /> S2 Tide Monitor</span>
        <span><i className="service-now" /> Critical Alert</span>
        <span><i className="low-confidence" /> Low Quality</span>
      </div>

      {/* Interactive Map Container */}
      <div className="india-map" aria-label="Station network map">
        <MapContainer
          key={`subcontinent-map-${basemap}`}
          center={INDIA_CENTER}
          zoom={5}
          minZoom={3}
          maxZoom={16}
          scrollWheelZoom={false}
          zoomControl={false}
          className={`leaflet-map basemap-${basemap}`}
        >
          {/* Automatic dimension listener and size invalidation */}
          <MapResizer basemap={basemap} />
          <MapController targetCenter={regionTarget.center} targetZoom={regionTarget.zoom} />

          {/* Clean High-Resolution Esri World Street Basemap - No API Key, No Watermark */}
          {basemap === "street" && (
            <TileLayer
              key="tile-esri-street"
              attribution='&copy; <a href="https://www.esri.com/">Esri</a> &mdash; World Street Map'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"
              maxZoom={18}
            />
          )}

          {/* High-Resolution Satellite Basemap - No API Key, No Watermark */}
          {basemap === "satellite" && (
            <>
              <TileLayer
                key="tile-esri-sat-imagery"
                attribution='Tiles &copy; <a href="https://www.esri.com/">Esri</a>'
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                maxZoom={18}
              />
              <TileLayer
                key="tile-esri-sat-labels"
                attribution='&copy; Esri'
                url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
                opacity={0.8}
                maxZoom={18}
              />
            </>
          )}

          {/* Official OpenStreetMap Basemap - 100% Free Community Map */}
          {basemap === "osm" && (
            <TileLayer
              key="tile-osm-free"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              maxZoom={18}
            />
          )}

          {/* Live Weather Radar API Overlay */}
          {radarEnabled && radarLayerUrl && (
            <TileLayer
              key="tile-weather-radar"
              url={radarLayerUrl}
              opacity={0.65}
              zIndex={400}
              attribution='Weather Radar &copy; <a href="https://www.rainviewer.com/" target="_blank" rel="noreferrer">RainViewer</a>'
            />
          )}

          <ZoomControl position="bottomright" />

          {/* 60 AWS Station Markers */}
          {mappableStations.map((station) => {
            const isSelected = selectedId === station.station_id;
            return (
              <Marker
                key={station.station_id}
                position={[Number(station.lat), Number(station.lon)]}
                icon={markerIcon(station, mode, isSelected)}
                eventHandlers={{
                  click: () => onSelect?.(station.station_id)
                }}
              >
                <Popup className="station-leaflet-popup">
                  <div className="station-popup-card">
                    <div className="popup-top">
                      <span className="popup-id">{station.station_id}</span>
                      <span className={`popup-status-pill ${stationStatusClass(station.status)}`}>
                        {station.status}
                      </span>
                    </div>
                    <h3 className="popup-name">{station.name}</h3>
                    <div className="popup-metrics-grid">
                      <div className="popup-metric-item">
                        <small>Temp</small>
                        <strong>{number(station.latest_temperature, 1)}°C</strong>
                      </div>
                      <div className="popup-metric-item">
                        <small>Pressure</small>
                        <strong>{number(station.latest_pressure, 0)} hPa</strong>
                      </div>
                      <div className="popup-metric-item">
                        <small>Humidity</small>
                        <strong>{number(station.latest_humidity, 0)}%</strong>
                      </div>
                      <div className="popup-metric-item">
                        <small>Health</small>
                        <strong>{percent(station.health, 0)}</strong>
                      </div>
                    </div>
                    <div className="popup-meta-info">
                      <span>Coordinates: <b>{number(station.lat, 2)}°N, {number(station.lon, 2)}°E</b></span>
                      <span>Signal State: <b>{timeAgo(station.last_seen)}</b></span>
                    </div>
                    <a
                      href={`/stations/${encodeURIComponent(station.station_id)}`}
                      className="popup-cta-btn"
                    >
                      Open Full Station Telemetry →
                    </a>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
    </section>
  );
}
