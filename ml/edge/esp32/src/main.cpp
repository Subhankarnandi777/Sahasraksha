/*
 * Sahasraksha-Edge firmware (SIH26073) - ESP32 + BME280/BMP280 (+ MAX7219, + INA219)
 *
 * The station diagnoses its own sensors with no uplink, using the same detector
 * the live website runs (ml/sahasraksha/stream.py), ported to C in
 * lib/sahasraksha_edge. Serial 115200 baud. Type a letter + Enter:
 *
 *   h  help                       s  status: chip, sizes, memory, CPU clock
 *   t  SELFTEST: 480 golden readings vs the PC result (must PASS)
 *   b  BENCH: microseconds and CPU cycles per sg_update() at 240/160/80 MHz
 *   r  REPLAY: stream the golden readings (incl. the PS 55 C example) to Serial + display
 *   l  LIVE: read the real sensor every SAMPLE_MS and diagnose it (default mode)
 *   x  inject the PS example into the NEXT live reading (55 C, 95 % RH, P +9 hPa)
 *   z  freeze T for the next 8 live readings        p  add a +8 hPa pressure spike to the next reading
 *   n  drop RH (missing) on the next reading        w  send one test reading to the backend (USE_WIFI=1)
 *   e  ENERGY phases: awake idle / detector loop / sensor reads / Wi-Fi / light sleep (markers for a meter)
 *   d  DUTY: deep-sleep cycle (wake -> read -> detect -> [send] -> sleep). Hold BOOT at reset to exit.
 *
 * Every live/replay verdict is printed as one JSON line starting with {"ev":...
 * so tools/serial_logger.py can save it to CSV.
 */
#include <Arduino.h>
#include <Wire.h>
#include <sys/time.h>
#include <time.h>
#include "esp_sleep.h"
#include "esp_timer.h"

#include "config.h"
#include "sahasraksha_edge.h"
#include "bme280_lite.h"
#include "golden_vectors.h"
#if USE_INA219
#include "ina219_lite.h"
#endif
#if USE_DISPLAY
#include <MD_Parola.h>
#include <MD_MAX72xx.h>
#include <SPI.h>
#endif
#if USE_WIFI
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#endif
#if HAVE_STATION_COEFFS
#include "station_coeffs.h"   /* defines: static const sg_coeffs_t STATION_COEFFS */
#endif

/* ---------------------------------------------------------------- state */
/* RTC_DATA_ATTR = kept in RTC slow memory, survives deep sleep (8 KB available) */
RTC_DATA_ATTR static sg_state_t rtc_state;
RTC_DATA_ATTR static sg_coeffs_t rtc_coeffs;
RTC_DATA_ATTR static uint8_t rtc_have_baseline = 0;
RTC_DATA_ATTR static uint8_t rtc_duty = 0;
RTC_DATA_ATTR static uint32_t rtc_cycles = 0;
RTC_DATA_ATTR static uint32_t rtc_awake_us_sum = 0;

static Bme280Lite sensor;
static bool sensor_ok = false;
static uint8_t channels = SG_CH_ALL;
enum Mode { M_LIVE, M_REPLAY, M_IDLE };
static Mode mode = M_LIVE;
static uint32_t next_sample_ms = 0;
static uint32_t live_n = 0;
static int replay_i = 0;
static bool inj_ps55 = false, inj_pstep = false, inj_rh_missing = false;
static int inj_freeze_left = 0;
static float frozen_T = NAN;
#if USE_INA219
static Ina219Lite ina;
static bool ina_ok = false;
#endif
#if USE_DISPLAY
static MD_Parola disp(MAX_HW_TYPE, PIN_MAX_CS, MAX_DEVICES);
static char disp_buf[96];
#endif

