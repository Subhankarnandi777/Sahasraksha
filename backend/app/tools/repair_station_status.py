"""Repair each station's exposed status/health/degradation so they can
never contradict its own real detection history.

Why this exists
----------------
The one-time initial provisioning script that populated this database
(app/tools/sync_and_ml_replay.py, not part of the running app) seeded each
station in two disconnected steps:

1. `sync_stations_from_render()` copied `status`/`health`/`degradation`
   straight off an external demo snapshot (render_stations.json) where
   `status` was hand-varied for a realistic mix of OK / MONITOR / SCHEDULE
   / SERVICE NOW demo stations, but `health` (and therefore `health_score`)
   defaulted to a flat 1.0 wherever the snapshot didn't set it explicitly --
   independent fields, never made consistent with each other.
2. `run_ml_detection_and_populate()` then ran the REAL ML anomaly detector
   over each station's real historical archive and persisted the resulting
   AnomalyVerdict / Alert / WorkOrder rows -- genuine detections -- but
   never called station_service.update_station_from_verdict(), so none of
   that real detection work was ever reflected back onto the station's own
   health_score / degradation / status fields.

The result, confirmed live on 2026-09-21 via GET /stations: every station
reported `health: 1.0`, including ones simultaneously marked
`status: "SERVICE NOW"` -- a station can look both perfectly healthy and
in need of emergency service in the same API response.

This tool repairs that by replaying each station's OWN already-persisted
AnomalyVerdict rows (real detections, already in the database -- nothing
is invented or guessed) through the SAME station_service.update_station_
from_verdict function the live /ingest pipeline uses, in chronological
order. That function is what already guarantees health_score and status
are always two views of the same degradation number (see
station_service.py's monotonic-degradation contract) for any station that
receives a live reading; this just applies it, after the fact, to the
readings these stations already have on record, so the guarantee holds
for every station -- not only the ones the keepalive feed happens to be
currently ticking.

A station's `last_seen` ("Data as of...") is a separate, already-correct
concern owned by the reseed baseline and the live keepalive feed. Replaying
old verdicts must not regress it to their old timestamps, so this tool
restores each station's `last_seen` to whatever it was before repairing it.

Stations with zero AnomalyVerdict rows (never evaluated by the detector at
all) are left untouched -- there is nothing real to repair them from, and
fabricating a value would reintroduce exactly the dishonesty this tool
exists to remove.

Usage
-----
    cd backend
    SAHASRAKSHA_ALLOW_SQLITE=true python -m app.tools.repair_station_status --dry-run
    SAHASRAKSHA_ALLOW_SQLITE=true python -m app.tools.repair_station_status

Against production (Supabase), set DATABASE_URL as usual (no
SAHASRAKSHA_ALLOW_SQLITE needed) and run the same module.
"""

from __future__ import annotations

import argparse

from app.db.database import SessionLocal, init_db
from app.db.models import AnomalyVerdict as AnomalyVerdictModel
from app.db.models import Station
from app.db.models import WeatherReading as WeatherReadingModel
from app.services import alert_service, station_service


def repair_station_status(db, dry_run: bool = False) -> dict:
    """Recompute health_score/degradation/status for every station from
    its own already-persisted AnomalyVerdict rows, replayed in
    chronological order through station_service.update_station_from_verdict
    -- the exact function the live /ingest pipeline already trusts to keep
    those three fields mutually consistent.

    Returns {"repaired": {station_id: {"before": (status, health, degradation),
    "after": (...)}, ...}, "unchanged": [station_id, ...],
    "skipped_no_verdicts": [station_id, ...]}.
    """
    summary: dict = {"repaired": {}, "unchanged": [], "skipped_no_verdicts": []}

    stations = db.query(Station).order_by(Station.station_id).all()
    for station in stations:
        rows = (
            db.query(AnomalyVerdictModel, WeatherReadingModel.recorded_at)
            .join(WeatherReadingModel, AnomalyVerdictModel.reading_id == WeatherReadingModel.id)
            .filter(AnomalyVerdictModel.station_id == station.station_id)
            .order_by(WeatherReadingModel.recorded_at.asc(), AnomalyVerdictModel.id.asc())
            .all()
        )
        if not rows:
            summary["skipped_no_verdicts"].append(station.station_id)
            continue

        before = (station.status, station.health_score, station.degradation)
        original_last_seen = station.last_seen

        for db_verdict, recorded_at in rows:
            contract_verdict = alert_service._to_anomaly_verdict(db_verdict)
            station_service.update_station_from_verdict(
                station.station_id,
                recorded_at,
                contract_verdict.flag,
                contract_verdict.reason,
                contract_verdict.severity,
                contract_verdict.degradation,
                db,
            )

        station.last_seen = original_last_seen

        after = (station.status, station.health_score, station.degradation)
        if after != before:
            summary["repaired"][station.station_id] = {"before": before, "after": after}
        else:
            summary["unchanged"].append(station.station_id)

    if dry_run:
        db.rollback()
    else:
        db.commit()

    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would change without writing to the database.",
    )
    args = parser.parse_args()

    init_db()
    with SessionLocal() as db:
        summary = repair_station_status(db, dry_run=args.dry_run)

    repaired = summary["repaired"]
    verb = "Would repair" if args.dry_run else "Repaired"
    print(
        f"{verb} {len(repaired)} station(s); {len(summary['unchanged'])} already "
        f"consistent; {len(summary['skipped_no_verdicts'])} skipped (no verdict history)."
    )
    for station_id, change in repaired.items():
        before_status, before_health, before_deg = change["before"]
        after_status, after_health, after_deg = change["after"]
        print(
            f"  {station_id}: status {before_status!r} -> {after_status!r}, "
            f"health {before_health} -> {after_health}, "
            f"degradation {before_deg} -> {after_deg}"
        )
    if summary["skipped_no_verdicts"]:
        print(
            "\nNo verdict history at all (left untouched -- nothing real to repair "
            "them from): " + ", ".join(summary["skipped_no_verdicts"])
        )


if __name__ == "__main__":
    main()
