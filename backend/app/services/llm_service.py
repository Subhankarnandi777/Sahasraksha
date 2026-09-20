"""
Thin Groq wrapper for two judge-facing features:

  1. narrate_evidence() -- turns an alert's evidence tuple into one
     plain-English sentence (kaivalyabandi's idea from the competitor
     survey; cheap presentation layer on top of the physics/ML detector
     that already exists, not a new subsystem).
  2. chat_reply() -- answers a judge's question about the site/project,
     grounded in a live snapshot of the network so it can answer both
     "what does this page show" and "how many stations are healthy
     right now" style questions.

Both fail closed: if GROQ_API_KEY is unset, the `groq` package is
missing, or the API call errors/times out, each function falls back to
a deterministic, rule-based answer rather than raising -- a live demo
in front of judges must never 500 because an LLM call hiccuped.
"""
import logging
import os
from typing import Any

logger = logging.getLogger("sahasraksha.llm")

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
# groq deprecated llama-3.1-8b-instant / llama-3.3-70b-versatile to
# Enterprise-only access on 2026-08-16; every developer/free-tier key now
# gets a 4xx on those model IDs. openai/gpt-oss-20b and openai/gpt-oss-120b
# are their supported replacements (faster + cheaper too).
NARRATION_MODEL = os.getenv("GROQ_NARRATION_MODEL", "openai/gpt-oss-20b")
CHAT_MODEL = os.getenv("GROQ_CHAT_MODEL", "openai/gpt-oss-120b")
REQUEST_TIMEOUT_S = 8.0

_client = None
_client_init_failed = False


def _get_client():
    global _client, _client_init_failed
    if _client is not None or _client_init_failed:
        return _client
    if not GROQ_API_KEY:
        _client_init_failed = True
        logger.warning("llm_service: GROQ_API_KEY is unset -- falling back to rule-based text")
        return None
    try:
        from groq import Groq

        _client = Groq(api_key=GROQ_API_KEY, timeout=REQUEST_TIMEOUT_S)
    except Exception:
        _client_init_failed = True
        _client = None
        logger.exception("llm_service: failed to construct Groq client -- falling back to rule-based text")
    return _client


# --------------------------------------------------------------------------
# 1. Evidence -> plain English
# --------------------------------------------------------------------------

_CHANNEL_NAMES = {"T": "temperature", "P": "pressure", "RH": "humidity"}


def _fallback_narration(station_name: str, reason: str, severity: float, evidence: list) -> str:
    """Deterministic, rule-based sentence -- same information the frontend's
    evidenceText() already renders, just assembled into one sentence. Used
    whenever the LLM path is unavailable, so the feature degrades gracefully
    rather than disappearing."""
    ev = {str(k): v for k, v in (evidence or []) if isinstance(k, str)}
    severity_word = "a severe" if severity >= 0.8 else "a moderate" if severity >= 0.5 else "a minor"

    for key, val in ev.items():
        if key.startswith("step_"):
            ch = _CHANNEL_NAMES.get(key.replace("step_", ""), key)
            return f"{station_name}'s {ch} jumped {val:.1f} in a single reading -- {severity_word} step change outside normal sensor behaviour."
        if key.startswith("runlen_"):
            ch = _CHANNEL_NAMES.get(key.replace("runlen_", ""), key)
            return f"{station_name}'s {ch} reading has been frozen at the same value for {int(val)} consecutive readings, suggesting a stuck sensor."
        if key == "tide_loss":
            return f"{station_name}'s pressure sensor has lost {val * 100:.0f}% of its expected daily tidal signal -- a sign of slow calibration drift, not a one-off spike."
        if key.startswith("cusum_"):
            ch = _CHANNEL_NAMES.get(key.replace("cusum_", ""), key)
            return f"{station_name}'s {ch} has been drifting steadily off its expected baseline (cumulative drift score {val:.1f})."
        if key.startswith("range_"):
            ch = _CHANNEL_NAMES.get(key.replace("range_", ""), key)
            return f"{station_name} reported a {ch} value outside physically possible bounds for a weather station."
        if key == "dewpoint_violation":
            return f"{station_name} reported a temperature/humidity combination that is thermodynamically impossible (dew point above air temperature)."

    return f"{station_name} triggered {severity_word} anomaly ({reason}); see evidence for details."


