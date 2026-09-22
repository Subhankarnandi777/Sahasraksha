"""Create work orders for existing HIGH/CRITICAL-severity open alerts
that predate automatic work-order creation.

Why this exists
----------------
alert_service.save_verdict_and_create_alert now automatically creates a
work order for any NEW alert at or above AUTO_WORK_ORDER_SEVERITY, but
that only applies going forward. Alerts already sitting open in the
database -- including genuinely critical ones, like a station repaired to
its real ~97% degradation by repair_station_status.py -- were created
before this existed and have no work order at all, leaving the "Field
Work Orders / Automated technician calibration queue" count at 0 even
while the fleet has real high-severity stations sitting open.

This is a one-time catch-up pass: it finds open alerts at or above the
same severity threshold with no existing work order, and creates one for
each, using the exact same work_order_service.create_work_order_for_alert
function the automatic path now calls (so priority and recommended
action are computed identically either way -- nothing bespoke here).

Usage
-----
    cd backend
    SAHASRAKSHA_ALLOW_SQLITE=true python -m app.tools.backfill_work_orders --dry-run
    SAHASRAKSHA_ALLOW_SQLITE=true python -m app.tools.backfill_work_orders

Against production (Supabase), set DATABASE_URL as usual (no
SAHASRAKSHA_ALLOW_SQLITE needed) and run the same module.
"""

from __future__ import annotations

import argparse

from app.db.database import SessionLocal, init_db
from app.db.models import Alert as AlertModel
from app.db.models import WorkOrder as WorkOrderModel
from app.services import work_order_service
from app.services.alert_service import AUTO_WORK_ORDER_SEVERITY, _severity


def find_alerts_needing_work_orders(db) -> list[AlertModel]:
    open_alerts = (
        db.query(AlertModel)
        .filter(AlertModel.status == "open")
        .order_by(AlertModel.created_at)
        .all()
    )
    existing_alert_ids = {
        row[0] for row in db.query(WorkOrderModel.alert_id).all()
    }
    return [
        alert
        for alert in open_alerts
        if alert.id not in existing_alert_ids
        and _severity(alert.severity) >= AUTO_WORK_ORDER_SEVERITY
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List what would be created without writing to the database.",
    )
    args = parser.parse_args()

    init_db()
    with SessionLocal() as db:
        candidates = find_alerts_needing_work_orders(db)
        details = [
            (alert.id, alert.station_id, _severity(alert.severity))
            for alert in candidates
        ]

    verb = "Would create" if args.dry_run else "Creating"
    print(f"{verb} {len(details)} work order(s) for open alerts at or "
          f"above severity {AUTO_WORK_ORDER_SEVERITY:g} with none yet:")
    for alert_id, station_id, severity in details:
        print(f"  alert {alert_id} ({station_id}, severity {severity:.2f})")

    if args.dry_run:
        return

    created = 0
    for alert_id, _station_id, _severity_value in details:
        try:
            work_order = work_order_service.create_work_order_for_alert(alert_id)
        except work_order_service.WorkOrderAlreadyExistsError:
            continue
        if work_order is not None:
            created += 1

    print(f"\nCreated {created} work order(s).")


if __name__ == "__main__":
    main()
