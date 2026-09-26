# ESP32 edge task — Sahasraksha (SIH26073)

**For:** the teammate who owns the ESP32 hardware.
**From:** Rishi (ML lead).
**Deadline:** everything in the "Must do" list by **28 Sept 2026**, so it can go into the deck before the **30 Sept** submission.
**How to use this file:** read §0 to §3 yourself (10 minutes). Then give the **whole file** to your AI assistant, together with the `sahasraksha-edge-esp32` project folder, and work through §6 task by task. Every task lists the command to run, what you should see, how to tell it passed, and what to save.

---

## 0. Rules for the AI assistant helping with this

If you are an AI assistant reading this, follow these rules:

1. **Do not change the detector.** Leave `lib/sahasraksha_edge/sahasraksha_edge.c` and its thresholds alone: 52 °C, dew point 34 °C, step limits 6 / 5 / 45, frozen runs 6 / 6 / 10, CUSUM k = 3 and h = 12, z = 4, tide cut 0.45. The code is a line-for-line port of `ml/sahasraksha/stream.py`, the detector the live website runs. It was checked to agree with it on **51,840 of 51,840 readings**. Any change breaks that agreement and makes the golden self-test fail.
2. **The golden self-test must PASS on the board** (`t` command) before any number from the board is reported.
3. **Never invent a measurement.** Every number in the final table (§9) must come from the board's serial log, the build output, a meter, or a cited datasheet table. Label each one MEASURED or DATASHEET.
4. You may change `include/config.h` (pins, location, Wi-Fi, options) and `platformio.ini`, and fix build or wiring problems. Explain every change you make.
5. Keep all serial logs (`logs/` folder). They are the evidence.
6. If something in this file is wrong for the hardware in front of you (a different board, a different module), stop and say so. Don't guess.

---

## 1. The project in 60 seconds

**Sahasraksha** (also called SkyGuard AI) is our SIH 2026 entry for **PS SIH26073** (Ministry of Earth Sciences / India Meteorological Department): *AI/ML-based anomaly detection for Automatic Weather Stations*, using only **temperature, pressure and relative humidity**.

It stacks four layers:
- **Physics gates:** things the atmosphere cannot do, such as 55 °C in India, a dew point above air temperature, or impossible jumps.
- **Each station's own learned baseline:** a harmonic fit of its daily and yearly cycle, plus adaptive statistics and a CUSUM drift detector.
- **The pressure "tide heartbeat":** every healthy barometer shows the 12-hour atmospheric tide. A barometer that loses it is degrading.
- **ML on the server:** an IsolationForest over the whole network, plus a spatial check against neighbouring stations.

It already runs as a live website (FastAPI backend on Render, React on Vercel). It is validated on 60 real Indian stations (2.6 M observations) and on a synthetic fault benchmark (precision 0.82, recall 0.77).

**Your part** proves the "edge" half: that the station-level layers run **on the weather station's own microcontroller**, in real time, on very little energy, with **no internet needed**. A station that can diagnose itself still works when its uplink fails, and a station going silent is one of the failures we most want to catch.

---

## 2. What the problem statement asks for, and what the ESP32 must prove

### 2.1 The PS text that concerns you (verbatim)

> **Problem Statement:** "Develop an AI/ML-based intelligent anomaly detection system capable of automatically identifying abnormal, inconsistent, or faulty observations from Automatic Weather Stations **in real time** using only the following parameters: Temperature (°C), Atmospheric Pressure (hPa), Relative Humidity (%)… while minimizing false alarms and **enabling scalable deployment across large weather observation networks**."
>
> **Suggested Technologies:** "Explainable AI (SHAP/LIME) (Preferable)" · "**Edge AI for low-power deployment on ESP32**"
>
> **Evaluation Criteria (to be evaluated in anomaly injected data):**
>
> | Criterion | Weight |
> |---|---|
> | Innovation & Novelty | 25% |
> | Detection Accuracy | 20% |
> | Real-Time Capability | 15% |
> | Explainability | 10% |
> | Scalability | 10% |
> | Practical Deployability | 10% |
> | Visualization/UI | 5% |
> | **Energy Efficiency** | **5%** |
>
> **Example Use Case:** "An AWS suddenly reports a temperature of **55 °C with extremely high humidity and abnormal pressure variation** while neighboring stations show normal conditions. The AI system should analyze temporal and spatial consistency, identify the reading as a probable sensor anomaly, **generate an alert, and suggest corrective action**."
>
> **Grand Challenge:** "Can AI build a **self-aware and self-healing** weather observation network capable of delivering trustworthy atmospheric data under all environmental conditions?"
>
> **Objectives (partial):** "Detect anomalies in real-time AWS data streams" · "Identify sensor faults, spikes, frozen values, and communication errors" · "Perform multivariate consistency analysis among atmospheric parameters" · "Provide confidence scores…" · "Predict possible sensor degradation and maintenance requirements" · "Optionally suggest corrected/imputed values".
>
> **Expected Inputs:** "historical AWS datasets, simulated anomalies, or **streaming sensor data**…"
>
> **Output:** "Fully executable code with example usage and a document explaining various use cases."

