"""Save everything the ESP32 prints, and turn its JSON verdict lines into a CSV.

    pip install pyserial
    python tools/serial_logger.py --port COM5            (Windows)
    python tools/serial_logger.py --port /dev/ttyUSB0    (Linux/Mac)

Writes:  logs/raw_<time>.txt      every line, with a PC timestamp
         logs/verdicts_<time>.csv one row per {"ev": ...} line (live / replay / duty)
Type a command letter (t, b, r, l, x, z, p, n, e, d, s, h) + Enter to send it to the board.
Ctrl+C to stop. Close the PlatformIO serial monitor first: only one program can own the port.
"""
import argparse
import csv
import json
import os
import sys
import threading
import time

import serial  # pyserial


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", required=True)
    ap.add_argument("--baud", type=int, default=115200)
    a = ap.parse_args()
    os.makedirs("logs", exist_ok=True)
    stamp = time.strftime("%Y%m%d_%H%M%S")
    raw = open(f"logs/raw_{stamp}.txt", "w", encoding="utf-8")
    csv_path = f"logs/verdicts_{stamp}.csv"
    writer, csv_f = None, None
    ser = serial.Serial(a.port, a.baud, timeout=0.2)

    def keyboard():
        for line in sys.stdin:
            ser.write(line.strip().encode()[:1])

    threading.Thread(target=keyboard, daemon=True).start()
    print(f"logging to {raw.name} and {csv_path}  (Ctrl+C to stop)")
    try:
        while True:
            b = ser.readline()
            if not b:
                continue
            line = b.decode("utf-8", "replace").rstrip()
            ts = time.strftime("%Y-%m-%d %H:%M:%S")
            print(line)
            raw.write(f"{ts}\t{line}\n"); raw.flush()
            if line.startswith('{"ev"'):
                try:
                    d = json.loads(line)
                except json.JSONDecodeError:
                    continue
                for k in ("est", "band"):
                    if isinstance(d.get(k), list):
                        for ch, val in zip(("T", "P", "RH"), d.pop(k)):
                            d[f"{k}_{ch}"] = val
                d["pc_time"] = ts
                if writer is None:
                    csv_f = open(csv_path, "w", newline="", encoding="utf-8")
                    writer = csv.DictWriter(csv_f, fieldnames=list(d.keys()), extrasaction="ignore")
                    writer.writeheader()
                writer.writerow(d); csv_f.flush()
    except KeyboardInterrupt:
        pass
    finally:
        raw.close()
        if csv_f:
            csv_f.close()


if __name__ == "__main__":
    main()
