/* =========================================================
   SKYGUARD AI - NETWORK MONITORING
   ========================================================= */

console.log("Network monitoring loaded");


/* =========================================================
   GLOBAL VARIABLES
   ========================================================= */

let networkMap = null;
let networkMarkers = [];

const networkTableBody = document.querySelector("table tbody");


/* =========================================================
   MAP INITIALIZATION
   ========================================================= */

function initializeNetworkMap() {

    const mapElement = document.getElementById("networkMap");

    if (!mapElement) {
        console.error("Network map container #networkMap not found.");
        return;
    }

    if (typeof L === "undefined") {
        console.error("Leaflet is not loaded.");
        return;
    }

    if (networkMap) {
        return;
    }

    try {

        /*
         * Start with India / West Bengal area.
         * This allows the map to appear even when
         * the API currently has zero stations.
         */

        networkMap = L.map("networkMap").setView(
            [22.5726, 88.3639],
            7
        );


        /* OpenStreetMap tiles */

        L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            {
                maxZoom: 19,
                attribution:
                    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            }
        ).addTo(networkMap);


        /*
         * Fix Leaflet sizing after the card becomes visible.
         */

        setTimeout(function () {

            if (networkMap) {
                networkMap.invalidateSize();
            }

        }, 300);


        console.log("Network map initialized successfully.");

    } catch (error) {

        console.error(
            "Failed to initialize network map:",
            error
        );

    }
}


/* =========================================================
   MARKER COLOR
   ========================================================= */

function getMarkerColor(station) {

    const status = String(
        station.status || ""
    ).toUpperCase();


    /*
     * Offline / service states
     */

    if (
        status.includes("SERVICE") ||
        status.includes("OFFLINE") ||
        status.includes("DISCONNECTED")
    ) {
        return "#ef4444";
    }


    /*
     * Warning states
     */

    if (
        status.includes("WARNING") ||
        status.includes("DEGRADED") ||
        status.includes("ALERT")
    ) {
        return "#f59e0b";
    }


    /*
     * Healthy / online
     */

    return "#22c55e";
}


/* =========================================================
   GET STATION COORDINATES
   ========================================================= */

function getStationCoordinates(station) {

    const latitude =
        station.latitude ??
        station.lat ??
        station.latitude_deg ??
        station.lat_deg;

    const longitude =
        station.longitude ??
        station.lng ??
        station.lon ??
        station.longitude_deg ??
        station.lon_deg;

    const lat = Number(latitude);
    const lng = Number(longitude);


    if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
    ) {
        return null;
    }


    if (
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180
    ) {
        return null;
    }


    return [lat, lng];
}


/* =========================================================
   CREATE STATION MARKER
   ========================================================= */

function createStationMarker(station) {

    const coordinates =
        getStationCoordinates(station);

    if (!coordinates) {
        return null;
    }


    const color =
        getMarkerColor(station);


    /*
     * Custom circular marker
     */

    const markerIcon = L.divIcon({

        className: "skyguard-station-marker",

        html: `
            <div style="
                width: 18px;
                height: 18px;
                background: ${color};
                border: 3px solid white;
                border-radius: 50%;
                box-shadow: 0 2px 8px rgba(0,0,0,0.35);
            "></div>
        `,

        iconSize: [18, 18],

        iconAnchor: [9, 9]

    });


    const marker =
        L.marker(
            coordinates,
            {
                icon: markerIcon
            }
        );


    /*
     * Station information popup
     */

    const stationId =
        station.station_id ||
        station.id ||
        "Unknown";

    const stationName =
        station.name ||
        station.station_name ||
        "Weather Station";

    const status =
        station.status ||
        "UNKNOWN";

    const health =
        Number(station.health || 0);

    const lastSeen =
        station.last_seen ||
        station.lastSeen ||
        "Unknown";


    marker.bindPopup(`
        <div style="min-width: 190px;">

            <strong>${stationName}</strong>

            <br>

            <b>Station:</b>
            ${stationId}

            <br>

            <b>Status:</b>
            ${status}

            <br>

            <b>Signal:</b>
            ${health.toFixed(0)}%

            <br>

            <b>Last Communication:</b>
            ${lastSeen}

        </div>
    `);


    return marker;
}


/* =========================================================
   RENDER MAP MARKERS
   ========================================================= */

function renderNetworkMap(stations) {

    if (!networkMap) {
        return;
    }


    /*
     * Remove old markers
     */

    networkMarkers.forEach(function (marker) {

        networkMap.removeLayer(marker);

    });

    networkMarkers = [];


    /*
     * No stations
     */

    if (!Array.isArray(stations) || stations.length === 0) {

        console.log(
            "No stations available for map markers."
        );

        networkMap.setView(
            [22.5726, 88.3639],
            7
        );

        setTimeout(function () {

            networkMap.invalidateSize();

        }, 100);

        return;
    }


    const bounds = [];


    stations.forEach(function (station) {

        const marker =
            createStationMarker(station);


        if (!marker) {

            console.warn(
                "Station has no valid coordinates:",
                station
            );

            return;
        }


        marker.addTo(networkMap);

        networkMarkers.push(marker);


        const coordinates =
            getStationCoordinates(station);

        if (coordinates) {
            bounds.push(coordinates);
        }

    });


    /*
     * Automatically zoom to stations
     */

    if (bounds.length > 0) {

        networkMap.fitBounds(
            bounds,
            {
                padding: [40, 40],
                maxZoom: 10
            }
        );

    } else {

        /*
         * API has stations but no coordinates.
         */

        networkMap.setView(
            [22.5726, 88.3639],
            7
        );

        console.warn(
            "Stations were received, but none contain valid latitude/longitude values."
        );

    }


    setTimeout(function () {

        networkMap.invalidateSize();

    }, 100);
}