### 2.2 What each requirement means for the ESP32, and the evidence you produce

| PS requirement | What the ESP32 shows | Evidence you capture (task) |
|---|---|---|
| **Edge AI for low-power deployment on ESP32** (suggested tech) | The station-level detector runs on the ESP32 itself. Its learned per-station baseline (harmonic regression plus adaptive statistics) and all physics gates run on the chip. | Build output with flash/RAM sizes (T2). SELFTEST PASS on the board (T3). |
| **Energy Efficiency (5%)** | Detection costs microjoules. The radio costs roughly 10⁵× more, so detecting on the edge and transmitting only alerts saves most of the energy. | µs per detection (T4), phase currents and duty cycle (T7/T8), `energy_calc.py` table |
| **Real-Time Capability (15%)** | Each reading is judged the instant it's taken, in microseconds, with constant memory per station. | BENCH µs and cycles (T4). LIVE verdict per reading (T6). |
| **Practical Deployability (10%)** | Runs on a ~₹500 board with a ~₹300 sensor. Survives deep sleep, has no cloud dependency, and needs no library beyond the Arduino core. | Photo of the rig, DUTY mode log (T7), optional Wi-Fi uplink to the live site (T9) |
| **Scalability (10%)** | 88 bytes of state per station, so one ESP32 could track thousands of stations, or every AWS carries its own. | `s` status output (T3) |
| **Example use case: 55 °C + high humidity + pressure jump** | The board labels it **impossible**, gives confidence 1.0, an estimate of the true value ± band, and an **action** text, and shows it on the LED matrix. | REPLAY row 400 (T5). LIVE `x` injection plus a **video** (T6). |
| **Spikes, frozen values, communication errors** | step, frozen and missing gates | LIVE injections `z`, `p`, `n` (T6) |
| **Multivariate consistency** | Dew point from T and RH: above T, or above 34 °C, is impossible | Row 400. `x` injection. |
| **Confidence scores** | `conf` in every verdict (1.0 for a physics rule, otherwise the margin past the threshold) | JSON lines |
| **Sensor degradation / maintenance** | Tide-heartbeat `degradation` and the `degrading` reason. CUSUM `drift`. | REPLAY log, JSON `deg` |
| **Corrected / imputed values** | `est` ± `band` for T, P, RH on every reading | JSON `est`, `band`. Display text. |
| **Grand challenge: "self-aware"** | The station diagnoses itself with **no uplink**. Its state survives deep sleep in RTC memory. | DUTY mode log (T7) |
| **Streaming sensor data** (expected input) | A real BME280 read live | LIVE log (T6) |

---

## 3. Where things stand

### 3.1 Already done (you don't need to redo these)

- **Detector ported to C:** `lib/sahasraksha_edge/`. It's a C99, float32 port of `stream.py` with no heap, no model file and no dependencies beyond libm.
  - It agrees with the Python live detector on **51,840 / 51,840 readings**: same flag and same reason on every row, confidence within 0.0006.
  - It contains every gate the website uses, including the two added for the PS example: national record 52 °C and dew-point ceiling 34 °C. Both are labelled `impossible`.
- **Compiled for the real ESP32 target** (Espressif `xtensa-esp-elf` GCC 13.2, `-mdynconfig=xtensa_esp32`, `-Os`):
  - `sg_update()` is 1,972 bytes of Xtensa code, using the ESP32 hardware FPU.
  - Detector plus the float math it needs (`sinf`, `cosf`, `logf`, `expf`, `sqrtf`) comes to 7.9 KB.
  - Zero `.data` or `.bss`.
- **Full firmware compiled for `esp32dev` with Arduino core 3.2.0** in three configurations, all with zero warnings:
  - default: 404 KB flash (whole firmware, including the Arduino core and the 480-reading test data), 23.5 KB static RAM;
  - without display: about the same;
  - with Wi-Fi + HTTPS + INA219: 1.13 MB flash, 50 KB RAM.
  In that build `sg_update` compiles to about 2.0 KB of Xtensa code. **It has NOT been flashed or run on a board yet. That is your job.**
