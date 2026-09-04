console.log("Diagnostics page loaded");

const diagnosticsTableBody = document.querySelector("table tbody");

function withUnit(value, unit, digits) {
    const formatted = SahasrakshaAPI.number(value, digits);
    return formatted === "—" ? formatted : `${formatted}${unit}`;
}

function renderDiagnosticsStats(health, stations) {
    const averageHealth = stations.length
        ? stations.reduce((sum, station) => sum + Number(station.health || 0), 0) / stations.length
        : 0;
    const dataQuality = stations.length
        ? 1 - stations.reduce((sum, station) => sum + Number(station.alert_rate_pct || 0), 0) / stations.length / 100
        : 0;

    const statValues = document.querySelectorAll(".stats-grid .stat-card h2");
    SahasrakshaAPI.setText(statValues[0], SahasrakshaAPI.percent(averageHealth, 0));
    SahasrakshaAPI.setText(statValues[1], health.station_count ?? stations.length);
    SahasrakshaAPI.setText(statValues[2], health.open_alert_count ?? 0);
    SahasrakshaAPI.setText(statValues[3], SahasrakshaAPI.percent(Math.max(dataQuality, 0), 0));
}

function sensorStatus(station) {
    return station.status === "OK" ? "Normal" : station.status;
}

function renderDiagnosticsTable(station, latest) {
    if (!diagnosticsTableBody) {
        return;
    }

    if (!station) {
        diagnosticsTableBody.innerHTML = `
            <tr>
                <td colspan="5">No station telemetry available.</td>
            </tr>
        `;
        return;
    }

    const statusClass = SahasrakshaAPI.statusClass(station.status);
    const quality = SahasrakshaAPI.percent(station.health, 0);
    const rows = [
        ["Temperature Sensor", withUnit(latest.T, "°C", 1)],
        ["Humidity Sensor", withUnit(latest.RH, "%", 0)],
        ["Pressure Sensor", withUnit(latest.P, " hPa", 1)],
        ["Station Heartbeat", SahasrakshaAPI.timeAgo(station.last_seen)]
    ];

    diagnosticsTableBody.innerHTML = rows.map(([sensor, reading]) => `
        <tr>
            <td>${sensor}</td>
            <td>
                <span class="status ${statusClass}">
                    ${sensorStatus(station)}
                </span>
            </td>
            <td>${reading}</td>
            <td>${quality}</td>
            <td>
                <button class="btn ${station.status === "OK" ? "btn-success" : "btn-primary"}">
                    ${station.status === "OK" ? "Healthy" : "Inspect"}
                </button>
            </td>
        </tr>
    `).join("");
}

async function loadDiagnostics() {
    if (diagnosticsTableBody) {
        diagnosticsTableBody.innerHTML = `
            <tr>
                <td colspan="5">Loading diagnostics...</td>
            </tr>
        `;
    }

    try {
        const [health, stations] = await Promise.all([
            SahasrakshaAPI.getHealth(),
            SahasrakshaAPI.getStations()
        ]);
        const station = stations[0];
        const timeseries = station
            ? await SahasrakshaAPI.getStationTimeseries(station.station_id).catch(() => [])
            : [];

        renderDiagnosticsStats(health, stations);
        renderDiagnosticsTable(station, timeseries[timeseries.length - 1] || {});
    } catch (error) {
        if (diagnosticsTableBody) {
            diagnosticsTableBody.innerHTML = `
                <tr>
                    <td colspan="5">Unable to load diagnostics from the API.</td>
                </tr>
            `;
        }
    }
}

function runDiagnostics() {
    loadDiagnostics();
}

loadDiagnostics();
setInterval(runDiagnostics, 30000);
