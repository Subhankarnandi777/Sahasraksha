const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

// The Render backend's free tier spins down after 15 min idle, so the first
// request after a cold start can take several seconds to wake it. Without a
// cap, a hung or unreachable backend previously left fetch() pending
// forever, which could freeze the whole dashboard (see useSahasrakshaData's
// Promise.all note). 15s comfortably covers a cold start while still
// failing fast enough for a judge/user to see a real error instead of an
// infinite spinner.
const DEFAULT_TIMEOUT_MS = 15000;

async function request(path, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = options;
  const headers = {
    ...(rest.body ? { "Content-Type": "application/json" } : {}),
    ...(rest.headers || {})
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      headers,
      signal: controller.signal,
      ...rest
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`Request to ${path} timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed: ${response.status}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export function getHealth() {
  return request("/health");
}

export function getStations() {
  return request("/stations");
}

export function getAlerts() {
  return request("/alerts");
}

// How far back the telemetry sparklines (dashboard "Ambient Network
// Temperature Oscillation" chart, station-detail channel cards) look.
// Several stations' reading history goes back years (real replayed
// archive data), and an unbounded fetch pulled in every old point --
// including ones a past anomaly detector run already flagged, so they
// can't simply be deleted without breaking that alert's own record. An
// unbounded range also isn't what "ambient" or a live channel sparkline
// should mean anyway: it's a recent-conditions view, not an all-time one.
// Bounding the request keeps it to what's actually recent regardless of
// how much older history a station happens to carry.
const TIMESERIES_LOOKBACK_HOURS = 72;

export function getStationTimeseries(stationId) {
  const from = new Date(Date.now() - TIMESERIES_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const query = new URLSearchParams({ from }).toString();
  return request(`/stations/${encodeURIComponent(stationId)}/timeseries?${query}`);
}

// Hourly median across every trusted station, for the dashboard's
// network-wide ambient chart. Deliberately NOT one station's trace: the
// live feed injects transient demo anomalies, and a single station
// mid-injection must not be able to drag a network-wide figure to a
// physically impossible value.
export function getNetworkTimeseries() {
  const from = new Date(Date.now() - TIMESERIES_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const query = new URLSearchParams({ from }).toString();
  return request(`/readings/network/timeseries?${query}`);
}

export function getStationAlerts(stationId) {
  return request(`/stations/${encodeURIComponent(stationId)}/alerts`);
}

export function getStationVerdicts(stationId) {
  return request(`/stations/${encodeURIComponent(stationId)}/verdicts`);
}

export function injectDemoAnomaly(stationId) {
  return request(`/demo/inject-anomaly${stationId ? `?station_id=${encodeURIComponent(stationId)}` : ""}`, {
    method: "POST",
  });
}

export function ingest(reading) {
  return request("/ingest", {
    method: "POST",
    body: JSON.stringify(reading)
  });
}

export function sendChatMessage(message, history = []) {
  return request("/chat", {
    method: "POST",
    // Chat replies come from an LLM call on the backend, which can run
    // slower than the 15s default used for ordinary data fetches.
    timeoutMs: 30000,
    body: JSON.stringify({ message, history })
  });
}

export function percent(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }

  return `${(Number(value) * 100).toFixed(digits)}%`;
}

export function number(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }

  return Number(value).toFixed(digits);
}

export function daysToThreshold(value) {
  return value === null || value === undefined ? "-" : String(value);
}

export function severityLevel(score) {
  const value = Number(score || 0);
  if (value >= 0.8) return "critical";
  if (value >= 0.5) return "monitoring";
  return "nodata";
}

export function statusTone(status) {
  if (status === "SERVICE NOW") return "critical";
  if (status === "SCHEDULE" || status === "MONITOR") return "monitor";
  return "healthy";
}

export function timeAgo(timestamp) {
  if (!timestamp) return "-";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "-";

  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} d ago`;
}


// Matches the SILENT_HOURS_THRESHOLD used throughout the ML pipeline (6h) --
// a station this far behind the network's own most recent reading is
// genuinely silent, not just "healthy but unlucky on timing."
//
// Compared against the NETWORK's latest reading, not the browser's wall
// clock -- correct for both live ingestion and a replayed historical
// dataset, where every station's last_seen can legitimately sit far behind
// "now" without any station actually being silent relative to the others.
const SILENT_HOURS_THRESHOLD = 6;

export function hoursSinceLastSeen(timestamp, referenceTime = Date.now()) {
  if (!timestamp) return Infinity;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return Infinity;
  return Math.max(0, (referenceTime - date.getTime()) / 3600000);
}

export function networkReferenceTime(stations) {
  let latest = 0;
  for (const station of stations) {
    const date = new Date(station?.last_seen);
    if (!Number.isNaN(date.getTime())) {
      latest = Math.max(latest, date.getTime());
    }
  }
  return latest || Date.now();
}

export function isSilent(station, referenceTime) {
  return hoursSinceLastSeen(station?.last_seen, referenceTime) > SILENT_HOURS_THRESHOLD;
}

// Evidence keys are channel-suffixed (spatial_z_T, runlen_RH, cusum_fast_P)
// except pressure's tide_loss, which has no suffix but is pressure-specific.
export function channelStatus(verdict, channel, fallback) {
  const evidence = verdict?.evidence || [];
  const relevant = evidence.filter(([key]) => {
    if (channel === "P" && key === "tide_loss") return true;
    return typeof key === "string" && key.endsWith(`_${channel}`);
  });
  if (!relevant.length) return fallback;
  const severity = Number(verdict?.severity || 0);
  return severity >= 0.5 ? `Attention ${percent(severity, 0)}` : `Watch ${percent(severity, 0)}`;
}


export function evidenceText(pair) {
  const [key, value] = pair;
  const displayValue = number(value, 2);

  if (key.startsWith("spatial_z_")) {
    return `${key.replace("spatial_z_", "")}: ${displayValue} spatial dev.`;
  }
  if (key.startsWith("cusum_")) {
    return `${key.replace("cusum_", "")}: ${displayValue} drift`;
  }
  if (key === "tide_loss") {
    return `${displayValue} heartbeat loss`;
  }
  if (key.startsWith("runlen_")) {
    return `${key.replace("runlen_", "")}: ${displayValue} repeated`;
  }
  if (key.startsWith("step_")) {
    const ch = key.replace("step_", "").toUpperCase();
    return `${ch} channel: abrupt step jump ${value ? `(${displayValue})` : "detected"}`;
  }
  if (key === "gate_dewpoint") {
    return "Dewpoint above air temperature";
  }

  return `${key}: ${displayValue}`;
}

export { API_BASE_URL };