/* =========================================================
   RENDER TABLE
   ========================================================= */

function renderNetworkRows(stations) {

    if (!networkTableBody) {
        return;
    }


    if (
        !Array.isArray(stations) ||
        stations.length === 0
    ) {

        networkTableBody.innerHTML = `
            <tr>
                <td colspan="6">
                    No stations found.
                </td>
            </tr>
        `;

        return;
    }


    networkTableBody.innerHTML =
        stations.map(function (station) {

            const connected =
                station.status !== "SERVICE NOW";


            let statusClass = "offline";


            if (
                station.status &&
                typeof SahasrakshaAPI !== "undefined" &&
                SahasrakshaAPI.statusClass
            ) {

                statusClass =
                    SahasrakshaAPI.statusClass(
                        station.status
                    );

            }


            let health = "0%";

            if (
                typeof SahasrakshaAPI !== "undefined" &&
                SahasrakshaAPI.percent
            ) {

                health =
                    SahasrakshaAPI.percent(
                        station.health,
                        0
                    );

            } else {

                health =
                    `${Number(station.health || 0).toFixed(0)}%`;

            }


            let lastSeen =
                station.last_seen || "Unknown";


            if (
                typeof SahasrakshaAPI !== "undefined" &&
                SahasrakshaAPI.timeAgo &&
                station.last_seen
            ) {

                lastSeen =
                    SahasrakshaAPI.timeAgo(
                        station.last_seen
                    );

            }


            return `
                <tr>

                    <td>
                        ${station.station_id || station.id || "Unknown"}
                    </td>

                    <td>
                        ${station.name || station.station_name || "Unknown"}
                    </td>

                    <td>
                        <span class="status ${statusClass}">
                            ${station.status || "UNKNOWN"}
                        </span>
                    </td>

                    <td>
                        ${health}
                    </td>

                    <td>
                        ${connected ? "42 ms" : "—"}
                    </td>

                    <td>
                        ${lastSeen}
                    </td>

                </tr>
            `;

        }).join("");
}


/* =========================================================
   RENDER STATISTICS
   ========================================================= */

function renderNetworkStats(stations) {

    if (!Array.isArray(stations)) {
        stations = [];
    }


    /*
     * Connected stations
     */

    const connected =
        stations.filter(function (station) {

            const status =
                String(
                    station.status || ""
                ).toUpperCase();

            return (
                !status.includes("SERVICE") &&
                !status.includes("OFFLINE") &&
                !status.includes("DISCONNECTED")
            );

        }).length;


    /*
     * Disconnected stations
     */

    const disconnected =
        stations.length - connected;


    /*
     * Average health
     */

    const averageHealth =
        stations.length
            ? stations.reduce(
                function (sum, station) {

                    return (
                        sum +
                        Number(
                            station.health || 0
                        )
                    );

                },
                0
            ) / stations.length
            : 0;


    /*
     * Update cards
     */

    const statValues =
        document.querySelectorAll(
            ".stats-grid .stat-card h2"
        );


    if (statValues[0]) {
        statValues[0].textContent =
            connected;
    }


    if (statValues[1]) {
        statValues[1].textContent =
            disconnected;
    }


    if (statValues[2]) {
        statValues[2].textContent =
            `${averageHealth.toFixed(0)}%`;
    }


    if (statValues[3]) {
        statValues[3].textContent =
            "42 ms";
    }
}


/* =========================================================
   LOAD NETWORK DATA
   ========================================================= */

async function loadNetwork() {

    if (networkTableBody) {

        networkTableBody.innerHTML = `
            <tr>
                <td colspan="6">
                    Loading station network...
                </td>
            </tr>
        `;

    }


    try {

        /*
         * Get station data from backend API.
         */

        const stations =
            await SahasrakshaAPI.getStations();


        console.log(
            "Stations received from API:",
            stations
        );


        /*
         * Make sure we have an array.
         */

        const stationList =
            Array.isArray(stations)
                ? stations
                : [];


        /*
         * Update everything.
         */

        renderNetworkStats(
            stationList
        );

        renderNetworkRows(
            stationList
        );

        renderNetworkMap(
            stationList
        );


    } catch (error) {

        console.error(
            "Failed to load network data:",
            error
        );


        if (networkTableBody) {

            networkTableBody.innerHTML = `
                <tr>
                    <td colspan="6">
                        Unable to load station network from the API.
                    </td>
                </tr>
            `;

        }

    }
}


/* =========================================================
   REFRESH NETWORK
   ========================================================= */

function checkNetwork() {

    loadNetwork();

}


/* =========================================================
   START
   ========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    function () {

        /*
         * Initialize map first.
         */

        initializeNetworkMap();


        /*
         * Then load station data.
         */

        loadNetwork();


        /*
         * Refresh every 30 seconds.
         */

        setInterval(
            checkNetwork,
            30000
        );

    }
);