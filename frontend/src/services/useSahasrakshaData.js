import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getAlerts,
  getHealth,
  getStationTimeseries,
  getStationVerdicts,
  getStations
} from "./api.js";

// Fast in-memory cache to make page transitions 0ms instant
let memoryCache = {
  health: null,
  stations: null,
  alerts: null,
  timeseries: {},
  verdicts: {},
  lastFetched: 0
};

export default function useSahasrakshaData(routeStationId) {
  const [health, setHealth] = useState(memoryCache.health);
  const [stations, setStations] = useState(memoryCache.stations || []);
  const [alerts, setAlerts] = useState(memoryCache.alerts || []);
  const [timeseries, setTimeseries] = useState([]);
  const [verdicts, setVerdicts] = useState([]);
  const [loading, setLoading] = useState(!memoryCache.stations);
  const [error, setError] = useState("");

  const selectedStationId = routeStationId || stations[0]?.station_id || "";
  const selectedStation = useMemo(
    () => stations.find((station) => station.station_id === selectedStationId) || stations[0] || null,
    [selectedStationId, stations]
  );

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");

    try {
      // Single fast parallel fetch: Health, Stations, and All Alerts in 1 batch
      const [healthData, stationData, alertData] = await Promise.all([
        getHealth().catch(() => null),
        getStations().catch(() => []),
        getAlerts().catch(() => [])
      ]);

      if (healthData) {
        setHealth(healthData);
        memoryCache.health = healthData;
      }
      if (stationData && stationData.length > 0) {
        setStations(stationData);
        memoryCache.stations = stationData;
      }
      if (alertData) {
        const sorted = (alertData || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        setAlerts(sorted);
        memoryCache.alerts = sorted;
      }

      memoryCache.lastFetched = Date.now();
      setLoading(false);
    } catch (err) {
      setError(err.message || "Unable to load backend data.");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // If cache is fresh (< 30 seconds), use cache and refresh silently in background
    const isFresh = Date.now() - memoryCache.lastFetched < 30000 && memoryCache.stations;
    if (isFresh) {
      setLoading(false);
      refresh(true); // background silent refresh
    } else {
      refresh(false);
    }
  }, [refresh]);

  useEffect(() => {
    if (!selectedStationId) {
      setTimeseries([]);
      setVerdicts([]);
      return;
    }

    // Check if station timeseries is cached
    if (memoryCache.timeseries[selectedStationId]) {
      setTimeseries(memoryCache.timeseries[selectedStationId]);
      setVerdicts(memoryCache.verdicts[selectedStationId] || []);
    }

    let active = true;
    Promise.all([
      getStationTimeseries(selectedStationId).catch(() => []),
      getStationVerdicts(selectedStationId).catch(() => [])
    ]).then(([series, stationVerdicts]) => {
      if (active) {
        setTimeseries(series);
        setVerdicts(stationVerdicts);
        memoryCache.timeseries[selectedStationId] = series;
        memoryCache.verdicts[selectedStationId] = stationVerdicts;
      }
    });

    return () => {
      active = false;
    };
  }, [selectedStationId]);

  return {
    health,
    stations,
    alerts,
    openAlerts: alerts.filter((alert) => alert.status === "open"),
    selectedStation,
    selectedStationId,
    timeseries,
    verdicts,
    loading,
    error,
    refresh
  };
}
