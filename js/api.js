const SahasrakshaAPI = (() => {
    const defaultBaseUrl = "http://127.0.0.1:8000";
    const configuredBaseUrl =
        window.SAHASRAKSHA_API_BASE_URL ||
        localStorage.getItem("sahasraksha.apiBaseUrl") ||
        defaultBaseUrl;

    const baseUrl = configuredBaseUrl.replace(/\/$/, "");

    async function request(path, options = {}) {
        const response = await fetch(baseUrl + path, {
            headers: {
                "Content-Type": "application/json",
                ...(options.headers || {})
            },
            ...options
        });

        if (!response.ok) {
            const message = await response.text();
            throw new Error(message || `API request failed: ${response.status}`);
        }

        if (response.status === 204) {
            return null;
        }

        return response.json();
    }

    function getHealth() {
        return request("/health");
    }

    function getStations() {
        return request("/stations");
    }

    function getStationTimeseries(stationId) {
        return request(`/stations/${encodeURIComponent(stationId)}/timeseries`);
    }

    function getStationAlerts(stationId) {
        return request(`/stations/${encodeURIComponent(stationId)}/alerts`);
    }

    function getStationVerdicts(stationId) {
        return request(`/stations/${encodeURIComponent(stationId)}/verdicts`);
    }

    function ingest(reading) {
        return request("/ingest", {
            method: "POST",
            body: JSON.stringify(reading)
        });
    }

    function percent(value, digits = 0) {
        if (value === null || value === undefined || Number.isNaN(Number(value))) {
            return "—";
        }
        return `${(Number(value) * 100).toFixed(digits)}%`;
    }

    function number(value, digits = 1) {
        if (value === null || value === undefined || Number.isNaN(Number(value))) {
            return "—";
        }
        return Number(value).toFixed(digits);
    }

    function daysToThreshold(value) {
        return value === null || value === undefined ? "—" : String(value);
    }

    function statusClass(status) {
        switch (status) {
            case "SERVICE NOW":
                return "offline";
            case "SCHEDULE":
                return "warning";
            case "MONITOR":
                return "warning";
            case "OK":
                return "online";
            default:
                return "warning";
        }
    }

    function severityLevel(score) {
        const value = Number(score || 0);
        if (value >= 0.8) {
            return "high";
        }
        if (value >= 0.5) {
            return "medium";
        }
        return "low";
    }

    function timeAgo(timestamp) {
        if (!timestamp) {
            return "—";
        }

        const date = new Date(timestamp);
        if (Number.isNaN(date.getTime())) {
            return "—";
        }

        const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
        if (seconds < 60) {
            return `${seconds} sec ago`;
        }

        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) {
            return `${minutes} min ago`;
        }

        const hours = Math.floor(minutes / 60);
        if (hours < 24) {
            return `${hours} hr ago`;
        }

        return `${Math.floor(hours / 24)} d ago`;
    }

    function evidenceText(pair) {
        const [key, value] = pair;
        const displayValue = number(value, 2);

        if (key.startsWith("spatial_z_")) {
            return `${key.replace("spatial_z_", "")}: ${displayValue} standard deviations from neighbours`;
        }
        if (key.startsWith("cusum_")) {
            return `${key.replace("cusum_", "")}: drift tally ${displayValue}`;
        }
        if (key === "tide_loss") {
            return `Pressure heartbeat loss ${displayValue}`;
        }
        if (key.startsWith("runlen_")) {
            return `${key.replace("runlen_", "")}: identical for ${displayValue} readings`;
        }
        if (key === "gate_dewpoint") {
            return "Dewpoint above air temperature";
        }

        return `${key}: ${displayValue}`;
    }

    function setText(selectorOrElement, value) {
        const element = typeof selectorOrElement === "string"
            ? document.querySelector(selectorOrElement)
            : selectorOrElement;
        if (element) {
            element.textContent = value;
        }
    }

    function showError(container, message) {
        if (container) {
            container.innerHTML = `<p class="api-state api-error">${message}</p>`;
        }
    }

    function showEmpty(container, message) {
        if (container) {
            container.innerHTML = `<p class="api-state">${message}</p>`;
        }
    }

    return {
        baseUrl,
        request,
        getHealth,
        getStations,
        getStationTimeseries,
        getStationAlerts,
        getStationVerdicts,
        ingest,
        percent,
        number,
        daysToThreshold,
        statusClass,
        severityLevel,
        timeAgo,
        evidenceText,
        setText,
        showError,
        showEmpty
    };
})();
