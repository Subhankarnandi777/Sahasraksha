import { MapContainer, Marker, Popup, TileLayer, ZoomControl } from "react-leaflet";
import L from "leaflet";
import { daysToThreshold, number, percent, timeAgo } from "../services/api.js";

const INDIA_CENTER = [22.8, 79.2];

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
      ? "No Data"
      : `${number(station.latest_temperature, 1)}°C`;
  }
  if (mode === "pressure") {
    return station.latest_pressure === null || station.latest_pressure === undefined
      ? "No Data"
      : `${number(station.latest_pressure, 1)} hPa`;
  }
  if (mode === "reporting") {
    if (station.data_quality === "low_confidence") return "Low Conf";
    if (!station.last_seen) return "No Data";
    return station.data_quality === "good" ? "Reporting" : station.data_quality;
  }
  return station.station_id;
}

function markerIcon(station, mode) {
  return L.divIcon({
    className: "",
    html: `<span class="osm-marker ${markerClass(station)}"><span>${markerLabel(station, mode)}</span></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -8]
  });
}

function isMappable(station) {
  const lat = Number(station.lat);
  const lon = Number(station.lon);
  return Number.isFinite(lat) && Number.isFinite(lon);
}

export default function MapPanel({ stations, selectedId, mode = "health" }) {
  const mappableStations = stations.filter(isMappable);

  return (
    <section className="map-panel">
      <div className="map-legend">
        <span><i className="ok" />OK</span>
        <span><i className="schedule" />Schedule</span>
        <span><i className="monitor" />Monitor</span>
        <span><i className="service-now" />Service Now</span>
        <span><i className="low-confidence" />Low Confidence</span>
      </div>
      <div className="india-map" aria-label="Station network map">
        <MapContainer
          center={INDIA_CENTER}
          zoom={4}
          minZoom={3}
          maxZoom={12}
          scrollWheelZoom={false}
          zoomControl={false}
          className="leaflet-map"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ZoomControl position="topright" />
          {mappableStations.map((station) => (
            <Marker
              key={station.station_id}
              position={[Number(station.lat), Number(station.lon)]}
              icon={markerIcon(station, mode)}
              zIndexOffset={selectedId === station.station_id ? 500 : 0}
            >
              <Popup>
                <div className="station-popup">
                  <strong>{station.station_id}</strong>
                  <h3>{station.name}</h3>
                  <p>Status: {station.status}</p>
                  {station.data_quality === "low_confidence" ? <p>Data quality: Low confidence</p> : null}
                  <p>Health: {percent(station.health, 1)}</p>
                  <p>Temperature: {station.latest_temperature === null || station.latest_temperature === undefined ? "No Data" : `${number(station.latest_temperature, 1)}°C`}</p>
                  <p>Pressure: {station.latest_pressure === null || station.latest_pressure === undefined ? "No Data" : `${number(station.latest_pressure, 1)} hPa`}</p>
                  <p>Humidity: {station.latest_humidity === null || station.latest_humidity === undefined ? "No Data" : `${number(station.latest_humidity, 1)}%`}</p>
                  <p>Degradation: {percent(station.degradation, 1)}</p>
                  <p>Trend: {number(station.trend_per_day, 3)} / day</p>
                  <p>Threshold: {daysToThreshold(station.days_to_threshold)}</p>
                  <p>Last seen: {timeAgo(station.last_seen)}</p>
                  <a href={`/stations/${encodeURIComponent(station.station_id)}`}>Open station detail</a>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
        {!mappableStations.length ? <p className="map-empty">No station coordinates available.</p> : null}
      </div>
    </section>
  );
}
