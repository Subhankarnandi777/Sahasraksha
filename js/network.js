/* =========================================
   SKYGUARD AI
   NETWORK PAGE JAVASCRIPT
   ========================================= */


/* =========================================
   TAB SWITCHING
   ========================================= */

const tabs = document.querySelectorAll(".network-tab");

tabs.forEach(function(tab) {

    tab.addEventListener("click", function() {

        tabs.forEach(function(item) {
            item.classList.remove("active");
        });

        tab.classList.add("active");

        console.log("Selected:", tab.textContent.trim());

    });

});


/* =========================================
   STATION DATA
   ========================================= */

const stationData = {

    AWS_PNQ: {
        name: "Pune, Maharashtra",
        score: "91.2%",
        temperature: "27.4°C",
        pressure: "1008.4",
        humidity: "68%",
        status: "MONITOR"
    },

    AWS_DEL: {
        name: "Delhi Central",
        score: "42.1%",
        temperature: "31.2°C",
        pressure: "994.2",
        humidity: "54%",
        status: "SERVICE NOW"
    },

    AWS_BBI: {
        name: "Bhubaneswar, Odisha",
        score: "76.5%",
        temperature: "29.8°C",
        pressure: "1005.1",
        humidity: "72%",
        status: "MONITOR"
    }

};


/* =========================================
   SELECT STATION
   ========================================= */

function selectStation(stationID) {

    const station = stationData[stationID];

    if (!station) {
        return;
    }

    console.log("Selected station:", stationID);

    /*
       At this stage we display the selected
       station information.

       Later this can be connected to your
       real backend/API.
    */

    const stationTitle =
        document.querySelector(".selected-header h2");

    const stationLocation =
        document.querySelector(".selected-header p");

    const score =
        document.querySelector(".monitor-score");

    const sensors =
        document.querySelectorAll(".mini-sensor strong");


    if (stationTitle) {

        stationTitle.innerHTML =
            stationID +
            ' <span class="zone-badge">W-ZONE</span>';

    }


    if (stationLocation) {

        stationLocation.innerHTML =
            station.name;

    }


    if (score) {

        score.textContent =
            "🟡 " +
            station.status +
            " · " +
            station.score;

    }


    if (sensors.length >= 3) {

        sensors[0].textContent =
            station.temperature;

        sensors[1].textContent =
            station.pressure;

        sensors[2].textContent =
            station.humidity;

    }

}


/* =========================================
   LIVE STREAM
   ========================================= */

const playButton =
    document.querySelector(".play-button");

if (playButton) {

    playButton.addEventListener("click", function() {

        alert(
            "Live telemetry stream started.\n\n" +
            "INSAT-3DR synchronization active."
        );

    });

}


/* =========================================
   SEARCH BUTTON
   ========================================= */

const searchButton =
    document.querySelector(".title-buttons button:first-child");

if (searchButton) {

    searchButton.addEventListener("click", function() {

        const station =
            prompt(
                "Enter station ID or city name:"
            );

        if (station) {

            alert(
                "Searching station network for:\n" +
                station
            );

        }

    });

}


/* =========================================
   FILTER BUTTON
   ========================================= */

const filterButton =
    document.querySelector(".title-buttons button:last-child");

if (filterButton) {

    filterButton.addEventListener("click", function() {

        alert(
            "Network Filters\n\n" +
            "• Healthy stations\n" +
            "• Monitoring stations\n" +
            "• Critical stations\n" +
            "• No data stations"
        );

    });

}