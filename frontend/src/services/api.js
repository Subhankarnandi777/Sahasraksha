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

// scenario "ps55" = the problem statement's own example (55 °C, 95% RH,
// pressure +9 hPa at one station while its neighbours read normally).
export function injectDemoAnomaly(stationId, scenario) {
  const params = new URLSearchParams();
  if (stationId) params.set("station_id", stationId);
  if (scenario) params.set("scenario", scenario);
  const qs = params.toString();
  return request(`/demo/inject-anomaly${qs ? `?${qs}` : ""}`, {
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

// Number("") is 0 and Number.isNaN(0) is false, so an empty field used to
// render as a confident "0%" rather than "no data" -- the same coercion
// that had the station list ranking no-data stations as the fleet's worst.
// Infinity slipped through the NaN check too, and printed as "Infinity%".
export function percent(value, digits = 0) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return "-";
  }

  return `${(parsed * 100).toFixed(digits)}%`;
}

export function number(value, digits = 1) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return "-";
  }

  return parsed.toFixed(digits);
}

export function daysToThreshold(value) {
  return value === null || value === undefined ? "-" : String(value);
}

// Buckets on the severity number alone -- it says nothing about which
// mechanism fired. The alerts page used to label these bands "Drift
// Monitoring (CUSUM / Tide decay)" and "Sensor Advisory (minor variance)",
// which put three flatline faults and a step fault under a drift heading.
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

// A station's persisted `status` is only ever recomputed when a NEW
// reading arrives -- nothing ever revisits it just because time passed
// with no reading at all. So a station that stopped reporting hours ago
// keeps showing whatever status it last earned, "OK" included. Every
// place that displays a station's status (map markers, detail sheets,
// the Network page's focus card and search dropdown, Dashboard's tallies)
// should go through this instead of reading station.status directly, so
// a silent station can't render as if it were currently healthy anywhere
// in the app.
export function effectiveStatus(station, referenceTime) {
  // The backend marks a station low_confidence when it does not trust its
  // data, and deliberately withholds both its health score and its latest
  // readings (station_service.py). The map has always rendered that as its
  // own category, but the stations list read the raw status, so a station
  // reporting nothing at all still showed a green "OK" and counted towards
  // the healthy tally.
  if (station?.data_quality === "low_confidence") return "MONITOR";
  if (station?.status === "OK" && isSilent(station, referenceTime)) return "MONITOR";
  return station?.status;
}

// One wording for each detector reason, shared so the station list, the
// detail page and anything else describe the same fault the same way.
// Without this the list fell back to printing the raw enum -- Sagar's card
// read simply "step" -- which is the same bare-value leak that put the word
// "ok" under a warning icon on the detail page.
export function anomalyReasonText(reason) {
  const r = String(reason || "").trim().toLowerCase();
  if (r === "step") return "Abrupt step jump in a single reading, larger than the atmosphere can move between readings.";
  if (r === "drift" || r === "cusum") return "Continuous cumulative sum (CUSUM) calibration drift detected.";
  if (r === "tide_loss" || r === "degrading") return "Pressure sensor's 12-hour tidal signature is fading: the slow calibration-drift pattern this detector watches for.";
  if (r === "range") return "Reading outside gross physical limits for this channel.";
  if (r === "impossible") return "Physically impossible reading: above India's temperature record, a dew point no Indian station reaches, or dew point above air temperature.";
  if (r === "missing") return "Expected telemetry channel absent from this reading.";
  if (r === "flatline" || r === "frozen") return "Persistent static sensor reading (flatline) detected.";
  if (r === "spike" || r === "noise") return "High-frequency non-physical impulse spikes detected.";
  return "Autonomous QC anomaly flag active.";
}

// What the operator should do, per verdict reason. Same wording as
// STREAM_ACTIONS in ml/sahasraksha/stream.py (and the batch pipeline's ACTIONS).
const REASON_ACTIONS = {
  impossible: "Quarantine this reading from forecast assimilation and use the estimate. If it recurs within 24 h, dispatch a technician to inspect the T/RH probe and radiation shield.",
  range: "Reading outside physical limits. Quarantine it and use the estimate; check units and sensor wiring.",
  step: "Sudden jump. If the new level persists, verify the installation (post-maintenance or resiting) and apply an offset.",
  frozen: "Sensor or logger stuck. Power-cycle the logger remotely; dispatch if not cleared in 6 h.",
  missing: "Channel missing. Check telemetry link and power; values shown are estimates until the link returns.",
  drift: "Calibration drift. Schedule recalibration against a transfer standard; apply the offset meanwhile.",
  degrading: "Pressure sensor losing its 12-hour tide. Clear the pressure port and schedule a service visit.",
  anomaly: "Reading disagrees with this station's own signature. Hold for review; no dispatch unless it persists.",
};

export function anomalyActionText(reason) {
  return REASON_ACTIONS[String(reason || "").trim().toLowerCase()] || "";
}