/* ---------------------------------------------------------------- helpers */
static void set_clock_from_build_time() {
    struct tm t = {};
    char mon[4];
    int d, y, hh, mm, ss;
    sscanf(__DATE__, "%3s %d %d", mon, &d, &y);
    sscanf(__TIME__, "%d:%d:%d", &hh, &mm, &ss);
    const char *months = "JanFebMarAprMayJunJulAugSepOctNovDec";
    t.tm_mon = (int)((strstr(months, mon) - months) / 3);
    t.tm_mday = d; t.tm_year = y - 1900; t.tm_hour = hh; t.tm_min = mm; t.tm_sec = ss;
    setenv("TZ", "UTC0", 1); tzset();
    time_t local = mktime(&t);                 /* build time is local (IST) ... */
    struct timeval tv = {local - TZ_OFFSET_MIN * 60, 0};   /* ... store UTC */
    settimeofday(&tv, nullptr);
}

static void ensure_clock() {
    time_t now = time(nullptr);
    if (now < 1700000000) set_clock_from_build_time();   /* not set yet (first power-up) */
}

static void solar_time(float &lst, float &doy, char *iso, size_t iso_n) {
    time_t now = time(nullptr);
    struct tm u;
    gmtime_r(&now, &u);
    float utc_h = u.tm_hour + u.tm_min / 60.0f + u.tm_sec / 3600.0f;
    lst = fmodf(utc_h + STATION_LON / 15.0f + 24.0f, 24.0f);
    doy = (float)(u.tm_yday + 1);
    if (iso) strftime(iso, iso_n, "%Y-%m-%dT%H:%M:%SZ", &u);
}

static void fmtf(char *b, size_t n, float v, int dp) {
    if (isfinite(v)) snprintf(b, n, "%.*f", dp, v); else snprintf(b, n, "null");
}

static void print_verdict_json(const char *src, int idx, float T, float P, float RH,
                               const sg_verdict_t &v, uint32_t cycles, const char *event) {
    char t[16], p[16], h[16], e0[16], e1[16], e2[16], b0[16], b1[16], b2[16];
    fmtf(t, 16, T, 2); fmtf(p, 16, P, 2); fmtf(h, 16, RH, 1);
    fmtf(e0, 16, v.estimate[0], 2); fmtf(e1, 16, v.estimate[1], 2); fmtf(e2, 16, v.estimate[2], 1);
    fmtf(b0, 16, v.band[0], 2); fmtf(b1, 16, v.band[1], 2); fmtf(b2, 16, v.band[2], 1);
    Serial.printf("{\"ev\":\"%s\",\"i\":%d,\"T\":%s,\"P\":%s,\"RH\":%s,\"flag\":%u,\"reason\":\"%s\","
                  "\"flags\":%u,\"sev\":%.3f,\"conf\":%.3f,\"deg\":%.3f,\"zmax\":%.2f,"
                  "\"est\":[%s,%s,%s],\"band\":[%s,%s,%s],\"cycles\":%lu,\"event\":\"%s\"}\n",
                  src, idx, t, p, h, v.flag, sg_reason_name(v.reason), v.flags, v.severity,
                  v.confidence, v.degradation, v.zmax, e0, e1, e2, b0, b1, b2,
                  (unsigned long)cycles, event ? event : "");
    if (v.flag) Serial.printf("   -> ACTION: %s\n", sg_action(v.reason));
}

static void show(const sg_verdict_t &v, float T, float RH) {
#if USE_DISPLAY
    if (v.flag) {
        if (isfinite(v.estimate[0]))
            snprintf(disp_buf, sizeof disp_buf, "ALERT %s  T %.1f  est %.1f+-%.1f C",
                     sg_reason_name(v.reason), T, v.estimate[0], v.band[0]);
        else
            snprintf(disp_buf, sizeof disp_buf, "ALERT %s", sg_reason_name(v.reason));
    } else if (isfinite(RH)) {
        snprintf(disp_buf, sizeof disp_buf, "OK %.1fC %.0f%%", T, RH);
    } else {
        snprintf(disp_buf, sizeof disp_buf, "OK %.1fC", T);
    }
    disp.displayClear();
    if (v.flag) disp.displayText(disp_buf, PA_LEFT, 40, 800, PA_SCROLL_LEFT, PA_SCROLL_LEFT);
    else        disp.displayText(disp_buf, PA_CENTER, 40, 2000, PA_PRINT, PA_NO_EFFECT);
#else
    (void)v; (void)T; (void)RH;
#endif
}

