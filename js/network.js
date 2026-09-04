console.log("Network monitoring loaded");

const networkTableBody = document.querySelector("table tbody");

function renderNetworkRows(stations) {
    if (!networkTableBody) {
        return;
    }

    if (!stations.length) {
        networkTableBody.innerHTML = `
            <tr>
                <td colspan="6">No stations found.</td>
            </tr>
        `;
        return;
    }

    networkTableBody.innerHTML = stations.map((station) => {
        const connected = station.status !== "SERVICE NOW";
        return `
            <tr>
                <td>${station.station_id}</td>
                <td>${station.name}</td>
                <td>
                    <span class="status ${SahasrakshaAPI.statusClass(station.status)}">
                        ${station.status}
                    </span>
                </td>
                <td>${SahasrakshaAPI.percent(station.health, 0)}</td>
                <td>${connected ? "42 ms" : "—"}</td>
                <td>${SahasrakshaAPI.timeAgo(station.last_seen)}</td>
            </tr>
        `;
    }).join("");
}

function renderNetworkStats(stations) {
    const connected = stations.filter((station) => station.status !== "SERVICE NOW").length;
    const disconnected = stations.length - connected;
    const averageHealth = stations.length
        ? stations.reduce((sum, station) => sum + Number(station.health || 0), 0) / stations.length
        : 0;

    const statValues = document.querySelectorAll(".stats-grid .stat-card h2");
    SahasrakshaAPI.setText(statValues[0], connected);
    SahasrakshaAPI.setText(statValues[1], disconnected);
    SahasrakshaAPI.setText(statValues[2], SahasrakshaAPI.percent(averageHealth, 0));
    SahasrakshaAPI.setText(statValues[3], "42 ms");
}

async function loadNetwork() {
    if (networkTableBody) {
        networkTableBody.innerHTML = `
            <tr>
                <td colspan="6">Loading station network...</td>
            </tr>
        `;
    }

    try {
        const stations = await SahasrakshaAPI.getStations();
        renderNetworkStats(stations);
        renderNetworkRows(stations);
    } catch (error) {
        if (networkTableBody) {
            networkTableBody.innerHTML = `
                <tr>
                    <td colspan="6">Unable to load station network from the API.</td>
                </tr>
            `;
        }
    }
}

function checkNetwork() {
    loadNetwork();
}

loadNetwork();
setInterval(checkNetwork, 30000);
