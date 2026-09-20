from datetime import datetime, timezone

from fastapi import APIRouter, status

from app.schemas import ChatRequest, ChatResponse
from app.services import alert_service, llm_service, station_service

router = APIRouter(tags=["chat"])


def _relative_time(value: datetime | None) -> str:
    if value is None:
        return "unknown"

    now = datetime.now(timezone.utc)
    dt = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    seconds = max(0.0, (now - dt).total_seconds())

    if seconds < 60:
        return f"{int(seconds)}s ago"
    minutes = seconds / 60
    if minutes < 60:
        return f"{int(minutes)}m ago"
    hours = minutes / 60
    if hours < 24:
        return f"{hours:.1f}h ago"
    return f"{hours / 24:.1f}d ago"


def _severity_tier(value: float) -> str:
    """Same buckets the frontend's severityLevel() uses, so the bot's
    words match what a judge sees on screen."""
    if value >= 0.8:
        return "critical"
    if value >= 0.5:
        return "monitoring"
    return "low"


def _fmt(value: float | None, unit: str, digits: int = 1) -> str:
    return f"{value:.{digits}f}{unit}" if value is not None else "n/a"


def _build_context_snapshot() -> str:
    """A live, textual snapshot of the whole network -- fed to the LLM on
    every turn so it can answer both page-navigation questions ("what does
    this page show") and specific data questions ("what's Kolkata reading
    right now", "why is this alert low confidence") without inventing
    numbers. Deliberately verbose: the point of this chatbot is to let a
    judge get a real, grounded answer with nobody from the team present."""
    stations = station_service.list_stations()
    total = len(stations)
    if total == 0:
        return "No stations are currently loaded."

    by_status: dict[str, int] = {}
    for s in stations:
        by_status[s.status.value] = by_status.get(s.status.value, 0) + 1

    healths = [s.health for s in stations if s.health is not None]
    avg_health = sum(healths) / len(healths) if healths else None
    low_conf_stations = [s for s in stations if s.data_quality == "low_confidence"]

    worst = sorted(
        (s for s in stations if s.health is not None),
        key=lambda s: s.health,
    )[:5]

    name_by_id = {s.station_id: s.name for s in stations}
    open_alerts = alert_service.list_open_alerts()
    tier_counts = {"critical": 0, "monitoring": 0, "low": 0}
    reason_counts: dict[str, int] = {}
    for a in open_alerts:
        tier_counts[_severity_tier(a.severity)] += 1
        reason_counts[a.message] = reason_counts.get(a.message, 0) + 1

    top_alerts = sorted(open_alerts, key=lambda a: -a.severity)[:10]

    lines = [
        f"Snapshot time (UTC): {datetime.now(timezone.utc).isoformat(timespec='seconds')}",
        f"Total stations: {total}",
        f"Station status breakdown: {by_status}",
        f"Average health score (0-1) across stations reporting one: {avg_health:.3f}" if avg_health is not None else "Average health score: unavailable",
        f"Stations flagged as low-confidence data source (health/live readings intentionally hidden, not a live fault): {len(low_conf_stations)}"
        + (f" -- {', '.join(s.station_id for s in low_conf_stations[:10])}" if low_conf_stations else ""),
        "",
        f"Open alerts: {len(open_alerts)} total -- by severity tier: {tier_counts}",
        f"Open alerts by reason code: {reason_counts}" if reason_counts else "No open alerts by reason breakdown (none open).",
    ]

    if top_alerts:
        lines.append("")
        lines.append("Highest-severity open alerts right now (up to 10):")
        for a in top_alerts:
            name = name_by_id.get(a.station_id, a.station_id)
            lines.append(
                f"- {name} ({a.station_id}): reason={a.message}, severity_tier={_severity_tier(a.severity)} "
                f"(raw={a.severity:.2f}), confidence={a.confidence * 100:.0f}%, "
                f"opened {_relative_time(a.created_at)} -- \"{a.explanation or 'no narrated explanation yet'}\""
            )

    if worst:
        lines.append("")
        lines.append(
            "Lowest-health stations right now: "
            + ", ".join(f"{s.station_id} ({s.name}, health={s.health:.2f})" for s in worst)
        )

    lines.append("")
    lines.append("Per-station live telemetry (all stations):")
    for s in sorted(stations, key=lambda s: s.station_id):
        if s.data_quality == "low_confidence":
            reading_str = "T/P/RH hidden (low-confidence data source)"
        else:
            reading_str = f"T={_fmt(s.latest_temperature, 'C')} P={_fmt(s.latest_pressure, 'hPa', 0)} RH={_fmt(s.latest_humidity, '%', 0)}"
        health_str = f"{s.health:.2f}" if s.health is not None else "n/a"
        lines.append(
            f"- {s.station_id} ({s.name}): status={s.status.value}, health={health_str}, "
            f"{reading_str}, last_seen={_relative_time(s.last_seen)}, "
            f"days_to_service_threshold={s.days_to_threshold if s.days_to_threshold is not None else 'n/a'}"
        )

    return "\n".join(lines)


@router.post("/chat", response_model=ChatResponse, status_code=status.HTTP_200_OK)
def chat(request: ChatRequest) -> ChatResponse:
    snapshot = _build_context_snapshot()
    history = [{"role": turn.role, "content": turn.content} for turn in request.history]
    reply = llm_service.chat_reply(request.message, snapshot, history)
    return ChatResponse(reply=reply)
