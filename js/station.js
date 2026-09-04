console.log("Station details loaded");

const params = new URLSearchParams(window.location.search);
const stationId = params.get("id");

function latestRow(timeseries) {
    return timeseries && timeseries.length ? timeseries[timeseries.length - 1] : {};
}

function withUnit(value, unit, digits) {
    const formatted = SahasrakshaAPI.number(value, digits);
    return formatted === "—" ? formatted : `${formatted}${unit}`;
}

function setSensorCards(row) {
    const cards = document.querySelectorAll(".sensor-card");
    SahasrakshaAPI.setText(cards[0]?.querySelector("h2"), withUnit(row.T, "°C", 1));
    SahasrakshaAPI.setText(cards[1]?.querySelector("h2"), withUnit(row.RH, "%", 0));
    SahasrakshaAPI.setText(cards[2]?.querySelector("h2"), withUnit(row.P, " hPa", 1));
    SahasrakshaAPI.setText(cards[3]?.querySelector("h2"), "—");
}

function setHealthRows(station, latestVerdict) {
    const rows = document.querySelectorAll(".health-row");
    const statusText = station.status === "OK" ? "Normal" : station.status;
    const statusClass = station.status === "OK" ? "health-good" : "health-warning";

    rows.forEach((row) => {
        const value = row.querySelector("span:last-child");
        if (value) {
            value.className = statusClass;
            value.textContent = statusText;
        }
    });

    const pressureRow = rows[2]?.querySelector("span:last-child");
    if (pressureRow && latestVerdict?.degradation !== undefined) {
        pressureRow.textContent = `Degradation ${SahasrakshaAPI.percent(latestVerdict.degradation, 0)}`;
    }
}

function setAiStatus(station, alerts, verdicts) {
    const latestVerdict = verdicts[verdicts.length - 1];
    const score = latestVerdict?.confidence ?? alerts[0]?.confidence ?? 0;
    const scoreElement = document.querySelector(".ai-score");
    const titleElement = document.querySelector(".ai-status h3");
    const textElement = document.querySelector(".ai-status p");
    const aiCard = document.querySelector(".station-grid .card:nth-child(2)");

    SahasrakshaAPI.setText(scoreElement, SahasrakshaAPI.percent(score, 0));
    SahasrakshaAPI.setText(titleElement, "Anomaly Probability");
    SahasrakshaAPI.setText(
        textElement,
        `${station.status} · ${alerts.length} open alerts · Service window ${SahasrakshaAPI.daysToThreshold(station.days_to_threshold)} days`
    );

    const evidence = alerts[0]?.evidence || latestVerdict?.evidence || [];
    let evidenceElement = document.querySelector(".station-evidence");
    if (!evidenceElement && aiCard) {
        evidenceElement = document.createElement("div");
        evidenceElement.className = "station-evidence";
        aiCard.appendChild(evidenceElement);
    }

    if (evidenceElement) {
        evidenceElement.innerHTML = evidence.length
            ? evidence.map((pair) => `<p class="api-state">${SahasrakshaAPI.evidenceText(pair)}</p>`).join("")
            : `<p class="api-state">No evidence supplied.</p>`;
    }
}

async function loadStationDetail() {
    if (!stationId) {
        SahasrakshaAPI.setText("#stationName", "Station not selected");
        SahasrakshaAPI.setText("#stationLocation", "Open this page from the station list.");
        return;
    }

    try {
        const stations = await SahasrakshaAPI.getStations();
        const station = stations.find((item) => item.station_id === stationId);
        if (!station) {
            SahasrakshaAPI.setText("#stationName", stationId);
            SahasrakshaAPI.setText("#stationLocation", "Station was not found.");
            return;
        }

        const [timeseries, alerts, verdicts] = await Promise.all([
            SahasrakshaAPI.getStationTimeseries(stationId).catch(() => []),
            SahasrakshaAPI.getStationAlerts(stationId).catch(() => []),
            SahasrakshaAPI.getStationVerdicts(stationId).catch(() => [])
        ]);

        SahasrakshaAPI.setText("#stationName", station.station_id);
        SahasrakshaAPI.setText("#stationLocation", `${station.name} · Health ${SahasrakshaAPI.percent(station.health, 0)} · Threshold ${SahasrakshaAPI.daysToThreshold(station.days_to_threshold)} days`);

        const statusBadge = document.querySelector(".station-header .status");
        if (statusBadge) {
            statusBadge.className = `status ${SahasrakshaAPI.statusClass(station.status)}`;
            statusBadge.textContent = station.status;
        }

        setSensorCards(latestRow(timeseries));
        setHealthRows(station, verdicts[verdicts.length - 1]);
        setAiStatus(station, alerts.filter((alert) => alert.status === "open"), verdicts);
    } catch (error) {
        SahasrakshaAPI.setText("#stationName", stationId);
        SahasrakshaAPI.setText("#stationLocation", "Unable to load station details from the API.");
    }
}

loadStationDetail();
