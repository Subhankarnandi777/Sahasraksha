"""
Adapter from the repository's validated streaming ML engine to the API verdict.

This replaces an implementation that, despite the technical record's claims,
never actually ran the validated detector:

  - Every station was seeded with _intercept_coeff() -- beta0 = the first
    reading, all 10 harmonic terms zero. fit_coeffs() was never called.
    The walk-forward refit result the record cites (F1 0.29 -> 0.66) never
    reached this code path; L1 in production was a flat constant.
  - One StreamingSahasraksha instance was created PER STATION, each seeded
    with only that station's own reading. No neighbour was ever consulted.
  - Evidence keys named z_* were unconditionally renamed to spatial_z_* by
    _evidence_key(), even though no spatial computation existed anywhere
    in the file -- the label claimed a capability the code did not have.
  - The dewpoint gate (WMO Magnus, "multivariate consistency" in the PS)
    was absent; stream.py itself never implemented it, only the batch
    detect.py did.
  - "confidence" was max(severity, degradation, 0.6) -- a heuristic floor,
    not a calibrated probability. This one is NOT fixed: _confidence() below
    still computes exactly that, and the conformal calibration in
    ml/sahasraksha/gapfill.py is not wired into this path. The site labels it
    as a heuristic rather than as calibrated confidence.

Found by an independent audit, verified line-by-line against this repository
before being trusted. The others are fixed below; the dewpoint gate fix lives in
ml/sahasraksha/stream.py itself since detection logic belongs in the shared
package, not the adapter, and both repos consuming it benefit.

Design, honestly stated:
  - ONE StreamingSahasraksha instance for the whole network, not one per
    station -- states are added to it as stations are first seen.
  - On first sight of a station, its real history (if any exists in this
    database) is fetched and fit_coeffs() is run on it. Below a minimum
    history length there is no real harmonic to fit, and this is stated
    honestly via an "insufficient_history" evidence flag rather than
    silently returning an intercept-only fit unlabelled.
  - Spatial consensus is real: on every reading, up to 6 real neighbours
    within 700 km (haversine, using this database's own station
    coordinates) with a reading inside +/-90 minutes contribute their own
    z-score for the same channel. The neighbour MEDIAN is compared against
    this station's own z -- a regional event moves neighbours the same
    way; an isolated fault does not. This is what spatial_z_* now actually
    measures.
  - Evidence keys are only ever labelled spatial_ when a real spatial
    computation produced them.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
from threading import Lock
from typing import Any, Protocol

from app.schemas import AnomalyReason, AnomalyVerdict, WeatherReading
from app.db.database import SessionLocal
from app.db.models import Station, WeatherReading as WeatherReadingRow


ML_DIR = Path(__file__).resolve().parents[3] / "ml"
if str(ML_DIR) not in sys.path:
    sys.path.insert(0, str(ML_DIR))

from sahasraksha.stream import StreamingSahasraksha, StationState, fit_coeffs, design_row
import numpy as np
import pandas as pd

MIN_READINGS_FOR_REAL_FIT = 24 * 14
SPATIAL_RADIUS_KM = 700.0
SPATIAL_TIME_WINDOW_MIN = 90
SPATIAL_MAX_NEIGHBOURS = 6


class AnomalyDetector(Protocol):
    def evaluate(self, reading: WeatherReading) -> AnomalyVerdict:
        """Return an anomaly verdict for one raw weather observation."""


class MockAnomalyDetector:
    """Deterministic contract adapter for tests and local fallback scenarios."""

    def evaluate(self, reading: WeatherReading) -> AnomalyVerdict:
        if reading.T is None or reading.P is None or reading.RH is None:
            return AnomalyVerdict(
                flag=1,
                reason=AnomalyReason.MISSING,
                severity=0.6,
                confidence=0.7,
                degradation=0.2,
                evidence=[["missing_required_signal", 1.0]],
            )

        if reading.T >= 45.0 or reading.T <= -20.0:
            return AnomalyVerdict(
                flag=1,
                reason=AnomalyReason.RANGE,
                severity=0.734,
                confidence=0.83,
                degradation=0.512,
                evidence=[
                    ["temperature_demo_threshold", reading.T],
                    ["amp_ratio_P", reading.amp_ratio_P if reading.amp_ratio_P is not None else 1.0],
                ],
            )

        return AnomalyVerdict(
            flag=0,
            reason=AnomalyReason.OK,
            severity=0.0,
            confidence=0.8,
            degradation=0.0,
            evidence=[["temporary_mock_detector", 0.0]],
        )


class SahasrakshaAnomalyDetector:
    """Real adapter: one shared engine, real coefficient fitting, real
    spatial consensus from this database's own station history."""

    def __init__(self) -> None:
        self._engine = StreamingSahasraksha({})
        self._lock = Lock()
        self._coord_cache: dict[str, tuple[float, float]] = {}
        self._fit_attempted: set[str] = set()

    def evaluate(self, reading: WeatherReading) -> AnomalyVerdict:
        with self._lock:
            sid = reading.station_id
            insufficient_history = False

            if sid not in self._engine.states:
                coeffs, insufficient_history, seed_last = self._seed_coeffs(sid, reading)
                state = StationState(coeffs)
                for ch, val in seed_last.items():
                    if val is not None:
                        state.last[ch] = val
                self._engine.states[sid] = state

            raw = self._engine.update(
                sid,
                self._local_solar_time(reading, self._get_lon(sid, reading)),
                float(reading.timestamp.timetuple().tm_yday),
                {"T": reading.T, "P": reading.P, "RH": reading.RH},
            )

            spatial_evidence = self._spatial_consensus(reading)
            own_z = self._own_z_scores(reading)

        return self._to_verdict(raw, spatial_evidence, insufficient_history, own_z)

    def _seed_coeffs(self, sid: str, reading: WeatherReading) -> tuple[dict, bool, dict]:
        """Fit real harmonic coefficients from this station's own history
        in the database. Below MIN_READINGS_FOR_REAL_FIT, there is no real
        harmonic to fit -- fall back to an honest intercept-only seed and
        say so, rather than silently pretending a short window supports
        an annual term.

        The intercept-only fallback must never be seeded from `reading` --
        that is the observation currently being evaluated, and doing so
        made any reading (anomalous or not) its own baseline, guaranteeing
        a ~zero residual on a station's first-ever evaluation regardless of
        how extreme that first reading was. It is seeded from this
        station's actual last stored reading instead (or an honest
        climatological default if none exists yet). The same last-reading
        values are also returned so the caller can prime StationState.last,
        letting the STEP gate run from the first evaluation too."""
        self._fit_attempted.add(sid)
        lon = self._get_lon(sid, reading)

        try:
            with SessionLocal() as db:
                rows = (
                    db.query(WeatherReadingRow)
                    .filter(WeatherReadingRow.station_id == sid)
                    .order_by(WeatherReadingRow.recorded_at.asc())
                    .all()
                )
        except Exception:
            rows = []

        if len(rows) >= MIN_READINGS_FOR_REAL_FIT:
            span_h = (rows[-1].recorded_at - rows[0].recorded_at).total_seconds() / 3600.0
            if span_h >= MIN_READINGS_FOR_REAL_FIT:
                df = pd.DataFrame([{
                    "station_id": sid, "timestamp": r.recorded_at, "lon": lon,
                    "T": r.temperature_c, "P": r.pressure_hpa, "RH": r.humidity_pct,
                } for r in rows])
                df["timestamp"] = pd.to_datetime(df["timestamp"])
                try:
                    fitted = fit_coeffs(df)
                    if sid in fitted:
                        last_row = rows[-1]
                        seed_last = {
                            "T": last_row.temperature_c,
                            "P": last_row.pressure_hpa,
                            "RH": last_row.humidity_pct,
                        }
                        return fitted[sid], False, seed_last
                except Exception:
                    pass

        last_row = rows[-1] if rows else None
        last_t = last_row.temperature_c if last_row else None
        last_p = last_row.pressure_hpa if last_row else None
        last_rh = last_row.humidity_pct if last_row else None

        return {
            "T": _intercept_coeff(last_t, 25.0),
            "P": _intercept_coeff(last_p, 1013.0),
            "RH": _intercept_coeff(last_rh, 50.0),
        }, True, {"T": last_t, "P": last_p, "RH": last_rh}

    def _get_lon(self, sid: str, reading: WeatherReading) -> float:
        if sid in self._coord_cache:
            return self._coord_cache[sid][1]
        try:
            with SessionLocal() as db:
                st = db.query(Station).filter(Station.station_id == sid).first()
                if st and st.lat is not None and st.lon is not None:
                    self._coord_cache[sid] = (st.lat, st.lon)
                    return st.lon
        except Exception:
            pass
        return 0.0

    @staticmethod
    def _local_solar_time(reading: WeatherReading, lon: float = 0.0) -> float:
        """Local solar time in hours: UTC clock time + longitude/15.

        This returned the bare UTC clock time, while fit_coeffs() fits each
        station's harmonic baseline in true local solar time (UTC + lon/15)
        and _spatial_consensus() below already evaluates neighbours that
        way. Every Indian station was therefore scored against a baseline
        shifted by about five hours, and a neighbour's residual was
        standardised with statistics accumulated on the shifted one."""
        ts = reading.timestamp
        if ts.tzinfo is not None:
            ts = ts.astimezone(timezone.utc)
        utc_hours = ts.hour + ts.minute / 60.0 + ts.second / 3600.0
        return (utc_hours + (lon or 0.0) / 15.0) % 24.0

    def _own_z_scores(self, reading: WeatherReading) -> dict:
        """This station's own residual z-scores, computed directly here
        (not read back from raw['evidence'], which is truncated to the
        top 3 items inside stream.py and may not contain all channels)."""
        state = self._engine.states.get(reading.station_id)
        if state is None:
            return {}
        lst = self._local_solar_time(reading, self._get_lon(reading.station_id, reading))
        doy = float(reading.timestamp.timetuple().tm_yday)
        x = design_row(lst, doy)
        out = {}
        for ch, val in (("T", reading.T), ("P", reading.P), ("RH", reading.RH)):
            if val is None:
                continue
            predicted = float(np.dot(state.beta[ch], x))
            resid = val - predicted
            mean = state.ew_mean.get(ch, 0.0)
            var = state.ew_var.get(ch, 1.0)
            s = (var ** 0.5) + 1e-6
            out[ch] = (resid - mean) / s
        return out

    def _spatial_consensus(self, reading: WeatherReading) -> dict:
        """Real neighbour check: haversine distance from this database's
        own station coordinates, a real reading within +/-90 minutes,
        that neighbour's OWN z-score against ITS OWN fitted baseline.
        Returns empty if no usable neighbour exists -- an isolated
        station honestly gets no spatial evidence rather than a
        fabricated one."""
        sid = reading.station_id
        lat, lon = self._get_coords(sid)
        if lat is None:
            return {}

        try:
            with SessionLocal() as db:
                all_stations = db.query(Station).all()
                nearby_ids = []
                for other in all_stations:
                    if other.station_id == sid or other.lat is None or other.lon is None:
                        continue
                    d = _haversine_km(lat, lon, other.lat, other.lon)
                    if d <= SPATIAL_RADIUS_KM:
                        nearby_ids.append((other.station_id, d))
                nearby_ids.sort(key=lambda x: x[1])
                nearby_ids = nearby_ids[:SPATIAL_MAX_NEIGHBOURS]

                if not nearby_ids:
                    return {}

                window_start = reading.timestamp - timedelta(minutes=SPATIAL_TIME_WINDOW_MIN)
                window_end = reading.timestamp + timedelta(minutes=SPATIAL_TIME_WINDOW_MIN)

                neighbour_z = {"T": [], "P": [], "RH": []}
                for nid, _dist in nearby_ids:
                    nearest = (
                        db.query(WeatherReadingRow)
                        .filter(WeatherReadingRow.station_id == nid)
                        .filter(WeatherReadingRow.recorded_at >= window_start)
                        .filter(WeatherReadingRow.recorded_at <= window_end)
                        .order_by(WeatherReadingRow.recorded_at.desc())
                        .first()
                    )
                    if nearest is None:
                        continue
                    n_state = self._engine.states.get(nid)
                    if n_state is None:
                        continue
                    n_lon = self._get_lon(nid, reading)
                    n_lst = ((nearest.recorded_at.hour
                              + nearest.recorded_at.minute / 60.0)
                             + n_lon / 15.0) % 24.0
                    n_doy = float(nearest.recorded_at.timetuple().tm_yday)
                    x = design_row(n_lst, n_doy)
                    for ch, val in (("T", nearest.temperature_c),
                                     ("P", nearest.pressure_hpa),
                                     ("RH", nearest.humidity_pct)):
                        if val is None:
                            continue
                        # Residual first (raw minus this neighbour's own
                        # harmonic prediction), THEN standardise -- ew_mean
                        # and ew_var track RESIDUAL statistics, not raw
                        # value statistics. Z-scoring the raw value against
                        # them directly (the original bug here) produced
                        # spatial_z_P in the hundreds, since a ~1008 hPa
                        # raw value was being compared to a near-zero
                        # residual mean/variance.
                        predicted = float(np.dot(n_state.beta[ch], x))
                        resid = val - predicted
                        mean = n_state.ew_mean.get(ch, 0.0)
                        var = n_state.ew_var.get(ch, 1.0)
                        s = (var ** 0.5) + 1e-6
                        z = (resid - mean) / s
                        neighbour_z[ch].append(z)
        except Exception:
            return {}

        evidence = {}
        for ch, vals in neighbour_z.items():
            if vals:
                evidence[f"spatial_z_{ch}"] = round(float(np.median(vals)), 3)
        return evidence

    def _get_coords(self, sid: str):
        if sid in self._coord_cache:
            return self._coord_cache[sid]
        try:
            with SessionLocal() as db:
                st = db.query(Station).filter(Station.station_id == sid).first()
                if st and st.lat is not None and st.lon is not None:
                    self._coord_cache[sid] = (st.lat, st.lon)
                    return st.lat, st.lon
        except Exception:
            pass
        return None, None

    @staticmethod
    def _to_verdict(raw, spatial_evidence, insufficient_history, own_z) -> AnomalyVerdict:
        reason = _reason(raw.get("reason"))
        severity = _clamp01(raw.get("severity", 0.0))
        degradation = _clamp01(raw.get("degradation", 0.0))
        confidence = _clamp01(raw.get("confidence", _confidence(reason, severity, degradation)))

        # --- spatial agreement: does a neighbour see the same thing? ------
        # Answers the PS's own example directly: an isolated extreme should
        # stay flagged near full severity; a regional event -- where the
        # target's own residual and the neighbour's residual point the same
        # direction with similar magnitude -- should have severity damped
        # rather than over-alerting on real weather. Deliberately
        # conservative: this adjusts severity, it never suppresses the
        # underlying physics-gate flag itself.
        spatial_agreement = None
        if spatial_evidence and own_z:
            agreements = []
            for ch in ("T", "P", "RH"):
                key = f"spatial_z_{ch}"
                if key not in spatial_evidence or ch not in own_z:
                    continue
                target_z = own_z[ch]
                if abs(target_z) < 1.0:
                    continue  # nothing unusual at the target on this channel
                neighbour_z = spatial_evidence[key]
                same_direction = (target_z > 0) == (neighbour_z > 0)
                magnitude_ratio = min(abs(neighbour_z), abs(target_z)) / (abs(target_z) + 1e-6)
                agreements.append(same_direction and magnitude_ratio > 0.4)

            if agreements:
                spatial_agreement = sum(agreements) / len(agreements)
                if spatial_agreement >= 0.5 and reason not in (
                    AnomalyReason.FROZEN, AnomalyReason.MISSING, AnomalyReason.STEP):
                    # Hard physics violations are never dampened by
                    # neighbour agreement -- those are true regardless.
                    # STEP joins FROZEN/MISSING here: a sudden jump is a
                    # fact about that one instrument, not a regional signal,
                    # the same way a frozen or missing sensor is. A full-year
                    # replay against real 2024 ISD data (60 stations) found
                    # 5 real step-fault true positives whose severity was
                    # cut because a neighbour's residual happened to agree
                    # by coincidence -- this closes that gap.
                    # Everything else gets a bounded reduction, never to
                    # zero, so a genuine regional event lowers the alarm
                    # without erasing it.
                    severity = round(max(severity * 0.5, severity - 0.35), 3)

        evidence = _evidence_pairs(raw.get("evidence", []))
        for k, v in spatial_evidence.items():
            evidence.append([k, v])
        if spatial_agreement is not None:
            evidence.append(["spatial_agreement", round(spatial_agreement, 3)])
        if insufficient_history:
            evidence.append(["insufficient_history_for_real_fit", 1.0])

        return AnomalyVerdict(
            flag=int(bool(raw.get("flag", 0))),
            reason=reason,
            severity=severity,
            confidence=confidence,
            degradation=degradation,
            evidence=evidence,
        )


