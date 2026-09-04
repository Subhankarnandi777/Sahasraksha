console.log("Stations page loaded");


// =================================
// SEARCH STATIONS
// =================================

const searchInput =
    document.getElementById(
        "stationSearch"
    );


if (searchInput) {

    searchInput.addEventListener(
        "keyup",
        function() {

            const searchValue =
                this.value.toLowerCase();

            const rows =
                document.querySelectorAll(
                    "#stationTable tbody tr"
                );


            rows.forEach(
                function(row) {

                    const text =
                        row.innerText.toLowerCase();


                    if (
                        text.includes(searchValue)
                    ) {

                        row.style.display =
                            "";

                    } else {

                        row.style.display =
                            "none";

                    }

                }
            );

        }
    );

}


// =================================
// VIEW STATION
// =================================

function viewStation(stationId) {

    window.location.href =
        "station.html?id=" +
        stationId;

}