- **Sensor driver written from the Bosch datasheet**, with no Adafruit library. The maths reproduces the datasheet's worked example exactly: 25.08 °C and 100,653 Pa. It auto-detects BME280 vs BMP280.
- **Golden test vectors:** 480 hourly readings of a station, with four injected faults, and the expected verdict for each. The board checks itself against them.

### 3.2 Two corrections to what we had been claiming

| Old claim (notebook / old deck) | Truth | What to say now |
|---|---|---|
| "ESP32 firmware 1,885 B, 0.385 % SRAM" | That was compiled with the **PC's x86 gcc**, not for the ESP32. The % also mixed up code (flash) with SRAM. | Use the Xtensa numbers above and your build output |
| "116 bytes of state per station" | That came from a comment's arithmetic. The real `sizeof(sg_state_t)` is **88 bytes**: 19 floats, 3 uint16, padding and a uint32. | **88 B = 0.017 % of the ESP32's 520 KB SRAM.** Confirm with the `s` command on the board. |

### 3.3 Not done yet (your job)

It has not run on a board, and nothing about timing or energy has been measured on hardware. §6 covers all of it.

---

## 4. Hardware

### 4.1 Parts

| Part | Needed? | Notes |
|---|---|---|
| ESP32 DevKit V1 (ESP32-WROOM-32, 30 or 38 pin) | **Must** | Any ESP32 (original, Xtensa) dev board works. If yours is an ESP32-S3 or C3, tell the AI: the pins and the board line in `platformio.ini` change. |
| BME280 module (I²C) | **Must** | Measures **T, P and RH**. See the warning below. |
| MAX7219 8×32 LED matrix (4 modules, "FC-16" type) | Nice to have | Shows OK or ALERT text for the demo video |
| INA219 current sensor breakout (0.1 Ω shunt) | Nice to have | For the **measured** energy (Tier 2, T8) |
| USB power meter (the ₹300–600 inline USB tester) | Alternative | Rough average current in mA, if there's no INA219 |
| Digital multimeter with a µA/mA range | Nice to have | Deep-sleep current, in series |
| Breadboard and jumper wires, micro-USB **data** cable | Must | Some cables are charge-only. If no COM port appears, change the cable. |

> ⚠️ **HW-611 warning.** Boards labelled "HW-611" are often a **BMP280, which has no humidity sensor**. The PS needs RH. On boot the firmware prints either `sensor: BME280 …` or `sensor: BMP280 … (NO humidity channel…)`. If you see BMP280, everything still runs on T and P, but **buy or borrow a BME280** (look for "BME280" printed on the chip listing, a square metal can with a hole). It costs about ₹300–450 locally or online. The detector's humidity gates only work with RH.

### 4.2 Wiring

**BME280 / BMP280 (I²C):**

| Sensor pin | ESP32 pin |
|---|---|
| VIN / VCC | **3V3** (not 5 V unless the module has a regulator) |
| GND | GND |
| SCL | **GPIO 22** |
| SDA | **GPIO 21** |
| CSB (if present) | leave unconnected, or tie to 3V3 (selects I²C) |
| SDO (if present) | GND → address 0x76, 3V3 → 0x77. The firmware tries both. |

**MAX7219 matrix (hardware SPI):**

| Matrix pin | ESP32 pin |
|---|---|
| VCC | **5V / VIN** (the matrix draws up to a few hundred mA at full brightness) |
| GND | GND |
| DIN | **GPIO 23** |
| CS | **GPIO 5** |
| CLK | **GPIO 18** |

**INA219 (optional, for measured current):** the INA219 sits *in series* with the board's power.
1. Cut the **+5 V** line of a USB cable (or use a USB breakout board). Route USB +5 V → INA219 **VIN+**, and INA219 **VIN−** → ESP32 **VIN (5V pin)**. GND stays common.
2. Power the ESP32 from that line, **not** from its USB port. Use a second USB-to-serial adapter, or the same USB port with its 5 V wire cut, for serial data.
3. Wire the INA219's own VCC/GND/SDA/SCL to the ESP32's 3V3/GND/21/22. It shares the I²C bus with the BME280 (address 0x40, no conflict).
4. Set `USE_INA219 1` in `config.h`. The ENERGY command (`e`) then prints the mean mA per phase.

The ESP32 measuring its own supply is fine for the awake phases. It can't measure its own deep sleep: use a multimeter for that (T8).

**Take a clear photo of the wired rig.** It goes in the deck.

---

## 5. Software setup (Windows)

1. Install **VS Code**, then from the Extensions tab install **PlatformIO IDE**. Restart VS Code.
2. Install the USB driver for the board's USB chip if Windows doesn't show a COM port when you plug it in:
   - **CP210x** (Silicon Labs, square chip near the USB port), or
   - **CH340/CH9102** (WCH).
   - Check Device Manager → Ports (COM & LPT).
