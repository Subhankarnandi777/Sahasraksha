/* ===================== Sahasraksha-Edge rig configuration =====================
 * Change the values marked CHANGE ME. Everything else can stay as it is. */
#pragma once

/* ---- identity & location (CHANGE ME) ---- */
#define STATION_ID        "ESP32-LAB-01"     /* must match a row in the site's stations table to appear there */
#define STATION_LAT       22.57f             /* degrees N  (CHANGE ME: where the rig is) */
#define STATION_LON       88.36f             /* degrees E  (CHANGE ME) - used for local solar time */
#define TZ_OFFSET_MIN     330                /* IST = UTC+5:30; used only to turn the build time into UTC */

/* ---- pins (ESP32 DevKit V1 / WROOM-32 defaults) ---- */
#define PIN_SDA           21
#define PIN_SCL           22
#define PIN_LED           2                  /* on-board LED: HIGH while awake/working (marks phases for current logging) */
#define PIN_BOOT          0                  /* BOOT button: hold during reset to leave duty-cycle mode */

/* ---- MAX7219 LED matrix (optional) ---- */
#ifndef USE_DISPLAY
#define USE_DISPLAY       1                  /* 0 if you have no MAX7219 or MD_Parola will not install */
#endif
#define MAX_DEVICES       4                  /* 4 x (8x8) modules */
#define MAX_HW_TYPE       MD_MAX72XX::FC16_HW /* if text is mirrored/garbled try GENERIC_HW, PAROLA_HW or ICSTATION_HW */
#define PIN_MAX_CS        5                  /* DIN = GPIO23 (MOSI), CLK = GPIO18 (SCK) - hardware SPI */
#define MAX_INTENSITY     2                  /* 0..15; lower = less current */

/* ---- sampling ---- */
#define SAMPLE_MS         10000UL            /* LIVE mode: one reading every 10 s for the demo (field: 60000 or 600000) */
#define DUTY_SLEEP_S      60                 /* DUTY mode: deep-sleep seconds between readings */
#define DUTY_QUIET        0                  /* 1 = no Serial output in DUTY mode (saves ~ms of awake time) */

/* ---- Wi-Fi uplink (optional; everything works offline) ---- */
#ifndef USE_WIFI
#define USE_WIFI          0                  /* 1 to enable NTP time + sending alerts to the backend */
#endif
#define WIFI_SSID         "your-ssid"        /* CHANGE ME if USE_WIFI */
#define WIFI_PASS         "your-password"    /* CHANGE ME if USE_WIFI */
#define BACKEND_URL       "https://sahasraksha-backend.onrender.com/ingest"
#define SEND_ONLY_ALERTS  1                  /* edge-first policy: transmit only flagged readings (+ heartbeat) */
#define HEARTBEAT_EVERY   60                 /* also send every Nth reading so the server knows we are alive */

/* ---- optional INA219 on the same I2C bus (measured current) ---- */
#ifndef USE_INA219
#define USE_INA219        0                  /* 1 if an INA219 is wired in series with the board's supply */
#endif
#define INA219_ADDR       0x40
#define INA219_SHUNT_OHM  0.1f

/* ---- detector baseline for LIVE mode ----
 * 0: self-baseline (intercept = first reading, harmonics 0; the EW statistics adapt).
 *    Physics gates (impossible/range/step/frozen/missing) are exact either way.
 * 1: use station_coeffs.h, fitted offline by tools/make_coeffs.py from >= 14 days of this rig's own log. */
#ifndef HAVE_STATION_COEFFS
#define HAVE_STATION_COEFFS 0
#endif
