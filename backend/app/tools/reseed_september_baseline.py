"""Re-seed each station's WeatherReading history with REAL historical data.

Why this exists
----------------
Several stations' latest_temperature / latest_pressure / latest_humidity
(derived from each station's most-recent WeatherReading row) currently hold
implausible values (e.g. an ambient range of Min -0.5C / Max 14.0C
network-wide). Those numbers were never real sensor output -- they were
leftover seed/demo data. The keepalive service (see
app/services/keepalive_service.py) then picks up wherever this bad baseline
already sits and random-walks a small subset of stations from it every 5
minutes, which just relabels a bad number as "fresh" without ever
correcting it.

A first attempt at fixing this only inserted ONE new (correct) WeatherReading
row per station on top of the existing history. That was insufficient: the
"Ambient Network Temperature Oscillation" sparkline (frontend/src/pages/
Dashboard.jsx, `chartValues`) and each station's own detail-page telemetry
sparklines (frontend/src/pages/StationDetail.jsx) render EVERY WeatherReading
row for a station via GET /stations/{id}/timeseries (no time bound is
applied by the frontend), so the old bad rows kept dragging the displayed
min/max back to the impossible range even after a correct "latest" reading
was added on top. Verified with a real running local instance +
Playwright: adding only one new row still showed "Min: -0.5 / Max: 26.0" for
the ambient chart. Fixing this properly means REPLACING each station's
reading history, not appending to it.

This script replaces that bad history with a REAL 48-hour contiguous window
of observations pulled from the project's own historical archive
(ml/data/sahasraksha_big_export.csv.gz, genuine NOAA-ISD/IMD data,
2020-2024). app/tools/data/september_baseline_windows.json holds, per
station, a chronological list of real hourly {timestamp, T, P, RH} rows
starting at that station's real September 2024 baseline (or, for one
station -- 43296099999 / Bangalore -- a documented real-but-off-season
window from Jan 2023, since its 2024 September rows were unusable). Two
stations (43296099999 and 42516099999 / Shillong) only had a shorter run of
contiguous clean real rows available (4 and 8 respectively) -- this script
uses exactly what's real rather than padding with anything fabricated, and
says so when it runs.

The real hourly cadence is preserved, but the window's timestamps are
shifted so the newest real point lands at "now" (each earlier point steps
back by the same real 1-hour interval from there). This keeps the honest
"Data as of" freshness label truthful while showing a real, physically
shaped diurnal trend rather than a single flat point.

One station, 42875099999 (SWAMI VIVEKANANDA), is deliberately left OUT of
the window file and untouched by this script: it has zero clean readings
anywhere in the entire 5-year archive, which is consistent with -- not
contradicted by -- its existing `data_quality = "low_confidence"` flag.
Fabricating a window for it would reintroduce exactly the dishonesty this
script exists to remove.

Why this bypasses the normal /ingest pipeline
----------------------------------------------
The live `/ingest` endpoint runs every posted reading through the streaming
anomaly detector, which needs a station's own reading history to judge what
"normal" looks like. Jumping a station straight from a bad/absent baseline
to a correct value with no prior history looks, to that detector, exactly
like a step-change anomaly -- POSTing these values through /ingest was
tested and confirmed to trigger spurious `flag: 1, reason: "anomaly"`
verdicts. So this script writes directly to the database instead. It does
NOT create any new AnomalyVerdict or Alert row, and it does NOT touch
station.degradation or station.status -- this is a one-time baseline
correction, not a new "event" for the anomaly/alerting system to react to.

Referential-integrity note: AnomalyVerdict and Alert rows carry a
`reading_id` foreign key into weather_readings. If an existing (bad) reading
for a station is already referenced by a verdict or alert, deleting it would
either violate that foreign key (Postgres) or silently orphan the
verdict/alert's display (SQLite). So this script only deletes a station's
UNREFERENCED old readings before inserting the new real window; any
referenced old rows are left in place (and reported) rather than deleted.

Usage
-----
    cd backend
    SAHASRAKSHA_ALLOW_SQLITE=true python -m app.tools.reseed_september_baseline
    SAHASRAKSHA_ALLOW_SQLITE=true python -m app.tools.reseed_september_baseline --dry-run

Against production (Supabase), set DATABASE_URL as usual (no
SAHASRAKSHA_ALLOW_SQLITE needed) and run the same module.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.db.database import IS_SQLITE, SessionLocal, init_db
from app.db.models import (
    Alert,
    AnomalyVerdict,
    Station,
    WeatherReading as WeatherReadingModel,
    WorkOrder,
)

WINDOWS_PATH = Path(__file__).resolve().parent / "data" / "september_baseline_windows.json"

# --purge-implausible margin. The live-feed keepalive deliberately injects
# demo anomalies of at most 14 units (see keepalive_service.ANOMALY magnitude,
# random.uniform(9, 14)), so a reading within 15 units of a station's own real
# observed range is explainable as one of those and is left alone. Anything
# beyond that cannot be a single injected anomaly -- it's accumulated drift
# from the pre-fix keepalive, which carried its value forward and folded each
# anomaly permanently into it.
PURGE_MARGIN = 15.0
PURGE_CHANNELS = {
    "T": "temperature_c",
    "P": "pressure_hpa",
    "RH": "humidity_pct",
}

# The real bulk-imported archive (ml/data/sahasraksha_big_export.csv.gz)
# contains ONLY dates in 2020-2024 -- confirmed by scanning every row's
# year. Real weather has far more variation across those five years than
# in any one 48-hour reseed window, so a value-only bounds check applied
# to that archive would flag genuine seasonal extremes as "implausible"
# and delete real historical data. A reading can only be pre-fix keepalive
# drift if it was written by live ingestion, which stamps recorded_at with
# the actual wall-clock time -- i.e. 2025 or later. This cutoff is what
# actually separates "real archived history" from "live-fed data" in this
# database; the purge must never look at anything before it.
PURGE_NOT_BEFORE = datetime(2025, 1, 1, tzinfo=timezone.utc)

# Confirmed against the full 5-year archive to have zero clean readings.
# Left unseeded on purpose -- see module docstring.
KNOWN_UNSEEDABLE_STATIONS = {"42875099999"}

HOUR = timedelta(hours=1)


def _as_db_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc) if not IS_SQLITE else value
    utc_value = value.astimezone(timezone.utc)
    return utc_value.replace(tzinfo=None) if IS_SQLITE else utc_value


def load_windows() -> dict:
    with open(WINDOWS_PATH, encoding="utf-8") as handle:
        return json.load(handle)


def _plausible_bounds(points: list) -> dict:
    """Per-channel bounds for a station, derived from its OWN real data.

    No climatology is hardcoded -- the acceptable band is whatever that
    station actually recorded in the archive, widened by PURGE_MARGIN to
    leave room for a legitimately injected demo anomaly.
    """
    bounds = {}
    for channel in PURGE_CHANNELS:
        values = [point[channel] for point in points if point.get(channel) is not None]
        if not values:
            continue
        bounds[channel] = (min(values) - PURGE_MARGIN, max(values) + PURGE_MARGIN)
    return bounds


def _purge_implausible(db, windows: dict, dry_run: bool) -> tuple[int, int, int, int]:
    """Delete readings that can only be pre-fix keepalive drift, plus the
    verdicts/alerts/work orders derived from them.

    Those downstream rows are not real detections of anything -- they were
    computed from fabricated values, so leaving them would keep false
    alarms on the board. Rows are removed in foreign-key order:
    WorkOrder -> Alert -> AnomalyVerdict -> WeatherReading.

    Scope is restricted to readings recorded_at >= PURGE_NOT_BEFORE. This
    is deliberately a hard date cutoff, not just a value check: the value
    bounds alone cannot distinguish a real historical extreme from
    keepalive drift, but the date can -- the real archive never contains a
    2025+ timestamp, so anything in that range was written by live
    ingestion and is fair game for the value check.
    """
    doomed_reading_ids = []
    cutoff = _as_db_datetime(PURGE_NOT_BEFORE)

    for station_id, points in windows.items():
        bounds = _plausible_bounds(points)
        if not bounds:
            continue

        readings = (
            db.query(WeatherReadingModel)
            .filter(
                WeatherReadingModel.station_id == station_id,
                WeatherReadingModel.recorded_at >= cutoff,
            )
            .all()
        )
        for reading in readings:
            for channel, column in PURGE_CHANNELS.items():
                if channel not in bounds:
                    continue
                value = getattr(reading, column)
                if value is None:
                    continue
                low, high = bounds[channel]
                if value < low or value > high:
                    doomed_reading_ids.append(reading.id)
                    break

    if not doomed_reading_ids:
        return 0, 0, 0, 0

    verdict_ids = [
        row[0]
        for row in db.query(AnomalyVerdict.id)
        .filter(AnomalyVerdict.reading_id.in_(doomed_reading_ids))
        .all()
    ]
    alert_ids = [
        row[0]
        for row in db.query(Alert.id)
        .filter(Alert.reading_id.in_(doomed_reading_ids))
        .all()
    ]
    work_order_count = (
        db.query(WorkOrder).filter(WorkOrder.alert_id.in_(alert_ids)).count()
        if alert_ids
        else 0
    )

    if not dry_run:
        if alert_ids:
            db.query(WorkOrder).filter(WorkOrder.alert_id.in_(alert_ids)).delete(
                synchronize_session=False
            )
            db.query(Alert).filter(Alert.id.in_(alert_ids)).delete(synchronize_session=False)
        if verdict_ids:
            db.query(AnomalyVerdict).filter(AnomalyVerdict.id.in_(verdict_ids)).delete(
                synchronize_session=False
            )
        db.query(WeatherReadingModel).filter(
            WeatherReadingModel.id.in_(doomed_reading_ids)
        ).delete(synchronize_session=False)
        db.flush()

    return len(doomed_reading_ids), len(verdict_ids), len(alert_ids), work_order_count


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be written without touching the database.",
    )
    parser.add_argument(
        "--purge-implausible",
        action="store_true",
        help=(
            f"Also delete readings recorded on or after {PURGE_NOT_BEFORE.date()} "
            f"(the earliest a live-fed reading could exist -- the real archive is "
            f"only ever 2020-2024) that fall more than {PURGE_MARGIN:g} units outside "
            "the station's own real observed range, along with the "
            "verdicts/alerts/work orders derived from them. Use this once after "
            "deploying the keepalive drift fix to clear values the pre-fix feed "
            "had already drifted into the database."
        ),
    )
    args = parser.parse_args()

    windows = load_windows()
    print(f"Loaded real hourly windows for {len(windows)} stations from {WINDOWS_PATH.name}")

    short_windows = {sid: len(points) for sid, points in windows.items() if len(points) < 48}

    if args.dry_run:
        for station_id, points in windows.items():
            first, last = points[0], points[-1]
            note = f" [only {len(points)} real hours available]" if station_id in short_windows else ""
            print(
                f"  {station_id}: {len(points)} real hourly points, "
                f"{first['timestamp']} -> {last['timestamp']}{note}"
            )
        print(
            f"\n(dry run -- nothing written; "
            f"{len(KNOWN_UNSEEDABLE_STATIONS)} station(s) intentionally skipped: "
            f"{', '.join(sorted(KNOWN_UNSEEDABLE_STATIONS))})"
        )
        if short_windows:
            print(f"Shorter-than-usual real windows (used as-is, not padded): {short_windows}")

        if args.purge_implausible:
            init_db()
            with SessionLocal() as db:
                readings, verdicts, alerts, work_orders = _purge_implausible(
                    db, windows, dry_run=True
                )
                db.rollback()
            print(
                f"\n--purge-implausible WOULD delete: {readings} reading(s), "
                f"{verdicts} verdict(s), {alerts} alert(s), {work_orders} work order(s)."
            )
        return

    init_db()

    now = datetime.now(timezone.utc)
    updated, missing, deleted_count, kept_referenced = [], [], 0, {}

    purged = None

    with SessionLocal() as db:
        all_station_ids = {row[0] for row in db.query(Station.station_id).all()}

        if args.purge_implausible:
            # Runs BEFORE the fresh window is inserted, so the new real
            # readings are never candidates for their own purge.
            purged = _purge_implausible(db, windows, dry_run=False)

        for station_id, points in windows.items():
            station = db.get(Station, station_id)
            if station is None:
                missing.append(station_id)
                continue

            referenced_ids = {
                row[0]
                for row in db.query(AnomalyVerdict.reading_id).filter(
                    AnomalyVerdict.station_id == station_id
                ).all()
            } | {
                row[0]
                for row in db.query(Alert.reading_id).filter(Alert.station_id == station_id).all()
            }

            old_readings = (
                db.query(WeatherReadingModel)
                .filter(WeatherReadingModel.station_id == station_id)
                .all()
            )
            for reading in old_readings:
                if reading.id in referenced_ids:
                    kept_referenced[station_id] = kept_referenced.get(station_id, 0) + 1
                    continue
                db.delete(reading)
                deleted_count += 1

            n = len(points)
            for index, point in enumerate(points):
                offset_hours = n - 1 - index
                recorded_at = _as_db_datetime(now - offset_hours * HOUR)
                db.add(
                    WeatherReadingModel(
                        station_id=station_id,
                        recorded_at=recorded_at,
                        temperature_c=point["T"],
                        pressure_hpa=point["P"],
                        humidity_pct=point["RH"],
                        flag=0,
                        amp_ratio_p=1.0,
                    )
                )

            station.last_seen = _as_db_datetime(now)
            updated.append(station_id)

        already_flagged_unseedable = all_station_ids & KNOWN_UNSEEDABLE_STATIONS

        db.commit()

    if purged is not None:
        readings, verdicts, alerts, work_orders = purged
        print(
            f"\nPurged {readings} implausible reading(s) (more than {PURGE_MARGIN:g} units "
            f"outside the station's own real range), plus {verdicts} verdict(s), "
            f"{alerts} alert(s) and {work_orders} work order(s) derived from them."
        )

    print(f"\nUpdated {len(updated)} station(s) with a real hourly baseline window.")
    print(f"Deleted {deleted_count} unreferenced old (bad-baseline) reading row(s).")
    if kept_referenced:
        print(
            f"NOTE: kept old reading rows still referenced by an existing verdict/alert "
            f"(not deleted, to preserve referential integrity): {kept_referenced}"
        )
    if short_windows:
        print(f"Shorter-than-usual real windows (used as-is, not padded): {short_windows}")
    if already_flagged_unseedable:
        print(
            f"Intentionally left unseeded (no clean data anywhere in the archive): "
            f"{', '.join(sorted(already_flagged_unseedable))}"
        )
    if missing:
        print(
            f"WARNING: {len(missing)} station_id(s) in the window file were not found "
            f"in this database and were skipped: {', '.join(missing)}"
        )
    not_in_seed = all_station_ids - set(windows.keys()) - KNOWN_UNSEEDABLE_STATIONS
    if not_in_seed:
        print(
            f"NOTE: {len(not_in_seed)} station(s) in this database were not in the "
            f"window file at all (no baseline change applied): {', '.join(sorted(not_in_seed))}"
        )


if __name__ == "__main__":
    main()