3. **Get the code:** the `sahasraksha-edge-esp32` folder, either from Rishi's zip or from the repo `github.com/Subhankarnandi777/Sahasraksha`, folder `ml/edge/esp32/` once it's pushed.
4. VS Code → PlatformIO → **Open Project** → select that folder (the one containing `platformio.ini`).
5. Install Python 3.10+ for the helper tools, then run: `pip install pyserial numpy pandas`
6. For the PC test (T1), install a C compiler. On Windows the easy one is **MSYS2 → `pacman -S mingw-w64-ucrt-x86_64-gcc`**, or use WSL. If that's a hassle, skip T1. The board runs the same test in T3.

The first build downloads the ESP32 platform, toolchain and Arduino core (about 600 MB, 5–15 min). After that, builds take seconds.

### Project layout

```
sahasraksha-edge-esp32/
├── platformio.ini              board, platform, libraries
├── ESP32.md                    this file
├── include/
│   ├── config.h                ← the only file you normally edit (pins, location, options)
│   ├── golden_vectors.h        480 test readings + expected verdicts (generated, don't edit)
│   └── station_coeffs.h        (created by tools/make_coeffs.py, optional)
├── lib/
│   ├── sahasraksha_edge/       THE DETECTOR (C99) - do not modify
│   └── sensors/                BME280/BMP280 + INA219 drivers (no external libraries)
├── src/main.cpp                modes: selftest, bench, replay, live, energy, duty-cycle
└── tools/
    ├── host_test.c             run the detector + sensor maths on a PC
    ├── serial_logger.py        save serial output + verdict CSV
    ├── energy_calc.py          turn measurements into the energy table
    └── make_coeffs.py          fit this station's own baseline from its log (optional)
```

---

## 6. Tasks, step by step

**Must do (about 1 day):** T1 → T7, then fill in §9.
**Should do:** T8 (measured current).
**Nice to have:** T9 (send alerts to the live site), T10 (own baseline).

For every task, save the full serial output with `python tools/serial_logger.py --port COMx`. It writes `logs/raw_*.txt` and `logs/verdicts_*.csv`. Close the PlatformIO monitor first: only one program can use the COM port.

### T1 — Run the detector on the PC (10 min, optional but fast)
In the project folder:
```
gcc -std=c99 -O2 -Wall -Ilib/sahasraksha_edge -Ilib/sensors -Iinclude tools/host_test.c lib/sahasraksha_edge/sahasraksha_edge.c lib/sensors/bme280_comp.c -lm -o host_test
./host_test
```
**Expected:**
```
row 400 PS example: 55C, 95% RH, P +9 hPa    -> impossible conf 1.00  T est 29.85 +- 2.15
row 450 RH channel missing                   -> missing    conf 1.00  T est 31.24 +- 6.16
row 460 P spike +8 hPa                       -> step       conf 1.00  T est 29.94 +- 5.84
golden 480/480 PASS
sizeof(sg_state_t) = 88 bytes
PC speed: ... us per sg_update
BMP280 datasheet example: T 25.08 C (25.08), P 100653.25 Pa (100653.27) PASS
```
**Pass:** both PASS lines. **Save:** the output.

### T2 — Build for the ESP32 and record the sizes (15 min)
1. In `include/config.h`, set `STATION_LAT` / `STATION_LON` to where the rig is. If there's no MAX7219, set `USE_DISPLAY 0` and delete the `lib_deps` line in `platformio.ini`.
2. PlatformIO sidebar → **Build**, or in a terminal: `pio run`
3. The end of the output shows:
   ```
   RAM:   [=         ]   7.x% (used ~23,500 bytes from 327,680 bytes)
   Flash: [===       ]  30.x% (used ~404,000 bytes from 1,310,720 bytes)
   ```
4. Get the detector's own code size, i.e. just our code, not the whole Arduino firmware. In a PlatformIO terminal:
   ```
   pio pkg exec -p toolchain-xtensa-esp-elf -- xtensa-esp-elf-size -A .pio/build/esp32dev/lib*/sahasraksha_edge/sahasraksha_edge.c.o
   ```
   If that path isn't found, search `.pio/build/esp32dev` for `sahasraksha_edge.c.o`. Note the `.text.sg_update` line: it should be about 2 KB.

**Save:** a screenshot or copy of the RAM/Flash lines and the size output.

