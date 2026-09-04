/* =========================================
   SKYGUARD AI
   ALERTS CENTER JAVASCRIPT
   ========================================= */

const alertContainer = document.querySelector(".alert-container");
const summaryCards = document.querySelectorAll(".alert-summary-card h2");
const filterButtons = document.querySelectorAll(".filter");

let currentAlerts = [];

function alertHeading(alert) {
    return alert.message ? alert.message.replace(/_/g, " ") : "AI anomaly";
}

function alertFilterType(alert) {
    const message = (alert.message || "").toLowerCase();
    const evidenceKeys = (alert.evidence || []).map((pair) => String(pair[0]).toLowerCase());
    const level = SahasrakshaAPI.severityLevel(alert.severity);

    if (message.includes("missing") || message.includes("no data") || evidenceKeys.some((key) => key.includes("missing"))) {
        return "nodata";
    }

    if (level === "high") {
        return "critical";
    }

    return "monitoring";
}

async function loadAllAlerts() {
    const stations = await SahasrakshaAPI.getStations();
    const alertGroups = await Promise.all(
        stations.map(async (station) => {
            try {
                return await SahasrakshaAPI.getStationAlerts(station.station_id);
            } catch (error) {
                return [];
            }
        })
    );

    return alertGroups
        .flat()
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function renderSummary(alerts) {
    const counts = alerts.reduce((result, alert) => {
        const level = SahasrakshaAPI.severityLevel(alert.severity);
        result[level] += 1;
        return result;
    }, { high: 0, medium: 0, low: 0 });

    SahasrakshaAPI.setText(summaryCards[0], counts.high);
    SahasrakshaAPI.setText(summaryCards[1], counts.medium);
    SahasrakshaAPI.setText(summaryCards[2], counts.low);
}

function renderAlerts(alerts) {
    if (!alertContainer) {
        return;
    }

    if (!alerts.length) {
        SahasrakshaAPI.showEmpty(alertContainer, "No active anomalies.");
        return;
    }

    alertContainer.innerHTML = alerts.map((alert) => {
        const level = SahasrakshaAPI.severityLevel(alert.severity);
        const filterType = alertFilterType(alert);
        const evidence = (alert.evidence || []).map((pair) => `
            <small>${SahasrakshaAPI.evidenceText(pair)}</small>
        `).join("");

        return `
            <div class="ai-alert ${level}-alert alert-card" data-type="${filterType}" data-alert-id="${alert.id}">
                <div class="alert-icon">⚠</div>
                <div class="alert-content">
                    <div class="alert-title">
                        <h3>${alertHeading(alert)}</h3>
                        <span class="severity ${level}">${level.toUpperCase()}</span>
                    </div>
                    <p>Station ${alert.station_id} · Confidence ${SahasrakshaAPI.percent(alert.confidence, 0)} · Degradation ${SahasrakshaAPI.percent(alert.degradation, 0)}</p>
                    ${evidence || "<small>No evidence supplied.</small>"}
                    <small>Anomaly Score: ${SahasrakshaAPI.percent(alert.severity, 0)} · ${SahasrakshaAPI.timeAgo(alert.created_at)}</small>
                </div>
                <button class="btn btn-primary" onclick="viewAlert('${alert.id}')">
                    View
                </button>
                <button class="btn btn-danger" onclick="acknowledgeAlert(this)">
                    Acknowledge
                </button>
            </div>
        `;
    }).join("");

    applyCurrentFilter();
}

function activeFilter() {
    const activeButton = document.querySelector(".filter.active");
    return activeButton ? activeButton.getAttribute("data-filter") : "all";
}

function applyCurrentFilter() {
    const filter = activeFilter();
    const cards = document.querySelectorAll(".alert-card");

    cards.forEach((card) => {
        const type = card.getAttribute("data-type");
        card.style.display = filter === "all" || type === filter ? "" : "none";
    });
}

async function loadAlerts() {
    if (alertContainer) {
        SahasrakshaAPI.showEmpty(alertContainer, "Loading alerts...");
    }

    try {
        currentAlerts = (await loadAllAlerts()).filter((alert) => alert.status === "open");
        renderSummary(currentAlerts);
        renderAlerts(currentAlerts);
    } catch (error) {
        currentAlerts = [];
        renderSummary([]);
        SahasrakshaAPI.showError(alertContainer, "Unable to load alerts from the API.");
    }
}

filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
        filterButtons.forEach((btn) => {
            btn.classList.remove("active");
        });

        button.classList.add("active");
        applyCurrentFilter();
    });
});

function viewAlert(alertId) {
    const alert = currentAlerts.find((item) => String(item.id) === String(alertId));

    if (!alert) {
        window.alert("Alert information unavailable.");
        return;
    }

    const evidence = (alert.evidence || [])
        .map((pair) => `- ${SahasrakshaAPI.evidenceText(pair)}`)
        .join("\n");

    window.alert(
        `${alert.station_id}\n\n` +
        `${alertHeading(alert)}\n\n` +
        `Confidence: ${SahasrakshaAPI.percent(alert.confidence, 0)}\n` +
        `Severity: ${SahasrakshaAPI.percent(alert.severity, 0)}\n` +
        `Degradation: ${SahasrakshaAPI.percent(alert.degradation, 0)}\n\n` +
        `${evidence || "No evidence supplied."}`
    );
}

function acknowledgeAlert(button) {
    const alert = button.closest(".ai-alert");

    if (alert) {
        alert.style.opacity = "0.5";
        button.innerText = "Acknowledged";
        button.disabled = true;
    }
}

loadAlerts();
