/* =====================================================
   SKYGUARD AI - STATIONS JAVASCRIPT
   ===================================================== */


/* =====================================================
   ELEMENTS
   ===================================================== */

const searchInput =
    document.getElementById("stationSearch");

const stationCards =
    document.querySelectorAll(".station-card");

const filterButtons =
    document.querySelectorAll(".filter-btn");

const stationCount =
    document.getElementById("stationCount");

const sortButton =
    document.getElementById("sortButton");


/* =====================================================
   CURRENT FILTER
   ===================================================== */

let currentFilter = "all";


/* =====================================================
   FILTER STATIONS
   ===================================================== */

function filterStations() {

    const searchText =
        searchInput.value
            .toLowerCase()
            .trim();


    let visibleStations = 0;


    stationCards.forEach(function(card) {

        const status =
            card.getAttribute("data-status");

        const searchData =
            card.getAttribute("data-search");


        const matchesSearch =
            searchData.includes(searchText);


        const matchesFilter =
            currentFilter === "all" ||
            status === currentFilter;


        if (matchesSearch && matchesFilter) {

            card.style.display = "block";

            visibleStations++;

        }

        else {

            card.style.display = "none";

        }

    });


    stationCount.textContent =
        visibleStations;

}


/* =====================================================
   SEARCH
   ===================================================== */

searchInput.addEventListener(
    "input",
    filterStations
);


/* =====================================================
   FILTER BUTTONS
   ===================================================== */

filterButtons.forEach(function(button) {

    button.addEventListener(
        "click",
        function() {

            /* Remove active */

            filterButtons.forEach(function(btn) {

                btn.classList.remove("active");

            });


            /* Add active */

            button.classList.add("active");


            /* Get selected filter */

            currentFilter =
                button.getAttribute(
                    "data-filter"
                );


            filterStations();

        }
    );

});


/* =====================================================
   SORT
   ===================================================== */

let sortAscending = false;


sortButton.addEventListener(
    "click",
    function() {

        sortAscending =
            !sortAscending;


        const stationList =
            document.getElementById(
                "stationList"
            );


        const cards =
            Array.from(
                stationList.querySelectorAll(
                    ".station-card"
                )
            );


        cards.sort(function(a, b) {

            const healthA =
                parseFloat(
                    a.querySelector(
                        ".health-number"
                    ).textContent
                );

            const healthB =
                parseFloat(
                    b.querySelector(
                        ".health-number"
                    ).textContent
                );


            if (sortAscending) {

                return healthA - healthB;

            }

            else {

                return healthB - healthA;

            }

        });


        cards.forEach(function(card) {

            stationList.appendChild(card);

        });

    }
);


/* =====================================================
   STATION CARD CLICK
   ===================================================== */

stationCards.forEach(function(card) {

    card.addEventListener(
        "click",
        function(event) {

            /*
             Don't redirect when
             user is selecting text.
            */

            const stationID =
                card.querySelector(
                    ".station-id"
                ).textContent.trim();


            console.log(
                "Selected station:",
                stationID
            );

        }
    );

});


/* =====================================================
   INITIAL LOAD
   ===================================================== */

filterStations();


console.log(
    "SkyGuard AI Stations page loaded."
);