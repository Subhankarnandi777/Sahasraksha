console.log("Stations page loaded");

const stationTableBody = document.querySelector("#stationTable tbody");
const stationCountText = document.querySelector(".card-header p");
const searchInput = document.getElementById("stationSearch");

function stationStatusBadge(status) {
    return `<span class="status ${SahasrakshaAPI.statusClass(status)}">${status}</span>`;
}

function latestValues(timeseries) {
    return timeseries && timeseries.length ? timeseries[timeseries.length - 1] : {};
}

function withUnit(value, unit, digits) {
    const formatted = SahasrakshaAPI.number(value, digits);
    return formatted === "—" ? formatted : `${formatted}${unit}`;
}

function renderStationRows(stations, latestByStation) {
    if (!stationTableBody) {
        return;
    }

    if (!stations.length) {
        stationTableBody.innerHTML = `
            <tr>
                <td colspan="7">No stations found.</td>
            </tr>
        `;
        return;
    }

    stationTableBody.innerHTML = stations.map((station) => {
        const latest = latestByStation[station.station_id] || {};
        return `
            <tr>
                <td>${station.station_id}</td>
                <td>${station.name}</td>
                <td>${stationStatusBadge(station.status)}</td>
                <td>${withUnit(latest.T, "°C", 1)}</td>
                <td>${withUnit(latest.RH, "%", 0)}</td>
                <td>${SahasrakshaAPI.percent(station.health, 0)}</td>
                <td>
                    <button class="btn btn-primary" data-station-id="${station.station_id}">
                        View
                    </button>
                </td>
            </tr>
        `;
    }).join("");
}

async function loadStations() {
    if (stationTableBody) {
        stationTableBody.innerHTML = `
            <tr>
                <td colspan="7">Loading stations...</td>
            </tr>
        `;
    }

    try {
        const stations = await SahasrakshaAPI.getStations();
        if (stationCountText) {
            stationCountText.textContent = `${stations.length} registered weather stations`;
        }

        const latestPairs = await Promise.all(
            stations.map(async (station) => {
                try {
                    const timeseries = await SahasrakshaAPI.getStationTimeseries(station.station_id);
                    return [station.station_id, latestValues(timeseries)];
                } catch (error) {
                    return [station.station_id, {}];
                }
            })
        );

        renderStationRows(stations, Object.fromEntries(latestPairs));
    } catch (error) {
        if (stationTableBody) {
            stationTableBody.innerHTML = `
                <tr>
                    <td colspan="7">Unable to load stations from the API.</td>
                </tr>
            `;
        }
    }
}

if (searchInput) {
    searchInput.addEventListener("keyup", function() {
        const searchValue = this.value.toLowerCase();
        const rows = document.querySelectorAll("#stationTable tbody tr");

        rows.forEach(function(row) {
            const text = row.innerText.toLowerCase();
            row.style.display = text.includes(searchValue) ? "" : "none";
        });
    });
}

if (stationTableBody) {
    stationTableBody.addEventListener("click", function(event) {
        const button = event.target.closest("[data-station-id]");
        if (button) {
            viewStation(button.dataset.stationId);
        }
    });
}

function viewStation(stationId) {
    window.location.href = "station.html?id=" + encodeURIComponent(stationId);
}

loadStations();
