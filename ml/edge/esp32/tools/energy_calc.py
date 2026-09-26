"""Energy budget for Sahasraksha-Edge from MEASURED timings (+ datasheet or measured currents).

    python tools/energy_calc.py                      # prints the table with the defaults below
    python tools/energy_calc.py --us 45 --wifi-ms 2800 --wifi-ma 118 --sleep-ua 11 ...

Every input says where it must come from. Replace every DATASHEET/PLACEHOLDER value with
your own measurement when you have one, and say which is which in the report.
"""
import argparse

ap = argparse.ArgumentParser()
# --- measured on the board (BENCH 'b' and ENERGY 'e' / DUTY 'd' output) ---
ap.add_argument("--us", type=float, default=None, help="MEASURED sg_update() time at 240 MHz, microseconds (BENCH)")
ap.add_argument("--sensor-us", type=float, default=9000, help="MEASURED BME280 forced-mode read time, us (BENCH)")
ap.add_argument("--awake-ms", type=float, default=None,
                help="MEASURED total awake time per duty cycle without Wi-Fi, ms ('awake_us_mean' from DUTY)")
ap.add_argument("--wifi-ms", type=float, default=2500, help="MEASURED Wi-Fi connect + HTTPS POST duration, ms (ENERGY 'e')")
# --- currents: datasheet defaults (ESP32 Series Datasheet, 'Power consumption' table) unless measured ---
ap.add_argument("--active-ma", type=float, default=50.0, help="CPU active, radio off, 240 MHz (datasheet 30-68 mA; measured if INA219)")
ap.add_argument("--wifi-ma", type=float, default=120.0, help="average during connect+POST (PLACEHOLDER until measured; TX peaks ~240 mA)")
ap.add_argument("--sleep-ua", type=float, default=10.0, help="deep sleep, RTC timer + RTC memory (datasheet 10 uA; bare module only)")
ap.add_argument("--volts", type=float, default=3.3)
# --- deployment assumptions ---
ap.add_argument("--interval-s", type=float, default=600, help="reading interval (IMD AWS: 10 min / 1 h)")
ap.add_argument("--alert-rate", type=float, default=0.05, help="fraction of readings flagged (streaming flag rate ~4-5%%)")
ap.add_argument("--heartbeat-every", type=int, default=6, help="edge-first policy also sends every Nth reading")
ap.add_argument("--battery-mah", type=float, default=2600, help="e.g. one 18650 cell")
a = ap.parse_args()

if a.us is None:
    print("!! --us not given: run BENCH ('b') on the ESP32 and pass the 240 MHz us/call. Using 50 us as a PLACEHOLDER.\n")
    a.us = 50.0

V = a.volts
E_detect_uJ = V * a.active_ma * a.us / 1000.0                       # mA*us*V = nJ*1000 -> /1000 = uJ
awake_ms = a.awake_ms if a.awake_ms is not None else (a.sensor_us + a.us) / 1000.0 + 5.0   # + boot/overhead guess
E_wake_mJ = V * a.active_ma * awake_ms / 1000.0                     # mA*ms*V = uJ -> /1000 = mJ
E_wifi_mJ = V * a.wifi_ma * a.wifi_ms / 1000.0
E_sleep_mJ = V * (a.sleep_ua / 1000.0) * a.interval_s               # mA*s*V = mJ

def policy(send_fraction):
    e = E_wake_mJ + send_fraction * E_wifi_mJ + E_sleep_mJ           # mJ per interval
    i_avg_ma = e / V / a.interval_s                                  # mJ/(V*s) = mA
    days = a.battery_mah / i_avg_ma / 24.0
    return e, i_avg_ma, days

send_edge = min(1.0, a.alert_rate + 1.0 / a.heartbeat_every)
rows = [("A  send every reading (no edge detection)", 1.0),
        (f"B  edge-first: send alerts + 1/{a.heartbeat_every} heartbeat", send_edge),
        ("C  edge-only: diagnose locally, never send", 0.0)]

print("=== Sahasraksha-Edge energy budget ===")
print(f"sg_update(): {a.us:.1f} us  ->  {E_detect_uJ:.2f} uJ per detection at {a.active_ma:.0f} mA, {V} V")
print(f"awake per reading (sensor + detector + overhead): {awake_ms:.1f} ms -> {E_wake_mJ:.3f} mJ")
print(f"one Wi-Fi connect + POST: {a.wifi_ms:.0f} ms at {a.wifi_ma:.0f} mA -> {E_wifi_mJ:.1f} mJ "
      f"= {E_wifi_mJ * 1000 / E_detect_uJ:,.0f} x the energy of one detection")
print(f"deep sleep for {a.interval_s:.0f} s at {a.sleep_ua:.0f} uA -> {E_sleep_mJ:.3f} mJ\n")
print(f"{'policy':52s} {'mJ/reading':>11s} {'avg mA':>8s} {'battery days':>13s}")
base = None
for name, frac in rows:
    e, i, d = policy(frac)
    base = base or e
    print(f"{name:52s} {e:11.2f} {i:8.3f} {d:13.0f}")
eA, _, _ = policy(1.0); eB, _, _ = policy(send_edge)
print(f"\nedge-first saves {100 * (1 - eB / eA):.0f}% of the energy of sending every reading "
      f"(at alert rate {a.alert_rate:.0%}, {a.battery_mah:.0f} mAh, {a.interval_s:.0f} s interval).")
print("Detection itself is a rounding error; the radio is the cost. That is the argument for edge AI here.")
print("\nLabel each input in the report as MEASURED or DATASHEET. Dev boards (USB-UART chip, LDO, power LED)")
print("draw several mA in deep sleep; quote the bare-module datasheet figure or measure the board and say which.")
