/* Sahasraksha-Edge — see sahasraksha_edge.h. Mirrors ml/sahasraksha/stream.py. */
#include "sahasraksha_edge.h"
#include <math.h>
#include <string.h>

#define SG_PI 3.14159265358979f

/* identical to stream.py */
static const float LO[3]    = {-40.f, 500.f, 0.f};
static const float HI[3]    = { 60.f, 1100.f, 100.f};
static const float STEPL[3] = {  6.f,   5.f,  45.f};
static const uint16_t RUNL[3] = {6, 6, 10};
#define ALPHA       0.02f       /* EW mean/variance of residual              */
#define TIDE_ALPHA  0.01f
#define CUSUM_K     3.0f
#define CUSUM_H    12.0f
#define Z_CUT       4.0f
#define DEG_CUT     0.45f
#define TIDE_WARMUP 336u        /* 14 days of hourly readings                */
#define T_RECORD   52.0f        /* India's record is 51.0 C (Phalodi, 2016)   */
#define TD_CEILING 34.0f
#define MAGNUS_A   17.62f
#define MAGNUS_B  243.12f

static void basis(float lst, float doy, float *x) {
    x[0] = 1.0f;
    for (int k = 1; k <= 3; k++) {
        x[2*k-1] = cosf(2.0f*SG_PI*k*lst/24.0f);
        x[2*k  ] = sinf(2.0f*SG_PI*k*lst/24.0f);
    }
    x[7]  = cosf(2.0f*SG_PI*doy/365.25f);
    x[8]  = sinf(2.0f*SG_PI*doy/365.25f);
    x[9]  = cosf(4.0f*SG_PI*doy/365.25f);
    x[10] = sinf(4.0f*SG_PI*doy/365.25f);
}

static float dot(const float *b, const float *x) {
    float s = 0.0f;
    for (int i = 0; i < SG_NC; i++) s += b[i]*x[i];
    return s;
}

static float dewpoint(float T, float RH) {
    if (RH < 1e-3f) RH = 1e-3f;
    float g = logf(RH/100.0f) + MAGNUS_A*T/(MAGNUS_B + T);
    return MAGNUS_B*g/(MAGNUS_A - g);
}

void sg_init(sg_state_t *st) {
    memset(st, 0, sizeof(*st));
    for (int c = 0; c < 3; c++) { st->var[c] = 1.0f; st->last[c] = NAN; }
    st->detrend = NAN;
    st->amp_base = -1.0f;        /* "not set yet" */
}

void sg_update(sg_state_t *st, const sg_coeffs_t *co, float lst, float doy,
               float T, float P, float RH, sg_verdict_t *o) {
    sg_update_ex(st, co, lst, doy, T, P, RH, SG_CH_ALL, o);
}