static void load_live_baseline(float T, float P, float RH) {
#if HAVE_STATION_COEFFS
    rtc_coeffs = STATION_COEFFS;
    (void)T; (void)P; (void)RH;
#else
    memset(&rtc_coeffs, 0, sizeof rtc_coeffs);   /* self-baseline: intercept only */
    rtc_coeffs.b[0][0] = isfinite(T) ? T : 25.0f;
    rtc_coeffs.b[1][0] = isfinite(P) ? P : 1005.0f;
    rtc_coeffs.b[2][0] = isfinite(RH) ? RH : 60.0f;
#endif
    sg_init(&rtc_state);
    rtc_have_baseline = 1;
}

#if USE_WIFI
static bool wifi_up(uint32_t timeout_ms = 10000) {
    if (WiFi.status() == WL_CONNECTED) return true;
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    uint32_t t0 = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t0 < timeout_ms) delay(100);
    return WiFi.status() == WL_CONNECTED;
}

static int post_reading(const char *iso, float T, float P, float RH) {
    if (!wifi_up()) return -1;
    WiFiClientSecure cli;
    cli.setInsecure();                          /* demo only: skips certificate check */
    HTTPClient http;
    if (!http.begin(cli, BACKEND_URL)) return -2;
    http.addHeader("Content-Type", "application/json");
    char body[200], t[16], p[16], h[16];
    fmtf(t, 16, T, 2); fmtf(p, 16, P, 2); fmtf(h, 16, RH, 1);
    snprintf(body, sizeof body, "{\"station_id\":\"%s\",\"timestamp\":\"%s\",\"T\":%s,\"P\":%s,\"RH\":%s,\"flag\":0}",
             STATION_ID, iso, t, p, h);
    int code = http.POST((uint8_t *)body, strlen(body));
    if (code > 0) Serial.printf("   backend %d: %s\n", code, http.getString().c_str());
    http.end();
    return code;
}
#endif

/* ---------------------------------------------------------------- modes */
static void cmd_help() {
    Serial.println(F("\nSahasraksha-Edge commands: h help | s status | t selftest | b bench | r replay | l live"));
    Serial.println(F("  x inject PS 55C | z freeze T | p P spike | n drop RH | w wifi test | e energy phases | d duty-cycle"));
}

static void cmd_status() {
    Serial.printf("\n--- STATUS ---\nstation %s  lat %.3f lon %.3f\n", STATION_ID, STATION_LAT, STATION_LON);
    Serial.printf("sensor: %s at 0x%02X  (humidity %s)\n", sensor.name(), sensor.address(),
                  sensor.hasHumidity() ? "YES" : "NO - BMP280 has no RH; PS needs RH: use a BME280");
    Serial.printf("sizeof(sg_state_t)   = %u bytes  (per-station RAM; lives in RTC memory, survives deep sleep)\n", (unsigned)sizeof(sg_state_t));
    Serial.printf("sizeof(sg_coeffs_t)  = %u bytes  (per-station baseline)\n", (unsigned)sizeof(sg_coeffs_t));
    Serial.printf("sizeof(sg_verdict_t) = %u bytes\n", (unsigned)sizeof(sg_verdict_t));
    Serial.printf("CPU %lu MHz | chip %s rev %d | flash %lu KB | free heap %lu B | sketch %lu B\n",
                  (unsigned long)getCpuFrequencyMhz(), ESP.getChipModel(), ESP.getChipRevision(),
                  (unsigned long)(ESP.getFlashChipSize() / 1024), (unsigned long)ESP.getFreeHeap(),
                  (unsigned long)ESP.getSketchSize());
    char iso[32]; float lst, doy; solar_time(lst, doy, iso, sizeof iso);
    Serial.printf("clock %s  local solar time %.2f h  day %d  baseline %s\n", iso, lst, (int)doy,
                  HAVE_STATION_COEFFS ? "station_coeffs.h" : "self (intercept)");
#if USE_INA219
    if (ina_ok) Serial.printf("INA219: %.1f mA at %.2f V\n", ina.currentMa(), ina.busVolts());
#endif
}