### T3 — Flash, check status, run the self-test on the board (15 min)
1. Plug in the board. PlatformIO → **Upload**, or `pio run -t upload`. If upload hangs at `Connecting....`, hold the **BOOT** button until it starts writing.
2. Open the monitor: PlatformIO → **Monitor**, or `pio device monitor`. Press the board's **EN/RST** button.
3. The board prints the help, then **STATUS**, then **SELFTEST** automatically. Check:
   - `sensor: BME280 at 0x76` (or 0x77). If it says **BMP280**, see the §4.1 warning. If it says **NOT FOUND**, check the wiring (§10).
   - `sizeof(sg_state_t) = 88 bytes`
   - `row 400 (PS example 55 C): impossible, confidence 1.00, T estimate … (true 30.44)`
   - `rows agreeing 480 / 480, injected-event rows 17 / 17 -> PASS`

   The firmware allows up to 2 rows of floating-point difference between the PC and the ESP32 and still passes. The injected-event rows must all match.

**Pass:** PASS. If FAIL, stop and send the log to Rishi. **Save:** the whole log.

### T4 — Benchmark: how fast is one detection on the ESP32 (5 min)
Type `b` + Enter.
**Expected** (numbers are yours to measure):
```
--- BENCH: sg_update() on the ESP32 ---
  240 MHz: X.XX us/call (wall, 9600 calls) | cycles/call mean NNNN min NNNN max NNNN
  160 MHz: ...
   80 MHz: ...
  sensor forced-mode read: NNNN us average over 10 reads (BME280)
```
Record the 240 MHz **µs/call** and **mean cycles/call**, and the sensor read time. Real-time capability is then "one reading diagnosed in X µs, about 10⁴–10⁵ times faster than the 1-minute AWS reporting interval." **Save:** the log.

### T5 — Replay demo: the PS example on real-like data (5 min + video)
Type `r` + Enter. The board streams the 480 golden readings (20 days, hourly) in about 30 s. It prints a JSON line every 24 readings and on every alert, and scrolls alerts on the matrix. Watch for:
- **row 400** → `"reason":"impossible"`, `"conf":1.000`, `"est":[~29.9, …]`, plus the ACTION line. The PS example gives 55 °C, the estimate is about 29.9 °C, and the true value was 30.44 °C.
- rows 426–433 → `frozen`; row 450 → `missing`; row 460 → `step`.

**Record a short phone video** of the matrix during row 400, with the serial window visible if you can. **Save:** the log and video.

### T6 — LIVE: the real sensor, plus injected faults (20 min + video)
Type `l` + Enter (LIVE is also the default). Every 10 s it prints one JSON line for the real reading, e.g.
`{"ev":"live","i":5,"T":29.84,"P":1006.12,"RH":64.3,"flag":0,"reason":"ok",…}`

1. Let it run for 2–3 minutes. The readings should be plausible for your room. Compare T and RH with a phone weather app or a room thermometer, and note any difference. There should be **no alerts** on a still sensor, except possibly the first reading or two while the statistics settle. Write down how many alerts there were in these minutes: that's the live false-alarm check.
2. Type **`x`** → the next reading becomes the **PS example** (55 °C, 95 % RH, pressure +9 hPa). Expect `"reason":"impossible"`, confidence 1.0, the ACTION line, and **"ALERT impossible … est …"** scrolling on the matrix. **Record a video of this: it's the headline demo.**
3. Type **`z`** → T frozen for 8 readings → expect `frozen` from about the 6th frozen reading.
4. Type **`p`** → pressure +8 hPa on one reading → `step`.
5. Type **`n`** → RH missing on one reading → `missing`.
6. Real-world tests (optional, fun, very convincing):
   - Breathe on the sensor for 5 s. RH jumps: it's a real change, so it may or may not flag. Note what happens.
   - Hold it in your hand. T rises slowly, and it shouldn't flag.
   - **Unplug the sensor's SDA wire.** Every channel goes `missing`: a real communication or sensor failure.

**Save:** the verdict CSV from `serial_logger.py` and the videos.

### T7 — Energy, Tier 1: measured time + datasheet current (1–2 h) — MUST
The detector's energy is tiny, and the argument we want to make is that the **radio** is the cost.

1. **Duty cycle (the realistic station mode).** Type `d`. The board now loops wake → read sensor → detect → sleep 60 s (`DUTY_SLEEP_S`), printing one `{"ev":"duty",…,"awake_us":…,"awake_us_mean":…}` line per wake.
   - Let it do at least 10 cycles.
   - Record **`awake_us_mean`**: the whole wake time per reading, excluding Wi-Fi.
   - To exit: hold **BOOT** and press **EN/RST**.
2. **Phases.** Type `e`. The board runs: 3 s awake idle → 3 s detector running flat out → 3 s back-to-back sensor reads → (Wi-Fi connect + HTTPS post if `USE_WIFI 1`) → 3 s light sleep. It prints `PHASE_START` / `PHASE_END` with `ops` counts, plus `duration_ms` for Wi-Fi.
   - Record the Wi-Fi `duration_ms` if you enabled it (T9). Otherwise leave the default 2,500 ms marked PLACEHOLDER.
