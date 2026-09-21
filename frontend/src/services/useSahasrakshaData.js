import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getAlerts,
  getHealth,
  getNetworkTimeseries,
  getStationTimeseries,
  getStationVerdicts,
  getStations
} from "./api.js";

// Fast in-memory cache to make page transitions 0ms instant
let memoryCache = {
  health: null,
  stations: null,
  alerts: null,
  networkTimeseries: null,
  timeseries: {},
  verdicts: {},
  lastFetched: 0
};

export default function useSahasrakshaData(routeStationId) {
  const [health, setHealth] = useState(memoryCache.health);
  const [stations, setStations] = useState(memoryCache.stations || []);
  const [alerts, setAlerts] = useState(memoryCache.alerts || []);
  // Network-wide hourly medians, independent of whichever station is
  // selected -- this is what the dashboard's ambient chart plots.
  const [networkTimeseries, setNetworkTimeseries] = useState(
    memoryCache.networkTimeseries || []
  );
  const [timeseries, setTimeseries] = useState([]);
  const [verdicts, setVerdicts] = useState([]);
  const [loading, setLoading] = useState(!memoryCache.stations);
  const [error, setError] = useState("");

  // When nothing specific was requested (no route station id -- this is
  // the common case for the dashboard's own "ambient" chart), default to
  // the first currently-healthy (OK) station rather than blindly picking
  // array index 0. The live feed's keepalive mechanism deliberately
  // injects an occasional simulated fault into a small rotating set of
  // stations to demo the anomaly detector actually catching something --
  // that's the point of that mechanism. But if the very first station
  // happens to be the one currently mid-fault, every "default" view
  // (this dashboard chart chief among them) would show that one
  // station's synthetic anomaly as if it were the whole network's
  // reading. Falls back to stations[0] only if every station is
  // currently flagged, so there's always something to show.
  const selectedStationId =
    routeStationId ||
    stations.find((station) => station.status === "OK")?.station_id ||
    stations[0]?.station_id ||
    "";
  const selectedStation = useMemo(
    () => stations.find((station) => station.station_id === selectedStationId) || stations[0] || null,
    [selectedStationId, stations]
  );

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");

    try {
      // Single fast parallel fetch: Health, Stations, All Alerts and the
      // network-wide ambient series in 1 batch
      const [healthData, stationData, alertData, networkSeries] = await Promise.all([
        getHealth().catch(() => null),
        getStations().catch(() => []),
        getAlerts().catch(() => []),
        getNetworkTimeseries().catch(() => [])
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
      if (networkSeries && networkSeries.length > 0) {
        setNetworkTimeseries(networkSeries);
        memoryCache.networkTimeseries = networkSeries;
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
    networkTimeseries,
    timeseries,
    verdicts,
    loading,
    error,
    refresh
  };
}
