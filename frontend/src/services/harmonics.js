// Least-squares harmonic fit of the solar atmospheric tides in a station's
// own barometric series.
//
// This exists because the S2 heartbeat page used to draw a hardcoded
// Math.sin() curve -- "Generate synthetic smooth S2 tidal curve for
// demonstration" -- and label it "Observed Station Signal". Nothing on that
// chart came from the station. Everything below is fitted to the real
// readings the timeseries endpoint already returns.
//
// Model, fitted jointly:
//
//   P(t) = c0                                (mean)
//        + c1 * t                            (linear trend: synoptic drift)
//        + c2*cos(2pi*lst/24) + c3*sin(...)  (S1, diurnal)
//        + c4*cos(2pi*lst/12) + c5*sin(...)  (S2, semi-diurnal)
//
// Two details that matter for this to be a real tidal fit rather than a
// curve that happens to wiggle:
//
//   - The tides are phase-locked to LOCAL SOLAR TIME, not UTC, so the
//     harmonic arguments use lst = (UTC hours + lon/15) mod 24. This is the
//     same convention the detector itself uses (ml/sahasraksha/stream.py
//     computes lst the same way before calling design_row).
//   - Synoptic weather moves surface pressure by several hPa over a few
//     days, which is far larger than S2's ~1 hPa. Without the linear trend
//     term that drift leaks into the harmonic coefficients and inflates the
//     amplitude. Fitting the trend jointly (rather than detrending first)
//     keeps the estimates unbiased.

const S1_PERIOD_HOURS = 24;
const S2_PERIOD_HOURS = 12;

// Below these there is not enough of the record to constrain a 12-hour
// harmonic, and the honest answer is to say so rather than draw something.
// Two full S2 cycles is the bare minimum for the phase to mean anything.
const MIN_SAMPLES = 12;
const MIN_SPAN_HOURS = 24;

// Solve A x = b by Gaussian elimination with partial pivoting. A is small
// and fixed (6x6 normal equations), so this needs no library.
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) return null; // singular
    [M[col], M[pivot]] = [M[pivot], M[col]];

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col] / M[col][col];
      if (!factor) continue;
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }

  // Full Gauss-Jordan above, so each row is now pivot * x_i = rhs.
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * Fit S1 + S2 to a station's pressure record.
 *
 * @param {Array<{timestamp: string, P: number|null}>} rows
 * @param {number} lon  station longitude, for local solar time
 * @returns {null | {
 *   s2Amplitude: number, s2PhaseHours: number, s1Amplitude: number,
 *   sampleCount: number, spanHours: number,
 *   observed: number[],   // real readings, trend + S1 removed
 *   fitted: number[],     // the fitted S2 wave over the same instants
 *   rmseHpa: number
 * }}
 */
export function fitSolarTides(rows, lon = 0) {
  const samples = [];
  for (const row of rows || []) {
    // Number(null) and Number("") are both 0, which is a perfectly finite
    // number, so a missing reading would otherwise be fitted as 0 hPa.
    const raw = row?.P;
    if (raw === null || raw === undefined || raw === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    const ms = new Date(row?.timestamp).getTime();
    if (Number.isNaN(ms)) continue;
    samples.push({ ms, value });
  }
  if (samples.length < MIN_SAMPLES) return null;

  samples.sort((a, b) => a.ms - b.ms);
  const startMs = samples[0].ms;
  const spanHours = (samples[samples.length - 1].ms - startMs) / 3600000;
  if (spanHours < MIN_SPAN_HOURS) return null;

  const lonOffset = Number.isFinite(Number(lon)) ? Number(lon) / 15 : 0;

  const design = samples.map(({ ms }) => {
    const tHours = (ms - startMs) / 3600000;
    const utcHours = new Date(ms).getUTCHours() + new Date(ms).getUTCMinutes() / 60;
    const lst = (((utcHours + lonOffset) % 24) + 24) % 24;
    const w1 = (2 * Math.PI * lst) / S1_PERIOD_HOURS;
    const w2 = (2 * Math.PI * lst) / S2_PERIOD_HOURS;
    return [1, tHours, Math.cos(w1), Math.sin(w1), Math.cos(w2), Math.sin(w2)];
  });

  // Normal equations: (X'X) c = X'y
  const n = 6;
  const XtX = Array.from({ length: n }, () => new Array(n).fill(0));
  const Xty = new Array(n).fill(0);
  for (let i = 0; i < design.length; i++) {
    const x = design[i];
    const y = samples[i].value;
    for (let a = 0; a < n; a++) {
      Xty[a] += x[a] * y;
      for (let b = a; b < n; b++) XtX[a][b] += x[a] * x[b];
    }
  }
  for (let a = 0; a < n; a++) for (let b = 0; b < a; b++) XtX[a][b] = XtX[b][a];

  const c = solve(XtX, Xty);
  if (!c || c.some((v) => !Number.isFinite(v))) return null;

  const [c0, c1, c2, c3, c4, c5] = c;
  const s1Amplitude = Math.hypot(c2, c3);
  const s2Amplitude = Math.hypot(c4, c5);

  // Peak of the S2 wave, in hours of local solar time.
  let s2PhaseHours = (Math.atan2(c5, c4) * S2_PERIOD_HOURS) / (2 * Math.PI);
  s2PhaseHours = ((s2PhaseHours % S2_PERIOD_HOURS) + S2_PERIOD_HOURS) % S2_PERIOD_HOURS;

  // Both traces live in S2 space: the observed one has the fitted mean,
  // trend and S1 subtracted, so what remains is what the S2 fit is actually
  // being compared against. Plotting raw pressure against an S2-only wave
  // would compare two different things and make a good fit look terrible.
  const observed = [];
  const fitted = [];
  let sumSq = 0;
  for (let i = 0; i < design.length; i++) {
    const x = design[i];
    const slow = c0 + c1 * x[1] + c2 * x[2] + c3 * x[3];
    const s2 = c4 * x[4] + c5 * x[5];
    const residual = samples[i].value - slow;
    observed.push(residual);
    fitted.push(s2);
    sumSq += (residual - s2) ** 2;
  }

  return {
    s2Amplitude,
    s2PhaseHours,
    s1Amplitude,
    sampleCount: samples.length,
    spanHours,
    observed,
    fitted,
    rmseHpa: Math.sqrt(sumSq / design.length)
  };
}

// Evenly thin a series down to at most `max` points, so a station on the
// 5-minute keepalive cadence doesn't hand the chart 800 vertices.
export function thin(values, max = 96) {
  if (!Array.isArray(values) || values.length <= max) return values || [];
  const stride = (values.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => values[Math.round(i * stride)]);
}
