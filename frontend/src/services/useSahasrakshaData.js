import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getAlerts,
  getHealth,
  getStationTimeseries,
  getStationVerdicts,
  getStations
} from "./api.js";

function sortedAlerts(list) {
  return [...list].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export default function useSahasrakshaData(routeStationId) {
  const [health, setHealth] = useState(null);
  const [stations, setStations] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [timeseries, setTimeseries] = useState([]);
  const [verdicts, setVerdicts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const selectedStationId = routeStationId || stations[0]?.station_id || "";
  const selectedStation = useMemo(
    () => stations.find((station) => station.station_id === selectedStationId) || stations[0] || null,
    [selectedStationId, stations]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");

    // allSettled, not all: /health is a secondary status badge, not
    // something the whole dashboard should live or die on. Previously a
    // slow/hung /health call (e.g. a cold-starting backend) blocked
    // /stations from ever rendering too, even though /stations had already
    // succeeded -- one bad endpoint froze the entire page.
    const [healthResult, stationResult] = await Promise.allSettled([getHealth(), getStations()]);

    setHealth(healthResult.status === "fulfilled" ? healthResult.value : null);

    if (stationResult.status === "fulfilled") {
      setStations(stationResult.value);
    } else {
      setError(stationResult.reason?.message || "Unable to load backend data.");
    }

    // "Loading" only reflects the data the UI actually blocks on -- stations
    // and health. Alerts load in the background afterward via a single bulk
    // request and shouldn't stall the page.
    setLoading(false);

    if (stationResult.status === "fulfilled") {
      try {
        setAlerts(sortedAlerts(await getAlerts()));
      } catch {
        setAlerts([]);
      }
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedStationId) {
      setTimeseries([]);
      setVerdicts([]);
      return;
    }

    let active = true;
    Promise.all([
      getStationTimeseries(selectedStationId).catch(() => []),
      getStationVerdicts(selectedStationId).catch(() => [])
    ]).then(([series, stationVerdicts]) => {
      if (active) {
        setTimeseries(series);
        setVerdicts(stationVerdicts);
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
