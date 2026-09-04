console.log("SkyGuard AI Dashboard Loaded");

let temperatureChart;
let fleetChart;

function statusCounts(stations) {
    return stations.reduce((counts, station) => {
        counts[station.status] = (counts[station.status] || 0) + 1;
        return counts;
    }, {});
}

function meanHealth(stations) {
    if (!stations.length) {
        return 0;
    }

    return stations.reduce((sum, station) => sum + Number(station.health || 0), 0) / stations.length;
}

function latestReading(timeseries) {
    return timeseries && timeseries.length ? timeseries[timeseries.length - 1] : null;
}

function withUnit(value, unit, digits) {
    const formatted = SahasrakshaAPI.number(value, digits);
    return formatted === "—" ? formatted : `${formatted}${unit}`;
}

function alertTitle(alert) {
    return alert.message ? alert.message.replace(/_/g, " ") : "AI anomaly";
}

function renderMiniAlerts(alerts) {
    const list = document.querySelector(".alert-list");
    if (!list) {
        return;
    }

    if (!alerts.length) {
        SahasrakshaAPI.showEmpty(list, "No active alerts.");
        return;
    }

    list.innerHTML = alerts.slice(0, 3).map((alert) => {
        const level = SahasrakshaAPI.severityLevel(alert.severity);
        return `
            <div class="mini-alert ${level}">
                <div>⚠</div>
                <div>
                    <strong>${alertTitle(alert)}</strong>
                    <p>Station ${alert.station_id}</p>
                </div>
                <span>${level.toUpperCase()}</span>
            </div>
        `;
    }).join("");
}

function renderTemperatureChart(timeseries) {
    const chartElement = document.getElementById("temperatureChart");
    if (!chartElement || !window.Chart) {
        return;
    }

    const rows = timeseries.slice(-12);
    const labels = rows.map((row) => new Date(row.timestamp).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit"
    }));
    const values = rows.map((row) => row.T);

    if (temperatureChart) {
        temperatureChart.destroy();
    }

    temperatureChart = new Chart(chartElement.getContext("2d"), {
        type: "line",
        data: {
            labels,
            datasets: [{
                label: "Temperature °C",
                data: values,
                borderWidth: 3,
                tension: 0.4,
                fill: false
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    display: true
                }
            },
            scales: {
                y: {
                    beginAtZero: false
                }
            }
        }
    });
}

function renderFleetChart(stations) {
    const chartElement = document.getElementById("fleetChart");
    if (!chartElement || !window.Chart) {
        return;
    }

    const ordered = stations.slice(0, 10);
    const labels = ordered.map((station) => station.station_id);
    const values = ordered.map((station) => Math.round(Number(station.health || 0) * 100));

    if (fleetChart) {
        fleetChart.destroy();
    }

    fleetChart = new Chart(chartElement, {
        type: "line",
        data: {
            labels,
            datasets: [
                {
                    label: "Fleet Health",
                    data: values,
                    borderWidth: 3,
                    tension: 0.4,
                    fill: false
                },
                {
                    label: "SLA Limit",
                    data: labels.map(() => 90),
                    borderWidth: 2,
                    borderDash: [6, 6],
                    tension: 0,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: "top"
                }
            },
            scales: {
                y: {
                    min: 0,
                    max: 100
                }
            }
        }
    });
}

async function loadStationAlerts(stations) {
    const results = await Promise.all(
        stations.map(async (station) => {
            try {
                return await SahasrakshaAPI.getStationAlerts(station.station_id);
            } catch (error) {
                return [];
            }
        })
    );

    return results.flat().filter((alert) => alert.status === "open");
}

function updateInnerDashboard(stations, health, alerts, latest) {
    SahasrakshaAPI.setText("#totalStations", health.station_count ?? stations.length);
    SahasrakshaAPI.setText("#onlineStations", stations.filter((station) => station.status !== "SERVICE NOW").length);
    SahasrakshaAPI.setText("#activeAlerts", health.open_alert_count ?? alerts.length);

    const systemHealth = document.querySelector(".stat-card:nth-child(4) h2");
    SahasrakshaAPI.setText(systemHealth, SahasrakshaAPI.percent(meanHealth(stations), 0));

    if (latest) {
        SahasrakshaAPI.setText("#temperature", withUnit(latest.T, "°C", 1));
        SahasrakshaAPI.setText("#humidity", withUnit(latest.RH, "%", 0));
        const pressureCard = document.querySelector(".sensor-card:nth-child(3) h2");
        SahasrakshaAPI.setText(pressureCard, withUnit(latest.P, " hPa", 1));
    }

    renderMiniAlerts(alerts);
}

function updateRootOverview(stations, health, alerts) {
    const counts = statusCounts(stations);
    const total = stations.length || 1;
    const ok = counts.OK || 0;
    const monitor = counts.MONITOR || 0;
    const schedule = counts.SCHEDULE || 0;
    const serviceNow = counts["SERVICE NOW"] || 0;

    SahasrakshaAPI.setText(".status-pill.healthy", `● ${ok} Healthy (${Math.round(ok / total * 100)}%)`);
    SahasrakshaAPI.setText(".status-pill.monitoring", `● ${monitor + schedule} Monitoring (${Math.round((monitor + schedule) / total * 100)}%)`);
    SahasrakshaAPI.setText(".status-pill.critical", `● ${serviceNow} Service Now (${Math.round(serviceNow / total * 100)}%)`);
    SahasrakshaAPI.setText(".health-card strong", SahasrakshaAPI.percent(meanHealth(stations), 1));
    SahasrakshaAPI.setText(".health-card small", `${health.station_count ?? stations.length} Active Stations Online`);
    SahasrakshaAPI.setText(".section-heading span b", `${health.open_alert_count ?? alerts.length} INCIDENTS`);
    SahasrakshaAPI.setText(".action-card h2", `${health.open_alert_count ?? alerts.length} Actionable Alerts`);
    SahasrakshaAPI.setText(".critical-box strong", serviceNow);
    SahasrakshaAPI.setText(".monitor-box strong", monitor + schedule);
}

async function loadDashboard() {
    try {
        const [health, stations] = await Promise.all([
            SahasrakshaAPI.getHealth(),
            SahasrakshaAPI.getStations()
        ]);

        const alerts = await loadStationAlerts(stations);
        const firstStation = stations[0];
        const timeseries = firstStation
            ? await SahasrakshaAPI.getStationTimeseries(firstStation.station_id).catch(() => [])
            : [];
        const latest = latestReading(timeseries);

        updateInnerDashboard(stations, health, alerts, latest);
        updateRootOverview(stations, health, alerts);
        renderTemperatureChart(timeseries);
        renderFleetChart(stations);
    } catch (error) {
        SahasrakshaAPI.setText(".system-status", "API unavailable");
        const alertList = document.querySelector(".alert-list");
        SahasrakshaAPI.showError(alertList, "Unable to load backend data.");
    }
}

loadDashboard();