static void cmd_selftest() {
    Serial.println(F("\n--- SELFTEST: golden vectors (must match the PC result) ---"));
    sg_state_t st; sg_init(&st);
    sg_verdict_t v;
    int agree = 0, ev_ok = 0;
    for (int i = 0; i < GOLDEN_N; i++) {
        const float *r = GOLDEN_IN[i];
        sg_update(&st, &GOLDEN_COEFFS, r[0], r[1], r[2], r[3], r[4], &v);
        bool ok = v.reason == GOLDEN_REASON[i];
        agree += ok;
        if (!ok) Serial.printf("  row %d: got %s, expected %s\n", i, sg_reason_name(v.reason), sg_reason_name(GOLDEN_REASON[i]));
        for (int k = 0; k < GOLDEN_N_EVENTS; k++)
            if (GOLDEN_EVENT_ROW[k] == i) ev_ok += ok;
        if (i == 400)
            Serial.printf("  row 400 (PS example 55 C): %s, confidence %.2f, T estimate %.2f +- %.2f C (true 30.44)\n",
                          sg_reason_name(v.reason), v.confidence, v.estimate[0], v.band[0]);
    }
    bool pass = ev_ok == GOLDEN_N_EVENTS && agree >= GOLDEN_N - 2;
    Serial.printf("rows agreeing %d / %d, injected-event rows %d / %d  ->  %s\n",
                  agree, GOLDEN_N, ev_ok, GOLDEN_N_EVENTS, pass ? "PASS" : "FAIL");
}

static void bench_at(uint32_t mhz) {
    setCpuFrequencyMhz(mhz);
    delay(20);
    sg_state_t st; sg_verdict_t v;
    const int REPS = 20;
    uint32_t cmin = UINT32_MAX, cmax = 0;
    uint64_t csum = 0;
    int64_t t0 = esp_timer_get_time();
    for (int rep = 0; rep < REPS; rep++) {
        sg_init(&st);
        for (int i = 0; i < GOLDEN_N; i++) {
            const float *r = GOLDEN_IN[i];
            uint32_t c0 = ESP.getCycleCount();
            sg_update(&st, &GOLDEN_COEFFS, r[0], r[1], r[2], r[3], r[4], &v);
            uint32_t dc = ESP.getCycleCount() - c0;
            csum += dc; if (dc < cmin) cmin = dc; if (dc > cmax) cmax = dc;
        }
    }
    int64_t dt = esp_timer_get_time() - t0;
    double n = (double)REPS * GOLDEN_N;
    Serial.printf("  %3lu MHz: %.2f us/call (wall, %d calls) | cycles/call mean %.0f min %lu max %lu\n",
                  (unsigned long)getCpuFrequencyMhz(), dt / n, (int)n, csum / n,
                  (unsigned long)cmin, (unsigned long)cmax);
}

static void cmd_bench() {
    Serial.println(F("\n--- BENCH: sg_update() on the ESP32 ---"));
    uint32_t f0 = getCpuFrequencyMhz();
    bench_at(240); bench_at(160); bench_at(80);
    setCpuFrequencyMhz(f0);
    if (sensor_ok) {
        float T, P, RH; uint32_t s = 0; int ok = 0;
        for (int i = 0; i < 10; i++) if (sensor.read(T, P, RH)) { s += sensor.lastMeasureUs(); ok++; }
        if (ok) Serial.printf("  sensor forced-mode read: %.0f us average over %d reads (%s)\n", (double)s / ok, ok, sensor.name());
    }
    Serial.println(F("  -> put the 240 MHz us/call and cycles/call in the numbers table (ESP32.md section 9)."));
}

