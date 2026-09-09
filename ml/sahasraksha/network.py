"""
SkyGuard AI - synthetic AWS network.

This is NOT toy data. Each channel is generated from the physical process that
actually produces it, which is what makes the detectors meaningful:

  Temperature : annual cycle + diurnal cycle + AR(1) synoptic weather + noise
  Dewpoint    : slowly varying airmass property (AR(1)), monsoon-modulated
  Humidity    : DERIVED from T and Td via Magnus -- so the realistic
                anti-phase between temperature and humidity emerges by
                itself rather than being faked
  Pressure    : altitude-reduced base + annual cycle + AR(1) synoptic
                + S1 diurnal tide + S2 SEMIDIURNAL ATMOSPHERIC TIDE

The S2 tide is the centrepiece. Surface pressure carries a remarkably regular
12-hour harmonic, solar-driven and strongest in the tropics, with an amplitude
near 1 hPa over India. It is the most predictable signal in all of surface
meteorology -- which makes it a perfect heartbeat for a barometer.
"""
import numpy as np
import pandas as pd

from .physics import RH_from_T_dewpoint

# A plausible spread of Indian AWS sites: coastal, plains, plateau, hill.
STATIONS = [
    # id,          name,          lat,    lon,    alt_m, T_mean, T_amp_ann, Td_mean
    ("AWS_TVM", "Thiruvananthapuram",  8.52,  76.94,    16, 27.5,  1.8, 23.5),
    ("AWS_CHN", "Chennai",            13.08,  80.27,    16, 28.5,  3.5, 23.0),
    ("AWS_BLR", "Bengaluru",          12.97,  77.59,   920, 24.0,  3.0, 17.0),
    ("AWS_HYD", "Hyderabad",          17.39,  78.49,   536, 27.0,  4.5, 17.5),
    ("AWS_PNQ", "Pune",               18.52,  73.86,   560, 25.5,  4.0, 16.0),
    ("AWS_MUM", "Mumbai",             19.08,  72.88,    11, 28.0,  3.0, 23.0),
    ("AWS_NGP", "Nagpur",             21.15,  79.09,   310, 27.5,  6.5, 16.5),
    ("AWS_AMD", "Ahmedabad",          23.02,  72.57,    53, 28.0,  6.0, 17.0),
    ("AWS_KOL", "Kolkata",            22.57,  88.36,     9, 27.0,  5.5, 22.0),
    ("AWS_LKO", "Lucknow",            26.85,  80.95,   123, 26.0,  8.0, 17.5),
    ("AWS_JAI", "Jaipur",             26.91,  75.79,   431, 26.0,  7.5, 14.0),
    ("AWS_SHL", "Shillong",           25.58,  91.89,  1496, 17.0,  4.5, 13.0),
]

STATION_COLS = ["station_id", "name", "lat", "lon", "alt_m",
                "T_mean", "T_amp_ann", "Td_mean"]


def _ar1(n, phi, sigma, rng):
    """First-order autoregressive series -- models synoptic weather memory."""
    out = np.zeros(n)
    for i in range(1, n):
        out[i] = phi * out[i - 1] + rng.normal(0, sigma)
    return out


def station_table():
    return pd.DataFrame(STATIONS, columns=STATION_COLS)


def generate_network(days=180, start="2025-03-01", freq_hours=1, seed=42):
    """
    Generate a clean (fault-free) AWS network record.

    Returns a long-format DataFrame with one row per station per timestamp.
    """
    rng = np.random.default_rng(seed)
    n = int(days * 24 / freq_hours)
    time = pd.date_range(start, periods=n, freq=f"{freq_hours}h")

    doy = time.dayofyear.to_numpy().astype(float)
    hour_utc = (time.hour.to_numpy() + time.minute.to_numpy() / 60.0)

    # A shared synoptic field: neighbouring stations must move together,
    # otherwise a spatial consistency check has nothing to detect against.
    regional_T = _ar1(n, 0.96, 0.55, rng)
    regional_P = _ar1(n, 0.97, 0.30, rng)

    frames = []
    for (sid, name, lat, lon, alt, T_mean, T_amp_ann, Td_mean) in STATIONS:
        # Local solar time drives both the diurnal cycle and the tide
        lst = (hour_utc + lon / 15.0) % 24.0

        # --- Temperature ------------------------------------------------
        annual = T_amp_ann * np.cos(2 * np.pi * (doy - 135) / 365.25)
        # Diurnal amplitude shrinks with humidity and near the coast
        diurnal_amp = 3.0 + 5.0 * (1.0 - np.clip((Td_mean - 12) / 14.0, 0, 1))
        diurnal = -diurnal_amp * np.cos(2 * np.pi * (lst - 15.0) / 24.0)
        local_T = _ar1(n, 0.90, 0.35, rng)
        T = (T_mean + annual + diurnal
             + 0.7 * regional_T + local_T + rng.normal(0, 0.15, n))

        # --- Dewpoint (airmass property, slow) --------------------------
        monsoon = 3.5 * np.exp(-0.5 * ((doy - 210) / 55.0) ** 2)
        Td = (Td_mean + monsoon + _ar1(n, 0.985, 0.22, rng)
              + rng.normal(0, 0.12, n))
        Td = np.minimum(Td, T - 0.3)          # physically enforced

        # --- Humidity is derived, never invented ------------------------
        RH = np.clip(RH_from_T_dewpoint(T, Td), 3, 100)

        # --- Pressure with the semidiurnal atmospheric tide --------------
        # S2 amplitude peaks at the equator (~1.25 hPa) and falls with
        # latitude roughly as cos^3(lat); phase maxima near 10h and 22h LST.
        s2_amp = 1.25 * np.cos(np.radians(lat)) ** 3
        s1_amp = 0.55 * np.cos(np.radians(lat)) ** 2
        S2 = s2_amp * np.cos(2 * np.pi * (lst - 10.0) / 12.0)
        S1 = s1_amp * np.cos(2 * np.pi * (lst - 4.0) / 24.0)

        P_msl_base = 1013.0 - 4.0 * np.cos(2 * np.pi * (doy - 15) / 365.25)
        P_msl = (P_msl_base + S1 + S2 + regional_P
                 + _ar1(n, 0.93, 0.18, rng) + rng.normal(0, 0.08, n))
        # Convert MSL back down to what the barometer at the site reads
        P = P_msl * np.exp(-9.80665 * alt / (287.05 * (T + 273.15)))

        frames.append(pd.DataFrame({
            "timestamp": time,
            "station_id": sid,
            "lat": lat, "lon": lon, "alt_m": alt,
            "T": np.round(T, 2),
            "P": np.round(P, 2),
            "RH": np.round(RH, 1),
        }))

    df = pd.concat(frames, ignore_index=True)
    return df.sort_values(["station_id", "timestamp"]).reset_index(drop=True)