3. **Datasheet currents.** Open the **Espressif "ESP32 Series Datasheet"** PDF (espressif.com → Documentation), section **"Power Consumption"** / "RF Power-Consumption Specifications". Note the version and table number. Typical values:

   | Mode | Current |
   |---|---|
   | Modem-sleep (CPU on, radio off), 240 MHz | ~30–68 mA |
   | Light-sleep | ~0.8 mA |
   | Deep-sleep (RTC timer + RTC memory) | ~10 µA |
   | Wi-Fi TX | peaks ~180–240 mA |
   | Wi-Fi RX | ~95–100 mA |

   Use **the exact values in the PDF you open** and cite them.
4. Run the calculator with **your** numbers:
   ```
   python tools/energy_calc.py --us <T4 240MHz us> --awake-ms <awake_us_mean/1000> --wifi-ms <measured or 2500> --active-ma <datasheet> --sleep-ua <datasheet 10> --interval-s 600 --alert-rate 0.05
   ```
   It prints energy per detection (µJ), energy per Wi-Fi send (mJ, and how many detections that equals), and for policies **A** (send every reading), **B** (edge-first: send alerts + heartbeat) and **C** (local only): mJ per reading, average mA, and days on one 2,600 mAh 18650.

**Save:** the calculator output and the datasheet table reference (PDF name, version, table number).

**Honest note for the deck:** a **dev board** (USB chip, voltage regulator, power LED) draws several mA even in deep sleep. The 10 µA figure is for the bare ESP32 module. Either quote the datasheet figure and say "module", or measure the board (T8) and say "dev board".

### T8 — Energy, Tier 2: measured current (2–4 h) — SHOULD
Pick whatever you have:
- **INA219 wired as in §4.2**, `USE_INA219 1`: run `e`. Each `PHASE_END` now has `mean_mA=`. Record awake idle, detector loop, sensor reads, and Wi-Fi if enabled.
- **USB power meter** between the charger and the board: run `e` and note the meter's mA in each 3 s phase. Film the meter; it's easier than reading it live.
- **Multimeter in series** (mA range for awake, µA range for sleep) on the 3V3 or VIN line: put the board in `d` (duty) mode and read the current while it sleeps. That's your measured deep-sleep current.

Re-run `energy_calc.py` with the **measured** `--active-ma`, `--wifi-ma` and `--sleep-ua`, and mark them MEASURED.

If you have an INA219 **and** a second board (Arduino or ESP32), the best result is a current-vs-time plot of one duty cycle. Log the INA219 at 100+ samples/s from the second board while the first runs `d`, then plot the spike (wake + read + detect) against the flat sleep line. One plot like that is worth a slide.

### T9 — Send alerts to the live website (1 h) — NICE TO HAVE
1. Ask Subhankar (repo owner) to add a station row with `station_id = ESP32-LAB-01` and the rig's lat/lon to the `stations` table in Supabase. Until he does, the backend still judges each reading and replies, but doesn't store it or show it on the site.
2. In `config.h`: set `USE_WIFI 1`, `WIFI_SSID`, `WIFI_PASS`. Keep `SEND_ONLY_ALERTS 1`, which is the edge-first policy.
3. Rebuild and upload. Type `w`. You should get `backend 200: {"flag":…,"reason":…}`.

   The first request after the Render server has been idle can take 30–60 s while it wakes up. Retry.
4. Type `x`. The PS example is detected on the board **and** sent. It appears on the website's Anomaly Alerts page once the station row exists. That's the full edge-to-cloud story in one click.
5. Run `e` again to get a measured Wi-Fi `duration_ms` for T7.

### T10 — Fit the rig's own baseline (optional, needs ≥ 3–14 days of logging)
In LIVE mode with the default `HAVE_STATION_COEFFS 0`, the station's baseline starts from its first reading and adapts. The physics gates are exact either way. For the full harmonic baseline:
1. Leave the board in LIVE mode, logging with `serial_logger.py`, for as long as possible.
2. Run `python tools/make_coeffs.py --csv logs/verdicts_XXXX.csv --lon <lon> --time-col pc_time --tz-offset-min 330`
3. Set `HAVE_STATION_COEFFS 1`, rebuild and upload.

### T11 — Hand back (30 min)
Send Rishi **one folder** containing:
1. the `logs/` folder (raw + CSV for T3–T8)
2. the videos (T5 and T6-x at minimum) and a rig photo
3. the filled-in table from §9, with MEASURED/DATASHEET labels
4. the build size output (T2)
5. any `config.h` changes you made