// The labelled estimate the backend attaches to a flagged verdict:
// own harmonic baseline + neighbours' median residual, with a 2-sigma band.
// Returns { channel, value, band } for the requested channel, or for the
// first channel that has one.
export function estimateFor(evidence, channel) {
  const map = Object.fromEntries((evidence || []).map((p) => [String(p?.[0]), Number(p?.[1])]));
  const chans = channel ? [channel] : ["T", "P", "RH"];
  for (const ch of chans) {
    const v = map[`estimate_${ch}`];
    if (Number.isFinite(v)) {
      const b = map[`estimate_band_${ch}`];
      return { channel: ch, value: v, band: Number.isFinite(b) ? b : null };
    }
  }
  return null;
}

// The detector's own cutoff for "this channel's standardised residual is
// anomalous" -- StreamingSahasraksha(z_cut=4.0) in ml/sahasraksha/stream.py,
// used there as `ml_like = any(abs(v) > self.z_cut for v in z.values())`.
// Below it, the detector does not consider the channel anomalous at all.
const CHANNEL_Z_CUT = 4.0;

// The detector scores severity as max|z|/8 (+ physics/missing/degradation
// terms) in stream.py's `sev = clip(max(|z|)/8 + ...)`. Dividing a single
// channel's own z by the same 8 puts it on exactly the scale the verdict's
// own severity already uses, rather than inventing a second one.
const Z_SEVERITY_DIVISOR = 8.0;

// Per-channel QC label for a telemetry card.
//
// Three things about the verdict feed make the obvious implementation wrong,
// all of them verified against the detector rather than assumed:
//
//  1. A verdict exists for EVERY reading, including `reason: "ok", flag: 0`.
//     The pages here just take verdicts[verdicts.length - 1], so the latest
//     verdict is usually a perfectly nominal one. Reading a severity off it
//     and rendering "Watch 15%" claims a QC concern on a station the
//     detector never flagged.
//
//  2. `z_{channel}` is written unconditionally for every channel on every
//     reading (stream.py: `evidence[f"z_{ch}"] = abs(z[ch])`, outside any
//     gate). When nothing fires, the top-3 evidence the verdict carries is
//     exactly z_T, z_P, z_RH -- so "does this channel appear in evidence?"
//     is always true for all three, and every card lit up together.
//
//  3. `severity` is driven by the WORST channel (max|z|), so attributing it
//     to each channel individually reports one channel's deviation three
//     times over, as if the three had scored that independently.
//
// So: an unflagged verdict yields no channel badge at all; a channel is only
// implicated by evidence that actually fired for it (range_/step_/runlen_/
// cusum_, or tide_loss for pressure) or by its own z clearing the detector's
// z_cut; and a z-driven badge is scored from that channel's own z, not from
// the network-wide worst. spatial_z_* stays excluded throughout -- it is a
// neighbour cross-check computed for every channel that has a nearby reading
// (anomaly_detector.py's _spatial_evidence), not a fault signal for the
// channel it names.
export function channelStatus(verdict, channel, fallback) {
  if (!verdict) return fallback;

  // Nothing was flagged -- the detector is reporting a normal reading.
  const reason = String(verdict.reason || "").toLowerCase();
  if (Number(verdict.flag || 0) === 0 || reason === "ok") return fallback;

  let ownZ = null;
  let firedForThisChannel = false;

  for (const pair of verdict.evidence || []) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    const [key, value] = pair;
    if (typeof key !== "string") continue;

    if (key.startsWith("spatial_z_")) continue;
    if (key === `z_${channel}`) {
      ownZ = Math.abs(Number(value));
      continue;
    }
    if (key === "tide_loss") {
      if (channel === "P") firedForThisChannel = true;
      continue;
    }
    if (key.endsWith(`_${channel}`)) firedForThisChannel = true;
  }

  const zIsAnomalous = ownZ !== null && ownZ > CHANNEL_Z_CUT;
  if (!firedForThisChannel && !zIsAnomalous) return fallback;

  // A hard gate (frozen, step, range, dewpoint) is a physics violation that
  // z does not measure -- a frozen sensor sits at z ~ 0 -- so those keep the
  // verdict's own severity. A purely z-driven flag is scored from this
  // channel's own residual instead.
  const severity = firedForThisChannel
    ? Number(verdict.severity || 0)
    : Math.min(ownZ / Z_SEVERITY_DIVISOR, 1);

  return severity >= 0.5 ? `Attention ${percent(severity, 0)}` : `Watch ${percent(severity, 0)}`;
}


// A station's health score, or null when it has none. null and "" both
// coerce to a perfectly finite 0, so they have to be rejected before
// Number() ever sees them -- otherwise "no score" counts as the worst score
// there is. The network-average health on the Dashboard and Fleet Map was
// averaging the three low-confidence stations in as 0%, which pulled the
// headline figure from about 95.6% down to 90.8%.
export function healthOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Station status in order of how urgently it needs a person. The stations
// list's "Risk Priority" sort ranks on this first: it used to sort on
// health alone, so a SERVICE NOW station with an acute step fault and 100%
// calibration health sat 51st of 60, below dozens of healthy stations.
const STATUS_RANK = { "SERVICE NOW": 3, SCHEDULE: 2, MONITOR: 1, OK: 0 };

