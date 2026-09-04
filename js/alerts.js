console.log("AI Alerts loaded");

const alertContainer = document.querySelector(".alert-container");
const summaryCards = document.querySelectorAll(".alert-summary-card h2");

function alertHeading(alert) {
    return alert.message ? alert.message.replace(/_/g, " ") : "AI anomaly";
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

    return alertGroups.flat().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
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
        const evidence = (alert.evidence || []).map((pair) => `
            <small>${SahasrakshaAPI.evidenceText(pair)}</small>
        `).join("");

        return `
            <div class="ai-alert ${level}-alert">
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
                <button class="btn btn-danger" onclick="acknowledgeAlert(this)">
                    Acknowledge
                </button>
            </div>
        `;
    }).join("");
}

async function loadAlerts() {
    if (alertContainer) {
        SahasrakshaAPI.showEmpty(alertContainer, "Loading alerts...");
    }

    try {
        const alerts = (await loadAllAlerts()).filter((alert) => alert.status === "open");
        renderSummary(alerts);
        renderAlerts(alerts);
    } catch (error) {
        renderSummary([]);
        SahasrakshaAPI.showError(alertContainer, "Unable to load alerts from the API.");
    }
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
