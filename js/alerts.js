/* =========================================
   SKYGUARD AI
   ALERTS CENTER JAVASCRIPT
   ========================================= */


/* =========================================
   ALERT FILTER
   ========================================= */

const filterButtons =
    document.querySelectorAll(".filter");

const alertCards =
    document.querySelectorAll(".alert-card");


filterButtons.forEach(function(button) {

    button.addEventListener("click", function() {

        /* Remove active from all buttons */

        filterButtons.forEach(function(btn) {

            btn.classList.remove("active");

        });


        /* Activate clicked button */

        button.classList.add("active");


        const filter =
            button.getAttribute("data-filter");


        /* Show / hide alerts */

        alertCards.forEach(function(card) {

            const type =
                card.getAttribute("data-type");


            if (filter === "all") {

                card.style.display = "block";

            }

            else if (type === filter) {

                card.style.display = "block";

            }

            else {

                card.style.display = "none";

            }

        });

    });

});


/* =========================================
   VIEW ALERT
   ========================================= */

function viewAlert(stationID) {

    const alertInfo = {

        AWS_DEL:
            "AWS_DEL - Delhi\n\n" +
            "Pressure sensor diaphragm failure imminent.\n\n" +
            "Confidence: 94%\n" +
            "Spatial deviation: 6.2σ\n" +
            "Pressure drift: 14.1 hPa\n" +
            "Heartbeat: -51%",

        AWS_HYD:
            "AWS_HYD - Hyderabad\n\n" +
            "Aspirator fan stall detected.\n\n" +
            "Temperature bias: +3.7°C\n" +
            "Status: Monitoring",

        AWS_CHN:
            "AWS_CHN - Chennai Coast\n\n" +
            "Barometer port salt encrustation detected.\n\n" +
            "Status: Monitoring",

        AWS_KOL:
            "AWS_KOL - Kolkata\n\n" +
            "No telemetry heartbeat received.\n\n" +
            "Status: No Data"

    };


    alert(
        alertInfo[stationID] ||
        "Alert information unavailable."
    );

}


/* =========================================
   LIVE ALERT COUNT
   ========================================= */

console.log(
    "SkyGuard AI Alerts Center loaded."
);

console.log(
    "12 active anomalies detected."
);