He will commit the project to the repo at `ml/edge/esp32/` and put the numbers in the deck.

---

## 7. What the firmware does (reference)

### 7.1 One reading, step by step (`sg_update`)
For each channel (T, P, RH):
1. **Estimate before looking:** expected value = the station's harmonic baseline at this local solar time and day of year + the current bias. Band = ±2σ of recent residuals.
2. **Physics gates:**
   - range: T −40…60 °C, P 500…1100 hPa, RH 0…100 %
   - step: |Δ| > 6 °C / 5 hPa / 45 % between readings
   - frozen: the identical value repeated ≥ 6 / 6 / 10 times
   - missing: NaN
3. **Residual z-score** against the baseline, using exponentially weighted mean and variance (α = 0.02).
4. **CUSUM** on z (k = 3, h = 12) → `drift`.
5. **Tide heartbeat** (pressure only): 12-hour quadrature accumulators. After 14 days, if the amplitude drops below 55 % of its slow baseline → `degrading`.

Then, across channels:
6. **Multivariate:** dew point from T and RH (Magnus formula). Td > T + 0.5, RH > 100.5, **Td > 34 °C**, or **T > 52 °C** → `impossible`.
7. |z| > 4 on any channel → `anomaly`.

The verdict contains:
- `flag`, `reason`, and the `flags` bitmask
- `severity` (0–1)
- `confidence`: 1.0 for rules; otherwise 0.5 + 0.5·(1 − e^(−3·margin)), where margin is how far the deciding statistic went past its threshold
- `degradation`, `zmax`
- `estimate` and `band`
- an action text

The reason priority is impossible > range > frozen > step > missing > degrading > drift > anomaly, the same as the website.

### 7.2 Memory

| What | Size | Where it lives |
|---|---|---|
| `sg_state_t` (one per station) | **88 B** | RAM. RTC slow memory in duty mode, so it survives deep sleep. |
| `sg_coeffs_t` (one per station) | 132 B | Flash (const) or RTC |
| `sg_verdict_t` | 44 B | stack |
| Detector code | ~2 KB (`sg_update`) / ~7.9 KB with float libm | Flash |

### 7.3 Serial JSON fields
- `ev`: live / replay / duty
- `i`: index
- `T`, `P`, `RH`
- `flag`, `reason`, `flags` (bits):

  | Bit | Meaning |
  |---|---|
  | 1 | range |
  | 2 | step |
  | 4 | frozen |
  | 8 | drift |
  | 16 | degrading |
  | 32 | missing |
  | 64 | impossible |
  | 128 | anomaly |

- `sev`, `conf`, `deg`, `zmax`
- `est[T, P, RH]`, `band[T, P, RH]`
- `cycles`: CPU cycles for this detection
- `event`: the injected fault, if any

### 7.4 Why this counts as "Edge AI"
The station learns its own normal behaviour:
- A robust least-squares fit of its daily and yearly cycle.
- Online-adaptive statistics that keep learning on the device.

On top of that, deterministic physics catches the impossible, and a sequential change detector catches drift. The heavy, network-wide model (an IsolationForest over all stations, plus neighbour comparison) stays on the server, where the other stations' data is. That split is deliberate: the chip does what needs no network, so it keeps working when the network is the thing that failed.

---

## 8. What to claim, and what not to claim

**Say** (fill in X, Y, Z from your measurements):
- "The station-level detector runs on an ESP32. It is compiled for the Xtensa target: `sg_update` is about 2 KB of code, state is 88 bytes per station (0.017 % of SRAM), and it uses no heap and no model file."
- "On the board it matches the Python detector used by the live system on all 480 golden readings (self-test PASS)."
- "One diagnosis takes **X µs** at 240 MHz (**N cycles**), about **Y µJ**. One Wi-Fi report costs about **Z mJ**, roughly 10⁵× more. Edge-first reporting (send only alerts) cuts energy by about **W %** against sending every reading, giving **D days** on one 18650 at 10-minute sampling."
- "The PS example (55 °C, 95 % RH, +9 hPa) is labelled *impossible* on the device, with confidence 1.0, an estimate of 29.9 °C (true 30.4 °C) and a corrective action, with no network." (Show the video.)

