document.addEventListener("DOMContentLoaded", function () {

    fetch("../Header.html")
        .then(response => response.text())
        .then(data => {

            document.getElementById("header-container").innerHTML = data;

            // Find current page
            let currentPage = window.location.pathname.split("/").pop();

            // Activate current navigation link
            document.querySelectorAll(".main-nav .nav-link").forEach(link => {

                let linkPage = link.getAttribute("href");

                if (linkPage === currentPage) {
                    link.classList.add("active");
                }

            });

        })
        .catch(error => {
            console.error("Header loading failed:", error);
        });

});