def _haversine_km(lat1, lon1, lat2, lon2) -> float:
    R = 6371.0
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dphi = np.radians(lat2 - lat1)
    dlmb = np.radians(lon2 - lon1)
    a = np.sin(dphi / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dlmb / 2) ** 2
    return 2 * R * np.arcsin(np.sqrt(a))


def _intercept_coeff(value, default: float) -> list:
    coeffs = [0.0] * 11
    coeffs[0] = float(value) if value is not None else default
    return coeffs


def _reason(value) -> AnomalyReason:
    try:
        return AnomalyReason(str(value))
    except ValueError:
        return AnomalyReason.UNCLASSIFIED


def _clamp01(value) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, number))


def _confidence(reason, severity: float, degradation: float) -> float:
    if reason is AnomalyReason.OK:
        return round(max(0.5, 1.0 - severity), 3)
    return round(max(severity, degradation, 0.6), 3)


def _evidence_pairs(evidence) -> list:
    pairs = []
    for item in evidence:
        if not isinstance(item, (list, tuple)) or len(item) != 2:
            continue
        key, value = item
        pairs.append([_evidence_key(str(key)), _evidence_value(value)])
    return pairs


def _evidence_key(key: str) -> str:
    if key.startswith("frozen_"):
        return key.replace("frozen_", "runlen_", 1)
    return key


def _evidence_value(value) -> float:
    try:
        return round(float(value), 3)
    except (TypeError, ValueError):
        return 0.0


_anomaly_detector: AnomalyDetector = SahasrakshaAnomalyDetector()


def get_anomaly_detector() -> AnomalyDetector:
    return _anomaly_detector
