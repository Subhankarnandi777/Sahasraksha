from fastapi import APIRouter, status

from app.schemas import ChatRequest, ChatResponse
from app.services import alert_service, llm_service, station_service

router = APIRouter(tags=["chat"])


def _build_context_snapshot() -> str:
    """A short, cheap-to-generate text summary of live network state --
    grounds the chatbot's answers without shipping every station's full
    JSON into the prompt (60 stations of telemetry would dwarf the actual
    question on every single turn)."""
    stations = station_service.list_stations()
    total = len(stations)
    if total == 0:
        return "No stations are currently loaded."

    by_status: dict[str, int] = {}
    for s in stations:
        by_status[s.status.value] = by_status.get(s.status.value, 0) + 1

    healths = [s.health for s in stations if s.health is not None]
    avg_health = sum(healths) / len(healths) if healths else None

    worst = sorted(
        (s for s in stations if s.health is not None),
        key=lambda s: s.health,
    )[:3]

    open_alerts = alert_service.count_open_alerts()

    lines = [
        f"Total stations: {total}",
        f"Status breakdown: {by_status}",
        f"Average health score (0-1): {avg_health:.3f}" if avg_health is not None else "Average health score: unavailable",
        f"Open alerts: {open_alerts}",
    ]
    if worst:
        lines.append(
            "Lowest-health stations right now: "
            + ", ".join(f"{s.station_id} ({s.name}, health={s.health:.2f})" for s in worst)
        )
    return "\n".join(lines)


@router.post("/chat", response_model=ChatResponse, status_code=status.HTTP_200_OK)
def chat(request: ChatRequest) -> ChatResponse:
    snapshot = _build_context_snapshot()
    history = [{"role": turn.role, "content": turn.content} for turn in request.history]
    reply = llm_service.chat_reply(request.message, snapshot, history)
    return ChatResponse(reply=reply)