static void live_step() {
    float T, P, RH;
    if (!sensor_ok || !sensor.read(T, P, RH)) {
        T = P = RH = NAN;                        /* sensor gone = the "missing" fault, honestly reported */
    }
    const char *ev = "";
    if (inj_ps55) { T = 55.0f; RH = 95.0f; P += 9.0f; inj_ps55 = false; ev = "INJECTED PS example 55C"; }
    if (inj_pstep) { P += 8.0f; inj_pstep = false; ev = "INJECTED P spike +8 hPa"; }
    if (inj_rh_missing) { RH = NAN; inj_rh_missing = false; ev = "INJECTED RH missing"; }
    if (inj_freeze_left > 0) {
        if (!isfinite(frozen_T)) frozen_T = T;
        T = frozen_T; inj_freeze_left--; ev = "INJECTED frozen T";
        if (inj_freeze_left == 0) frozen_T = NAN;
    }
    if (!rtc_have_baseline) load_live_baseline(T, P, RH);
    float lst, doy; char iso[32];
    solar_time(lst, doy, iso, sizeof iso);
    sg_verdict_t v;
    uint32_t c0 = ESP.getCycleCount();
    sg_update_ex(&rtc_state, &rtc_coeffs, lst, doy, T, P, RH, channels, &v);
    uint32_t dc = ESP.getCycleCount() - c0;
    print_verdict_json("live", (int)live_n++, T, P, RH, v, dc, ev);
    show(v, T, RH);
#if USE_WIFI
    if (!SEND_ONLY_ALERTS || v.flag || (live_n % HEARTBEAT_EVERY) == 0) post_reading(iso, T, P, RH);
#endif
}

static void replay_step() {
    static sg_state_t st;
    if (replay_i == 0) {
        sg_init(&st);
        Serial.printf("\n--- REPLAY %s from %s UTC, %d hourly readings ---\n", GOLDEN_STATION, GOLDEN_START_UTC, GOLDEN_N);
    }
    const float *r = GOLDEN_IN[replay_i];
    sg_verdict_t v;
    uint32_t c0 = ESP.getCycleCount();
    sg_update(&st, &GOLDEN_COEFFS, r[0], r[1], r[2], r[3], r[4], &v);
    uint32_t dc = ESP.getCycleCount() - c0;
    const char *ev = golden_event(replay_i);
    if (v.flag || ev[0] || replay_i % 24 == 0) print_verdict_json("replay", replay_i, r[2], r[3], r[4], v, dc, ev);
    if (v.flag || replay_i % 6 == 0) show(v, r[2], r[4]);
    if (++replay_i >= GOLDEN_N) { replay_i = 0; mode = M_IDLE; Serial.println(F("--- REPLAY done ---")); }
}

