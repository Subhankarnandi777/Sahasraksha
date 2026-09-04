console.log("AI Alerts loaded");


// =====================================
// ACKNOWLEDGE ALERT
// =====================================

function acknowledgeAlert(button) {

    const alert =
        button.closest(".ai-alert");


    if (alert) {

        alert.style.opacity =
            "0.5";


        button.innerText =
            "Acknowledged";


        button.disabled =
            true;

    }

}