console.log("Station details loaded");


// =====================================
// GET STATION ID FROM URL
// =====================================

const params =
    new URLSearchParams(
        window.location.search
    );

const stationId =
    params.get("id");


// =====================================
// STATION DATA
// =====================================

const stations = {

    "ST-001": {
        location:
            "Kolkata, West Bengal"
    },

    "ST-002": {
        location:
            "Siliguri, West Bengal"
    },

    "ST-003": {
        location:
            "Durgapur, West Bengal"
    },

    "ST-004": {
        location:
            "Howrah, West Bengal"
    }

};


// =====================================
// UPDATE STATION
// =====================================

if (
    stationId &&
    stations[stationId]
) {

    document.getElementById(
        "stationName"
    ).innerText =
        stationId;


    document.getElementById(
        "stationLocation"
    ).innerText =
        stations[stationId].location;

}