static void cmd_energy() {
    Serial.println(F("\n--- ENERGY PHASES (log the supply current with an INA219 / USB meter; LED on GPIO2 marks phases) ---"));
    auto phase = [](const char *name, uint32_t ms, int kind) {
        Serial.printf("PHASE_START %s %lu\n", name, (unsigned long)millis());
        Serial.flush();
        digitalWrite(PIN_LED, HIGH);
        uint32_t t0 = millis(), n = 0;
        double ma = 0; int ns = 0;
        sg_state_t st; sg_init(&st); sg_verdict_t v;
        while (millis() - t0 < ms) {
            if (kind == 1) {                               /* detector flat out */
                const float *r = GOLDEN_IN[n % GOLDEN_N];
                sg_update(&st, &GOLDEN_COEFFS, r[0], r[1], r[2], r[3], r[4], &v); n++;
            } else if (kind == 2 && sensor_ok) {           /* sensor reads back to back */
                float T, P, RH; sensor.read(T, P, RH); n++;
            } else if (kind == 3) {                        /* light sleep */
                digitalWrite(PIN_LED, LOW);
                esp_sleep_enable_timer_wakeup((uint64_t)ms * 1000ULL);
                esp_light_sleep_start();
                break;
            } else {
                delay(1);
            }
#if USE_INA219
            if (ina_ok && kind != 3 && (n % 50 == 0 || kind == 0)) { ma += ina.currentMa(); ns++; }
#endif
        }
        digitalWrite(PIN_LED, LOW);
        Serial.printf("PHASE_END %s %lu ops=%lu", name, (unsigned long)millis(), (unsigned long)n);
        if (ns) Serial.printf(" mean_mA=%.1f", ma / ns);
        Serial.println();
        delay(300);
    };
    phase("awake_idle", 3000, 0);
    phase("detector_loop", 3000, 1);
    phase("sensor_reads", 3000, 2);
#if USE_WIFI
    Serial.printf("PHASE_START wifi_connect_post %lu\n", (unsigned long)millis());
    digitalWrite(PIN_LED, HIGH);
    uint32_t t0 = millis();
    float lst, doy; char iso[32]; solar_time(lst, doy, iso, sizeof iso);
    int code = post_reading(iso, 30.0f, 1005.0f, 60.0f);
    digitalWrite(PIN_LED, LOW);
    Serial.printf("PHASE_END wifi_connect_post %lu http=%d duration_ms=%lu\n", (unsigned long)millis(), code,
                  (unsigned long)(millis() - t0));
    WiFi.disconnect(true); WiFi.mode(WIFI_OFF);
#endif
    phase("light_sleep", 3000, 3);
    Serial.println(F("--- ENERGY PHASES done (deep sleep: use 'd' and a multimeter in series) ---"));
}

/* one wake of the deep-sleep duty cycle; never returns */
static void duty_cycle_once() {
    uint64_t t_wake = esp_timer_get_time();
    digitalWrite(PIN_LED, HIGH);
    Wire.begin(PIN_SDA, PIN_SCL);
    float T = NAN, P = NAN, RH = NAN;
    if (sensor.begin(Wire)) {
        sensor.read(T, P, RH);
        channels = sensor.hasHumidity() ? SG_CH_ALL : (SG_CH_T | SG_CH_P);
    }
    if (!rtc_have_baseline) load_live_baseline(T, P, RH);
    float lst, doy; char iso[32];
    solar_time(lst, doy, iso, sizeof iso);
    sg_verdict_t v;
    sg_update_ex(&rtc_state, &rtc_coeffs, lst, doy, T, P, RH, channels, &v);
#if USE_WIFI
    if (!SEND_ONLY_ALERTS || v.flag || (rtc_cycles % HEARTBEAT_EVERY) == 0) post_reading(iso, T, P, RH);
#endif
    rtc_cycles++;
    uint32_t awake_us = (uint32_t)(esp_timer_get_time() - t_wake);
    rtc_awake_us_sum += awake_us;
    if (!DUTY_QUIET) {
        Serial.begin(115200);
        char t[16], p[16], h[16];
        fmtf(t, 16, T, 2); fmtf(p, 16, P, 2); fmtf(h, 16, RH, 1);
        Serial.printf("{\"ev\":\"duty\",\"cycle\":%lu,\"T\":%s,\"P\":%s,\"RH\":%s,\"flag\":%u,\"reason\":\"%s\","
                      "\"awake_us\":%lu,\"awake_us_mean\":%lu}\n",
                      (unsigned long)rtc_cycles, t, p, h, v.flag, sg_reason_name(v.reason),
                      (unsigned long)awake_us, (unsigned long)(rtc_awake_us_sum / rtc_cycles));
        Serial.flush();
    }
    digitalWrite(PIN_LED, LOW);
    esp_sleep_enable_timer_wakeup((uint64_t)DUTY_SLEEP_S * 1000000ULL);
    esp_deep_sleep_start();
}

