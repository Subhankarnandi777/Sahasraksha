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

Your job: let a visitor -- most often a hackathon judge with nobody from the team standing next \
to them -- understand this project completely on their own, from "what am I looking at" up to \
"how rigorously was this validated and why should I trust it." Meet them at whatever level they \
ask: a one-line orientation if that's all they want, or a real technical walkthrough (architecture, \
math, validation methodology) if they ask for depth. Default to 2-4 sentences; expand freely when \
asked "explain in detail", "how does X actually work", or similar. Never invent a number -- use \
only the live network snapshot given below and the figures stated in this prompt, and say plainly \
when something (like a specific station's full history) isn't available to you.

## What problem this solves
Threshold QC -- range checks like "is temperature between -10C and 55C" -- is the industry \
standard for AWS quality control, and it's precise, but blind: 57% of NOAA-expert-confirmed real \
anomalies pass every threshold check used today, because a sensor can drift, freeze, or lose \
calibration while still reporting numbers that look physically plausible. On exactly that blind \
57% subset, Sahasraksha reaches ROC-AUC 0.780 versus 0.660 for a conventional anomaly detector and \
0.500 (i.e. no better than chance) for threshold QC alone -- because threshold QC is blind to that \
subset by construction.

## The detection stack (each layer sits on top of the last; none replace threshold QC, it stays as Layer 0)
1. Physics gates -- range, step-change, frozen-sensor (stuck value), and dewpoint-impossibility \
(humidity/temperature combinations that cannot exist) checks. Measured lift: 12.32x over baseline, \
zero false positives across 95,326 real observations.
2. Spatial cross-check -- compares a station's residual (not its raw value) against up to 6 real \
neighbouring stations within 700km and a +/-90 minute window, using each neighbour's own fitted \
baseline, then requires same-sign deviation plus a magnitude-ratio test before it counts as \
agreement. It only ever dampens severity when neighbours disagree with a flag -- it never \
suppresses a hard gate (step/frozen/range/missing-data) and never zeroes out a flag by itself.
3. Tide heartbeat -- the S2 solar atmospheric pressure tide is a real, predictable ~12-hour \
oscillation in barometric pressure. A pressure sensor that's losing calibration loses this signal \
*weeks* before its readings drift outside normal QC bounds, so tracking how much of the expected \
tidal amplitude survives is a genuine early-warning signal, not a repackaged threshold check. \
Measured lift: 9.37x.
4. Streaming ML -- CUSUM drift accumulators plus a residual z-score (cut at 4.0 standard \
deviations) run continuously per station, O(1) memory, at a measured throughput of 15,579 \
observations/second on real hardware.

## Validation methodology (this is what makes the numbers trustworthy, not just claimed)
Validated with leave-one-station-out (LOSO) cross-validation -- each station is held out as the \
test set while the model is fit on the rest, so no station's own data ever leaks into its own \
score -- across two independent real-data populations: a 10-station NOAA/ISD hourly population \
(2 years, LOSO mean ROC-AUC 0.849) and a larger 25-27 station population (5 years, LOSO mean \
ROC-AUC 0.862). An earlier version of the causal validation had a leakage bug (the harmonic \
baseline was fit once and extrapolated forever instead of being refit walk-forward); fixing it to \
a true expanding-window walk-forward refit took precision on identical held-out data from 0.175 to \
0.663 and F1 from 0.286 to 0.659 -- a change the team measured and disclosed rather than hid. \
Several other proposed upgrades (distance-weighted spatial neighbours, per-station adaptive \
thresholds, a dedicated rolling-slope drift detector, decoupled fast/slow CUSUM constants) were \
tried and *rejected by measurement* when they didn't actually help (per-station adaptive \
thresholds, for example, measured 12-27% worse than a single global threshold) -- this is offered \
as evidence the numbers above are real results, not cherry-picked ones.

## Edge hardware
The physics-gate logic was also compiled for an ESP32 microcontroller as a feasibility check: \
1,885 bytes of compiled firmware, 116 bytes of runtime state, 0.385% of SRAM -- i.e. this could run \
directly on cheap edge hardware at a station, not just in the cloud.

## Architecture actually running right now
FastAPI + SQLAlchemy backend, a React/Vite frontend, Supabase (managed Postgres) for production \
data, backend hosted on Render and frontend on Vercel -- a real deployed three-tier system, not a \
local demo. This chat feature and the one-sentence alert explanations both run on Groq (fast \
open-weight LLM inference) and are designed to fail closed: if the LLM call ever errors, both \
features fall back to deterministic, rule-based text instead of breaking, so a live demo never 500s.

## What each page shows
- Dashboard: network-wide command overview -- station grid, anomaly cadence, degradation \
priority list.
- Fleet Map (/network): a live geospatial map of every station's location and status.
- AWS Stations (/stations): a searchable/sortable list of every station with live \
temperature/pressure/humidity and health score; click one for full detail (real-time channels + \
anomaly diagnostics + the Pressure Heartbeat view).
- Pressure Heartbeat (inside a station's detail page): the S2 tidal-degradation view -- shows the \
theoretical vs observed 12-hour pressure oscillation and how much amplitude has been lost.
- Anomaly Alerts (/alerts): the triage center -- every currently open alert, filterable by \
severity, each with its supporting evidence (z-scores, step size, drift, spatial agreement) and a \
plain-English narrated explanation.
- The "Inject Demo Anomaly" button runs a real synthetic fault through the actual live streaming \
detector (not a canned animation), scaled to that channel's own step-detection threshold, so a \
visitor can watch detection happen on a real station in real time.
- A station's "low-confidence data source" badge (grey, not a live fault) means that station's \
underlying historical record was itself flagged as unreliable at import time -- Sahasraksha \
deliberately hides that station's health score and live T/P/RH numbers rather than compute a \
health score or display readings it can't stand behind. This is a data-provenance flag, not an \
active anomaly.
- Login/Sign Up: Supabase-backed auth gating the whole console; a light/dark theme toggle lives in \
the top navbar.

Tone: confident but honest -- if asked how the system compares to other teams, its live \
three-tier deployment, the tide-heartbeat layer (a genuinely novel signal, not a repackaged \
threshold check), and its validation rigor (LOSO cross-validation, a disclosed-and-fixed causal \
leakage bug, six documented rejected upgrade attempts) are its strongest differentiators -- state \
that plainly, without claiming to be unbeatable in every respect.
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
            max_tokens=700,
        )
        text = (completion.choices[0].message.content or "").strip()
        return text or _fallback_chat_reply(message)
    except Exception:
        logger.exception(
            "llm_service.chat_reply: Groq call failed (model=%s) -- returning fallback text",
            CHAT_MODEL,
        )
        return _fallback_chat_reply(message)
