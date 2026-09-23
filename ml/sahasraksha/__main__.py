"""Command line: python -m sahasraksha run observations.csv --out flags.csv"""
from __future__ import annotations

import argparse
import sys
import time

import pandas as pd


def _read(path: str) -> pd.DataFrame:
    if path.endswith((".parquet", ".pq")):
        return pd.read_parquet(path)
    return pd.read_csv(path)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m sahasraksha",
                                 description="Sahasraksha AWS quality control: flags, root cause, severity, "
                                             "confidence, labelled estimates and work orders.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="run QC on a CSV/parquet of observations")
    r.add_argument("input", help="observations: timestamp, station_id, T, RH (or Td), P (or P_msl + alt_m); "
                                 "optional lat, lon, alt_m")
    r.add_argument("--stations", help="optional station table: station_id, lat, lon, alt_m")
    r.add_argument("--out", default="sahasraksha_flags.csv", help="per-hour verdicts (default: %(default)s)")
    r.add_argument("--workorders", default="sahasraksha_workorders.csv",
                   help="per-station maintenance list (default: %(default)s)")
    r.add_argument("--ml-rate", type=float, default=0.01,
                   help="ML false-alarm budget on the training slice (default: %(default)s)")
    r.add_argument("--flagged-only", action="store_true", help="write only flagged rows")
    a = ap.parse_args(argv)

    from .qc import run_qc
    t0 = time.time()
    obs = _read(a.input)
    st = _read(a.stations) if a.stations else None
    try:
        out, work, info = run_qc(obs, stations=st, ml_rate=a.ml_rate)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    if a.flagged_only:
        out = out[out.flag == 1]
    out.to_csv(a.out, index=False)
    work.to_csv(a.workorders, index=False)
    print(f"wrote {a.out} ({len(out):,} rows) and {a.workorders} ({len(work)} stations) in {time.time() - t0:.1f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