/* ---------------------------------------------------------------- Arduino */
void setup() {
    pinMode(PIN_LED, OUTPUT);
    pinMode(PIN_BOOT, INPUT_PULLUP);
    ensure_clock();

    if (rtc_duty) {
        if (digitalRead(PIN_BOOT) == LOW) {        /* BOOT held: leave duty-cycle mode */
            rtc_duty = 0;
        } else {
            duty_cycle_once();                     /* does not return */
        }
    }

    Serial.begin(115200);
    delay(300);
    Serial.println(F("\n=== Sahasraksha-Edge (SIH26073) ==="));
    Wire.begin(PIN_SDA, PIN_SCL);
    sensor_ok = sensor.begin(Wire);
    if (sensor_ok) {
        channels = sensor.hasHumidity() ? SG_CH_ALL : (SG_CH_T | SG_CH_P);
        Serial.printf("sensor: %s at 0x%02X%s\n", sensor.name(), sensor.address(),
                      sensor.hasHumidity() ? "" : "  (NO humidity channel: RH gates disabled)");
    } else {
        Serial.println(F("sensor: NOT FOUND on 0x76/0x77 - check SDA=21, SCL=22, 3V3, GND. LIVE mode will report 'missing'."));
    }
#if USE_INA219
    ina_ok = ina.begin(Wire, INA219_ADDR, INA219_SHUNT_OHM);
    Serial.printf("INA219: %s\n", ina_ok ? "found" : "not found");
#endif
#if USE_DISPLAY
    disp.begin();
    disp.setIntensity(MAX_INTENSITY);
    disp.displayClear();
    disp.displayText("SAHASRAKSHA", PA_CENTER, 40, 1500, PA_SCROLL_LEFT, PA_SCROLL_LEFT);
#endif
#if USE_WIFI
    if (wifi_up()) {
        configTime(0, 0, "pool.ntp.org", "time.google.com");
        struct tm tmp;
        if (getLocalTime(&tmp, 5000)) Serial.println(F("clock: NTP"));
    } else {
        Serial.println(F("Wi-Fi: not connected (clock from build time)"));
    }
#endif
    cmd_help();
    cmd_status();
    cmd_selftest();
    next_sample_ms = millis() + 2000;
}

void loop() {
#if USE_DISPLAY
    disp.displayAnimate();
#endif
    while (Serial.available()) {
        char c = (char)Serial.read();
        switch (c) {
        case 'h': cmd_help(); break;
        case 's': cmd_status(); break;
        case 't': cmd_selftest(); break;
        case 'b': cmd_bench(); break;
        case 'r': mode = M_REPLAY; replay_i = 0; break;
        case 'l': mode = M_LIVE; Serial.println(F("LIVE mode")); break;
        case 'x': inj_ps55 = true; Serial.println(F("next reading: PS example (55 C, 95 % RH, P +9)")); break;
        case 'z': inj_freeze_left = 8; Serial.println(F("next 8 readings: T frozen")); break;
        case 'p': inj_pstep = true; Serial.println(F("next reading: P +8 hPa")); break;
        case 'n': inj_rh_missing = true; Serial.println(F("next reading: RH missing")); break;
        case 'e': cmd_energy(); break;
#if USE_WIFI
        case 'w': { float lst, doy; char iso[32]; solar_time(lst, doy, iso, sizeof iso);
                    Serial.printf("POST -> %d\n", post_reading(iso, 30.0f, 1005.0f, 60.0f)); } break;
#endif
        case 'd':
            Serial.printf("DUTY mode: deep sleep %d s between readings. Hold BOOT during reset to exit.\n", DUTY_SLEEP_S);
            Serial.flush();
            rtc_duty = 1; rtc_cycles = 0; rtc_awake_us_sum = 0;
            esp_sleep_enable_timer_wakeup(1000000ULL);
            esp_deep_sleep_start();
            break;
        default: break;
        }
    }
    if (mode == M_REPLAY) {
        static uint32_t last = 0;
        if (millis() - last >= 60) { last = millis(); replay_step(); }
    } else if (mode == M_LIVE && (int32_t)(millis() - next_sample_ms) >= 0) {
        next_sample_ms += SAMPLE_MS;
        live_step();
    }
}