void sg_update_ex(sg_state_t *st, const sg_coeffs_t *co, float lst, float doy,
                  float T, float P, float RH, uint8_t channels, sg_verdict_t *o) {
    float x[SG_NC];
    basis(lst, doy, x);
    const float v[3] = {T, P, RH};
    uint16_t fl = 0;
    float zabs[3] = {0, 0, 0};
    int have_z = 0;
    float cs_peak = 0.0f;
    memset(o, 0, sizeof(*o));
    st->n++;

    for (int c = 0; c < 3; c++) {
        /* estimate BEFORE this reading updates the statistics */
        o->estimate[c] = dot(co->b[c], x) + st->mean[c];
        o->band[c] = 2.0f*sqrtf(st->var[c]);

        if (!(channels & (1u << c))) continue;          /* sensor not fitted */
        if (!isfinite(v[c])) { fl |= SG_MISSING; continue; }
        if (v[c] < LO[c] || v[c] > HI[c]) fl |= SG_RANGE;
        if (isfinite(st->last[c])) {
            if (fabsf(v[c] - st->last[c]) > STEPL[c]) fl |= SG_STEP;
            st->run[c] = (v[c] == st->last[c]) ? (uint16_t)(st->run[c] + 1) : 0;
            if (st->run[c] >= RUNL[c]) fl |= SG_FROZEN;
        }
        st->last[c] = v[c];

        float r = v[c] - dot(co->b[c], x);
        st->mean[c] = (1.f-ALPHA)*st->mean[c] + ALPHA*r;
        float d = r - st->mean[c];
        st->var[c] = (1.f-ALPHA)*st->var[c] + ALPHA*d*d;
        float z = d/(sqrtf(st->var[c]) + 1e-6f);
        zabs[c] = fabsf(z); have_z = 1;

        st->cp[c] = fmaxf(0.f, st->cp[c] + z - CUSUM_K);
        st->cn[c] = fmaxf(0.f, st->cn[c] - z - CUSUM_K);
        float cs = fmaxf(st->cp[c], st->cn[c]);
        if (cs > cs_peak) cs_peak = cs;
        if (cs > CUSUM_H) { fl |= SG_DRIFT; st->cp[c] = st->cn[c] = 0.f; }

        if (c == 1) {                     /* tide heartbeat on pressure */
            if (!isfinite(st->detrend)) st->detrend = v[1];
            st->detrend = (1.f-TIDE_ALPHA)*st->detrend + TIDE_ALPHA*v[1];
            float y = v[1] - st->detrend, w = 2.0f*SG_PI*lst/12.0f;
            st->A = (1.f-TIDE_ALPHA)*st->A + TIDE_ALPHA*2.f*y*cosf(w);
            st->B = (1.f-TIDE_ALPHA)*st->B + TIDE_ALPHA*2.f*y*sinf(w);
        }
    }

    /* impossible combinations: need T and RH together */
    if ((channels & SG_CH_T) && (channels & SG_CH_RH) && isfinite(T) && isfinite(RH)) {
        float Td = dewpoint(T, RH);
        if (Td > T + 0.5f || RH > 100.5f) fl |= SG_IMPOSSIBLE;
        if (Td > TD_CEILING) fl |= SG_IMPOSSIBLE;
    }
    if ((channels & SG_CH_T) && isfinite(T) && T > T_RECORD) fl |= SG_IMPOSSIBLE;

    int physics = (fl & (SG_RANGE | SG_FROZEN | SG_STEP | SG_IMPOSSIBLE)) != 0;
    int missing = (fl & SG_MISSING) != 0;
    int drift   = (fl & SG_DRIFT) != 0;
    float zmax = have_z ? fmaxf(zabs[0], fmaxf(zabs[1], zabs[2])) : 0.f;
    int ml_like = zmax > Z_CUT;
    if (ml_like) fl |= SG_ANOMALY;

    float deg = 0.f;
    if (st->n > TIDE_WARMUP) {
        float amp = sqrtf(st->A*st->A + st->B*st->B);
        if (st->amp_base < 0.f) st->amp_base = amp;
        else {
            st->amp_base = 0.9995f*st->amp_base + 0.0005f*amp;
            if (st->amp_base > 1e-6f) {
                float ratio = amp/st->amp_base;
                if (ratio > 1.f) ratio = 1.f;
                if (ratio < 0.f) ratio = 0.f;
                deg = 1.f - ratio;
            }
        }
    }
    if (deg > DEG_CUT) fl |= SG_DEGRADING;

    o->flags = fl;
    o->flag = (physics || missing || drift || ml_like || deg > DEG_CUT) ? 1 : 0;
    if (physics) {
        o->reason = (fl & SG_IMPOSSIBLE) ? SG_R_IMPOSSIBLE : (fl & SG_RANGE) ? SG_R_RANGE
                  : (fl & SG_FROZEN) ? SG_R_FROZEN : SG_R_STEP;
    } else if (missing)       o->reason = SG_R_MISSING;
    else if (deg > DEG_CUT)   o->reason = SG_R_DEGRADING;
    else if (drift)           o->reason = SG_R_DRIFT;
    else if (ml_like)         o->reason = SG_R_ANOMALY;
    else                      o->reason = SG_R_OK;

    float sev = zmax/8.0f + 0.5f*physics + 0.5f*missing + deg;
    o->severity = sev < 0.f ? 0.f : (sev > 1.f ? 1.f : sev);
    o->degradation = deg;
    o->zmax = zmax;

    /* confidence: margin past the deciding threshold (not a calibrated probability) */
    float conf;
    if (physics || missing) conf = 1.0f;
    else if (o->flag) {
        float m = 0.f;
        if (deg > DEG_CUT) m = fmaxf(m, (deg - DEG_CUT)/DEG_CUT);
        if (drift)         m = fmaxf(m, (cs_peak - CUSUM_H)/CUSUM_H);
        if (ml_like)       m = fmaxf(m, (zmax - Z_CUT)/Z_CUT);
        conf = 0.5f + 0.5f*(1.f - expf(-3.f*m));
    } else {
        float cl = fmaxf(zmax/Z_CUT, fmaxf(cs_peak/CUSUM_H, deg/DEG_CUT));
        if (cl > 1.f) cl = 1.f;
        conf = 0.5f + 0.5f*(1.f - cl);
    }
    o->confidence = conf;
}

const char *sg_reason_name(uint8_t r) {
    static const char *N[] = {"ok", "impossible", "range", "frozen", "step",
                              "missing", "degrading", "drift", "anomaly"};
    return r < 9 ? N[r] : "?";
}

const char *sg_action(uint8_t r) {
    switch (r) {
    case SG_R_IMPOSSIBLE: return "Quarantine reading; use estimate. Inspect T/RH probe if it recurs in 24 h.";
    case SG_R_RANGE:      return "Outside physical limits. Quarantine; check units and wiring.";
    case SG_R_STEP:       return "Sudden jump. If the new level persists, verify installation and apply offset.";
    case SG_R_FROZEN:     return "Sensor/logger stuck. Power-cycle; dispatch if not cleared in 6 h.";
    case SG_R_MISSING:    return "Channel missing. Check sensor wiring and power.";
    case SG_R_DRIFT:      return "Calibration drift. Schedule recalibration against a transfer standard.";
    case SG_R_DEGRADING:  return "Barometer losing its 12-hour tide. Clear pressure port; schedule service.";
    case SG_R_ANOMALY:    return "Disagrees with own baseline. Hold for review; no dispatch unless it persists.";
    default:              return "";
    }
}
