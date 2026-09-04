// =====================================
// SKYGUARD AI DASHBOARD
// =====================================

console.log("SkyGuard AI Dashboard Loaded");


// =====================================
// SENSOR DATA
// =====================================

let temperature = 28.4;
let humidity = 67;


// =====================================
// UPDATE SENSOR DATA
// =====================================

function updateSensorData() {

    temperature =
        (28 + Math.random() * 2).toFixed(1);

    humidity =
        Math.floor(64 + Math.random() * 8);

    const temperatureElement =
        document.getElementById("temperature");

    const humidityElement =
        document.getElementById("humidity");


    if (temperatureElement) {

        temperatureElement.innerText =
            temperature + "°C";

    }


    if (humidityElement) {

        humidityElement.innerText =
            humidity + "%";

    }

}


// Update every 5 seconds

setInterval(
    updateSensorData,
    5000
);


// =====================================
// TEMPERATURE CHART
// =====================================

const chartElement =
    document.getElementById(
        "temperatureChart"
    );


if (chartElement) {

    const ctx =
        chartElement.getContext("2d");


    new Chart(ctx, {

        type: "line",

        data: {

            labels: [
                "12 AM",
                "2 AM",
                "4 AM",
                "6 AM",
                "8 AM",
                "10 AM",
                "12 PM",
                "2 PM",
                "4 PM",
                "6 PM",
                "8 PM",
                "10 PM"
            ],

            datasets: [

                {
                    label:
                        "Temperature °C",

                    data: [
                        24,
                        23.5,
                        23,
                        24,
                        26,
                        28,
                        29,
                        30,
                        29,
                        28,
                        27,
                        26
                    ],

                    borderWidth: 3,

                    tension: 0.4,

                    fill: false
                }

            ]

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
const ctx = document.getElementById("fleetChart");

if (ctx) {

    new Chart(ctx, {

        type: "line",

        data: {

            labels: [
                "Day 1",
                "Day 2",
                "Day 3",
                "Day 4",
                "Day 5",
                "Day 6",
                "Day 7",
                "Day 8",
                "Day 9",
                "Day 10"
            ],

            datasets: [

                {
                    label: "Fleet Health",
                    data: [
                        94.0,
                        94.1,
                        93.8,
                        93.6,
                        93.2,
                        93.0,
                        92.8,
                        92.7,
                        92.5,
                        92.4
                    ],

                    borderWidth: 3,
                    tension: 0.4,
                    fill: false
                },

                {
                    label: "SLA Limit",
                    data: [
                        90,
                        90,
                        90,
                        90,
                        90,
                        90,
                        90,
                        90,
                        90,
                        90
                    ],

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
                    min: 85,
                    max: 100
                }

            }

        }

    });

}