def narrate_evidence(
    station_name: str,
    reason: str,
    severity: float,
    degradation: float,
    evidence: list,
) -> str:
    fallback = _fallback_narration(station_name, reason, severity, evidence)
    client = _get_client()
    if client is None:
        return fallback

    evidence_str = ", ".join(f"{k}={v}" for k, v in (evidence or []) if isinstance(k, str))
    prompt = (
        "You are writing a one-sentence, plain-English explanation of a weather-station "
        "anomaly for a non-technical reader (a disaster-management official or a judge). "
        "Do not invent numbers not given below. Do not use markdown. One sentence only.\n\n"
        f"Station: {station_name}\n"
        f"Detected reason code: {reason}\n"
        f"Severity (0-1): {severity:.2f}\n"
        f"Tide-heartbeat degradation (0-1): {degradation:.2f}\n"
        f"Raw evidence: {evidence_str or 'none'}\n"
    )
    try:
        completion = client.chat.completions.create(
            model=NARRATION_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=80,
        )
        text = (completion.choices[0].message.content or "").strip()
        return text or fallback
    except Exception:
        logger.exception(
            "llm_service.narrate_evidence: Groq call failed (model=%s) -- returning fallback text",
            NARRATION_MODEL,
        )
        return fallback


# --------------------------------------------------------------------------
# 2. Site-guide chatbot
# --------------------------------------------------------------------------

_SYSTEM_PROMPT = """You are the on-site guide for Sahasraksha (formerly SkyGuard AI), a live \
anomaly-detection platform for India's Automatic Weather Station (AWS) network, built for \
Smart India Hackathon 2026, problem statement SIH26073 (Ministry of Earth Sciences / IMD).

Your job: help a visitor (often a hackathon judge) understand what they are looking at and how \
to navigate the site. Be concise -- 2-4 sentences unless asked for more detail. Never invent \
numbers; use only the live network snapshot given below, and say so plainly if something isn't \
in it.

What the system does: threshold QC (the industry standard) is precise but only catches 38% of \
real anomalies -- 57% of NOAA-expert-confirmed anomalies pass every threshold check used today. \
Sahasraksha keeps threshold QC as Layer 0 unmodified and adds: physics gates (range/step/frozen/ \
dewpoint-impossibility checks), a spatial cross-check (compares each station's residual against \
up to 6 real neighbours within 700km using each neighbour's own fitted baseline), a "tide \
heartbeat" layer (the S2 solar atmospheric pressure tide has a predictable 12-hour cycle; a \
degrading pressure sensor loses this signal weeks before it drifts outside normal QC bounds -- a \
genuinely novel early-warning signal), and streaming CUSUM + residual z-score ML on top. \
Validated via leave-one-station-out cross-validation on real NOAA/ISD data across two \
populations (up to 27 stations, 5 years).

What each page shows:
- Dashboard: network-wide command overview -- station grid, anomaly cadence, degradation \
priority list.
- Network: a live geospatial map of every station's location and status.
- Stations: a searchable/sortable list of every station with live temperature/pressure/humidity \
and health score; click one for full detail (real-time channels + anomaly diagnostics).
- Pressure Heartbeat (inside a station's detail page): the S2 tidal-degradation view -- shows the \
theoretical vs observed 12-hour pressure oscillation and how much amplitude has been lost.
- Alerts: the anomaly triage center -- every currently open alert, filterable by severity, each \
with its supporting evidence (z-scores, step size, drift, spatial agreement).
- The "Inject Demo Anomaly" button runs a real synthetic fault through the actual live detector \
(not a canned animation) so a visitor can watch detection happen in real time.

Tone: confident but honest -- if asked how the system compares to other teams, say Sahasraksha's \
live three-tier deployment (Render + Vercel + Supabase) and validation rigor (LOSO cross-\
validation, walk-forward causal-leakage fix, documented rejected upgrade attempts) are its \
strongest differentiators, without claiming to be unbeatable in every respect.
"""


def _fallback_chat_reply(message: str) -> str:
    return (
        "I'm having trouble reaching my reasoning engine right now, so I can't answer that in "
        "detail. In short: this dashboard monitors India's Automatic Weather Stations for sensor "
        "faults using physics checks, a spatial neighbour cross-check, a pressure \"tide "
        "heartbeat\" drift detector, and ML on the residuals -- see the Stations, Network and "
        "Alerts pages, or try the \"Inject Demo Anomaly\" button to see it catch a live fault."
    )


def chat_reply(message: str, context_snapshot: str, history: list[dict[str, str]] | None = None) -> str:
    client = _get_client()
    if client is None:
        return _fallback_chat_reply(message)

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": _SYSTEM_PROMPT + f"\n\nLive network snapshot:\n{context_snapshot}\n"}
    ]
    for turn in (history or [])[-6:]:
        role = turn.get("role")
        content = turn.get("content")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": str(content)[:2000]})
    messages.append({"role": "user", "content": message[:2000]})

    try:
        completion = client.chat.completions.create(
            model=CHAT_MODEL,
            messages=messages,
            temperature=0.4,
            max_tokens=400,
        )
        text = (completion.choices[0].message.content or "").strip()
        return text or _fallback_chat_reply(message)
    except Exception:
        logger.exception(
            "llm_service.chat_reply: Groq call failed (model=%s) -- returning fallback text",
            CHAT_MODEL,
        )
        return _fallback_chat_reply(message)
