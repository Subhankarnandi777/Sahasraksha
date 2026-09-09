"""
SkyGuard AI - Layer 0: Atmospheric physics.

Everything here is deterministic, needs no training, and is defensible to an
IMD scientist. These are the constraints the atmosphere cannot violate.
"""
import numpy as np

# WMO Magnus coefficients over water (Sonntag 1990 / WMO-No. 8)
MAGNUS_A = 17.62
MAGNUS_B = 243.12  # deg C
E0 = 6.112         # hPa, saturation vapour pressure at 0 C


def saturation_vapour_pressure(T):
    """Saturation vapour pressure e_s(T) in hPa. T in degrees C."""
    return E0 * np.exp(MAGNUS_A * T / (MAGNUS_B + T))


def dewpoint_from_T_RH(T, RH):
    """
    Dewpoint temperature (deg C) from air temperature and relative humidity.

    Physical law: dewpoint can never exceed air temperature. Any station
    reporting Td > T is emitting an impossible observation. This gives us a
    detector with ~100% precision that requires zero training data.
    """
    RH = np.clip(RH, 1e-3, None)
    gamma = np.log(RH / 100.0) + MAGNUS_A * T / (MAGNUS_B + T)
    return MAGNUS_B * gamma / (MAGNUS_A - gamma)


def RH_from_T_dewpoint(T, Td):
    """Relative humidity (%) from air temperature and dewpoint."""
    return 100.0 * saturation_vapour_pressure(Td) / saturation_vapour_pressure(T)


def reduce_to_msl(P_station, T, altitude_m):
    """
    Reduce station-level pressure to mean sea level so that stations at
    different altitudes become directly comparable.

    Without this step a spatial consistency check is meaningless: a hill
    station legitimately reads ~100 hPa below a coastal one.
    """
    T_kelvin = T + 273.15
    return P_station * np.exp(9.80665 * altitude_m / (287.05 * T_kelvin))


def heat_index(T, RH):
    """
    Rothfusz heat index in deg C -- the apparent temperature a human feels.

    This is the bridge to problem statement 26083 (Extreme Heatwave Early
    Warning and Human Thermal Stress Index). It is computed from exactly the
    two channels SkyGuard already validates, which is precisely why sensor
    quality is a public-health question and not just a data-hygiene one.
    """
    Tf = T * 9.0 / 5.0 + 32.0
    HI = (-42.379 + 2.04901523 * Tf + 10.14333127 * RH
          - 0.22475541 * Tf * RH - 6.83783e-3 * Tf ** 2
          - 5.481717e-2 * RH ** 2 + 1.22874e-3 * Tf ** 2 * RH
          + 8.5282e-4 * Tf * RH ** 2 - 1.99e-6 * Tf ** 2 * RH ** 2)
    # Below ~80 F the polynomial is not valid; fall back to a simple average
    simple = 0.5 * (Tf + 61.0 + (Tf - 68.0) * 1.2 + RH * 0.094)
    HI = np.where(Tf < 80.0, simple, HI)
    return (HI - 32.0) * 5.0 / 9.0


def wbgt_shade(T, RH):
    """
    Simplified indoor/shade WBGT approximation (Australian BoM form).
    Used by heat-action plans to set work-rest cycles.
    """
    e = RH / 100.0 * 6.105 * np.exp(17.27 * T / (237.7 + T))
    return 0.567 * T + 0.393 * e + 3.94


# --- WMO plausible-range gates -------------------------------------------
GROSS_LIMITS = {
    "T":  (-40.0, 60.0),    # deg C
    "P":  (500.0, 1100.0),  # hPa, station level
    "RH": (0.0, 100.0),     # %
}

# Maximum credible step between consecutive hourly observations
STEP_LIMITS = {"T": 6.0, "P": 5.0, "RH": 45.0}
