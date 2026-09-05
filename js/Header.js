document.addEventListener("DOMContentLoaded", function () {
    const headerContainer = document.getElementById("header-container");

    if (!headerContainer) {
        return;
    }

    fetch("../components/header.html")
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            return response.text();
        })
        .then(data => {
            headerContainer.innerHTML = data;

            const currentPage =
                window.location.pathname.split("/").pop();

            document
                .querySelectorAll(".main-nav .nav-link")
                .forEach(link => {
                    const linkPage =
                        link.getAttribute("href");

                    if (linkPage === currentPage) {
                        link.classList.add("active");
                    }
                });
        })
        .catch(error => {
            console.error("Header loading failed:", error);
            headerContainer.innerHTML = "";
        });
});