"""Smoke test for the evaluator-facing runner: python -m sahasraksha run <csv>."""
import subprocess
import sys
from pathlib import Path

import pandas as pd

ML = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML))

from sahasraksha.network import generate_network  # noqa: E402


def _feed(tmp: Path) -> tuple[Path, pd.Timestamp]:
    df = generate_network(days=40, seed=3)[["timestamp", "station_id", "T", "RH", "P", "lat", "lon", "alt_m"]]
    i = df.index[df.station_id == df.station_id.iloc[0]][700]
    df.loc[i, ["T", "RH"]] = [55.0, 95.0]                        # the PS example
    ts55 = df.loc[i, "timestamp"]
    df = pd.concat([df, df.drop(index=i).sample(5, random_state=0)])   # duplicated records
    p = tmp / "obs.csv"
    df.to_csv(p, index=False)
    return p, ts55


def test_cli_end_to_end(tmp_path):
    inp, ts55 = _feed(tmp_path)
    out, wo = tmp_path / "flags.csv", tmp_path / "wo.csv"
    r = subprocess.run([sys.executable, "-m", "sahasraksha", "run", str(inp), "--out", str(out), "--workorders", str(wo)],
                       cwd=ML, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    f = pd.read_csv(out, parse_dates=["timestamp"])
    for col in ("flag", "root_cause", "decided_by", "grade", "confidence", "T_estimate", "gates_fired", "action"):
        assert col in f.columns
    hit = f[f.timestamp == pd.Timestamp(ts55)]
    hit = hit[hit["T"] == 55.0]
    assert len(hit) == 1 and hit.flag.iat[0] == 1
    assert hit.root_cause.iat[0] == "impossible" and hit.grade.iat[0] == "CRITICAL"
    assert 15 < hit.T_estimate.iat[0] < 45
    assert (f.root_cause == "corrupt").sum() >= 1                 # duplicates named as corrupt
    assert 0.0 < f.flag.mean() < 0.25
    assert len(pd.read_csv(wo)) == f.station_id.nunique()


def test_single_station_without_metadata(tmp_path):
    df = generate_network(days=20, seed=4)
    one = df[df.station_id == df.station_id.iloc[0]][["timestamp", "station_id", "T", "RH", "P"]]
    p = tmp_path / "one.csv"
    one.to_csv(p, index=False)
    r = subprocess.run([sys.executable, "-m", "sahasraksha", "run", str(p), "--out", str(tmp_path / "o.csv"),
                        "--workorders", str(tmp_path / "w.csv")], cwd=ML, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert "single station" in r.stdout