export function statusRank(status) {
  return STATUS_RANK[status] ?? 0;
}

// station_service._status_from_verdict's own degradation floors: at 0.2 a
// station moves to SCHEDULE, at 0.45 to SERVICE NOW. The same 0.45 is the
// detector's deg_cut in stream.py, the point where it emits tide_loss.
export const DEGRADATION_SCHEDULE = 0.2;
export const DEGRADATION_SERVICE = 0.45;

// The station's recorded tidal degradation -- the same number its health
// score is derived from (health = 1 - degradation) and the one the
// dashboard watchlist ranks on. The backend holds it at its worst value --
// station_service.py only ever ratchets it up, and nothing resets it yet.
// Null when the pipeline does not trust the
// station's data at all, so "no data" cannot render as "0% loss".
export function stationDegradation(station) {
  if (!station || station.data_quality === "low_confidence") return null;
  const raw = station.degradation;
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

// Short category label for an evidence key, so evidence chips can say what
// a marker is ("Own-baseline residual · RH") instead of printing the raw
// key uppercased ("Z RH").
export function evidenceLabel(key) {
  const k = String(key || "");
  const channel = (prefix) => k.slice(prefix.length);
  if (k.startsWith("spatial_z_")) return `Neighbour residual · ${channel("spatial_z_")}`;
  if (k.startsWith("z_")) return `Own-baseline residual · ${channel("z_")}`;
  if (k.startsWith("step_")) return `Step jump · ${channel("step_")}`;
  if (k.startsWith("runlen_")) return `Repeated readings · ${channel("runlen_")}`;
  if (k.startsWith("cusum_")) return `CUSUM drift · ${channel("cusum_")}`;
  if (k.startsWith("range_")) return `Gross limit · ${channel("range_")}`;
  if (k === "tide_loss") return "Tidal loss";
  if (k === "dewpoint_violation" || k === "gate_dewpoint") return "Dewpoint check";
  if (k === "t_record") return "National record check";
  if (k === "dewpoint_ceiling") return "Dewpoint ceiling";
  if (k.startsWith("estimate_band_")) return `Estimate band · ${channel("estimate_band_")}`;
  if (k.startsWith("estimate_")) return `Best estimate · ${channel("estimate_")}`;
  if (k === "spatial_agreement") return "Neighbour agreement";
  if (k === "insufficient_history_for_real_fit") return "Baseline fit";
  return k.replace(/_/g, " ");
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
  if (key.startsWith("range_")) {
    return `${key.replace("range_", "")}: outside gross physical limits`;
  }
  // The detector's own per-channel standardised residual. Rendered raw as
  // "z_T: 1.23" before this, because only spatial_z_ had a branch.
  if (key.startsWith("z_")) {
    return `${key.replace("z_", "")}: ${displayValue}σ from its own baseline`;
  }
  // stream.py emits this as "dewpoint_violation"; the "gate_dewpoint" spelling
  // checked here never matched anything the backend actually sends, so a real
  // dewpoint violation fell through to the raw key/value fallback below.
  if (key === "dewpoint_violation" || key === "gate_dewpoint") {
    return "Dewpoint above air temperature";
  }
  if (key === "t_record") {
    return `${number(value, 1)} °C is above India's all-time record (51 °C)`;
  }
  if (key === "dewpoint_ceiling") {
    return `Dew point ${number(value, 1)} °C: above what any Indian station reaches (~34 °C)`;
  }
  const UNITS = { T: "°C", P: "hPa", RH: "%" };
  if (key.startsWith("estimate_band_")) {
    const ch = key.replace("estimate_band_", "");
    return `${ch} estimate uncertainty: ±${number(value, 1)} ${UNITS[ch] || ""}`.trim();
  }
  if (key.startsWith("estimate_")) {
    const ch = key.replace("estimate_", "");
    return `${ch} best estimate: ${number(value, 1)} ${UNITS[ch] || ""}`.trim();
  }
  // anomaly_detector.py appends these two after the detector's own top-3,
  // and neither had a branch, so they rendered as raw snake_case keys with
  // a number stuck on the end. The second one is the pipeline admitting it
  // had too little history to fit a real harmonic for this station -- that
  // is worth saying in words rather than leaking as a variable name.
  if (key === "spatial_agreement") {
    return `Neighbour stations agree: ${Math.round(Number(value) * 100)}% of channels`;
  }
  if (key === "insufficient_history_for_real_fit") {
    return "Too little history to fit this station's own baseline";
  }

  return `${key}: ${displayValue}`;
}

export { API_BASE_URL };