**Don't say:**
- "ESP32 firmware 1,885 B / 0.385 % SRAM" (that was an x86 build) or "116 B" (it's 88 B).
- Any current, energy or battery-life number you didn't measure, unless it's labelled "datasheet" with the table cited.
- "The IsolationForest runs on the ESP32". It doesn't; it's server-side.
- "Deployed at IMD stations". It's a lab rig.

---

## 9. Numbers to fill in and return

| # | Quantity | Value | Source (MEASURED / DATASHEET / BUILD) | Evidence file |
|---|---|---|---|---|
| 1 | Board / module (exact name) | | | photo |
| 2 | Sensor detected (BME280 / BMP280) and address | | MEASURED | T3 log |
| 3 | SELFTEST result (rows agreeing / 480, events / 17) | | MEASURED | T3 log |
| 4 | `sizeof(sg_state_t)` on the board | (expect 88 B) | MEASURED | T3 log |
| 5 | Firmware flash used / RAM used | | BUILD | T2 output |
| 6 | `sg_update` code size (`.text.sg_update`) | | BUILD | T2 size output |
| 7 | µs per `sg_update` at 240 / 160 / 80 MHz | | MEASURED | T4 log |
| 8 | Cycles per call (mean, min, max) at 240 MHz | | MEASURED | T4 log |
| 9 | BME280 forced read time (µs) | | MEASURED | T4 log |
| 10 | Duty-cycle awake time per reading (`awake_us_mean`) | | MEASURED | T7 log |
| 11 | Wi-Fi connect + POST duration (ms) | | MEASURED / PLACEHOLDER | T7/T9 log |
| 12 | Current: awake idle / detector loop / sensor / Wi-Fi (mA) | | MEASURED (T8) or DATASHEET (cite) | |
| 13 | Deep-sleep current (µA or mA; board or module?) | | MEASURED / DATASHEET | |
| 14 | Energy per detection (µJ) | | from `energy_calc.py` | calc output |
| 15 | Energy per Wi-Fi report (mJ) | | from `energy_calc.py` | calc output |
| 16 | Policy A / B / C: mJ per reading, avg mA, battery days | | from `energy_calc.py` | calc output |
| 17 | Edge-first saving vs send-every-reading (%) | | from `energy_calc.py` | calc output |
| 18 | LIVE: minutes run, alerts on a still sensor | | MEASURED | T6 CSV |
| 19 | LIVE: T/RH vs reference thermometer (difference) | | MEASURED | note |
| 20 | PS example on device: reason / conf / estimate | | MEASURED | T5/T6 log + video |

---

## 10. Troubleshooting

| Symptom | Fix |
|---|---|
| No COM port | Charge-only cable → use a data cable. Install the CP210x or CH340 driver. Try another USB port. |
| Upload stuck at `Connecting…` | Hold **BOOT** while it connects. Some boards need BOOT held and EN tapped. |
| `sensor: NOT FOUND` | Check SDA = 21, SCL = 22, **3V3** (not 5V) and GND. Re-seat the jumpers. Some modules have the pins in a different order from the label, so read the silkscreen. |
| `sensor: BMP280` | The module has no humidity → get a BME280 (§4.1). Everything else still works. |
| RH stuck at 0 or 100, or T reads 5–10 °C high | T high: sensor self-heating or sitting next to the ESP32/regulator. Move it away on longer wires. RH at 100: condensation. Let it dry. |
| Garbled or mirrored LED text | Change `MAX_HW_TYPE` in `config.h` to `GENERIC_HW`, `PAROLA_HW` or `ICSTATION_HW`. Lower `MAX_INTENSITY`. |
| Board resets when the matrix lights up | Brown-out: power the matrix from 5V/VIN, lower the intensity, use a better USB port or cable. |
| MD_Parola won't install | Set `USE_DISPLAY 0` and delete the `lib_deps` line. The display is optional. |
| Build error mentioning `sahasraksha_edge.h` | The project folder layout was changed. Keep `lib/sahasraksha_edge/` and `include/` exactly as shipped. |
| SELFTEST FAIL | Don't edit the detector. Send the log. A mismatch on more than 2 rows means a real porting problem Rishi needs to see. |
| Duty mode won't stop | Hold **BOOT**, tap **EN/RST**, release BOOT after the banner. |
| `backend -1` or `-2` | Wi-Fi SSID or password wrong, or no internet. The first call can take 30–60 s while Render wakes. |
| First LIVE readings flag `anomaly` | Normal for the first 1–3 readings: the statistics start from zero and settle within about 50 readings. Report the count after the first 5 minutes. |

---

## 11. Timeline (today is 24 Sept)

| Day | Do |
|---|---|
| **24–25 Sept** | Parts check (BME280!), wiring, T1–T4 |
| **26 Sept** | T5–T6 plus videos, T7 energy Tier 1 |
| **27 Sept** | T8 measured current, T9 Wi-Fi if time |
| **28 Sept** | T11 hand back: logs, videos, table §9 |
| 29–30 Sept | Rishi puts the numbers into the deck and repo. Only fixes after this. |

If you're blocked for more than an hour on anything, message Rishi with the exact error text and a photo of the wiring.
