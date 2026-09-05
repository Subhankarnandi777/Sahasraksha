import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getHealth,
  getStationAlerts,
  getStationTimeseries,
  getStationVerdicts,
  getStations
} from "./api.js";

async function allAlerts(stations) {
  const groups = await Promise.all(
    stations.map(async (station) => {
      try {
        return await getStationAlerts(station.station_id);
      } catch {
        return [];
      }
    })
  );

  return groups.flat().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
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

    try {
      const [healthData, stationData] = await Promise.all([getHealth(), getStations()]);
      setHealth(healthData);
      setStations(stationData);
      setAlerts(await allAlerts(stationData));
    } catch (err) {
      setError(err.message || "Unable to load backend data.");
    } finally {
      setLoading(false);
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
