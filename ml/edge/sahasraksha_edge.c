// Sahasraksha-Edge  |  AWS_REGEN  |  auto-generated, no dependencies
#include <math.h>
#include <stdint.h>

#define SG_PI 3.14159265358979f

#define NC 11                       // 1 + 3 diurnal harmonic pairs + 2 annual pairs
static const float BT[NC] = {26.500000f, 4.300000f, 4.400000f, 0.030000f, 0.006000f, -0.000800f, 0.019000f, -5.300000f, 5.600000f, 0.440000f, 1.160000f};
static const float BP[NC] = {1008.800000f, 0.320000f, 0.470000f, 0.470000f, -0.820000f, 0.011000f, 0.012000f, -2.800000f, -3.000000f, -0.770000f, -1.310000f};
static const float BH[NC] = {58.900000f, -11.800000f, -11.900000f, -0.090000f, 1.690000f, 0.100000f, -0.150000f, 6.500000f, -17.600000f, -2.020000f, -0.180000f};

typedef struct {
    float mean[3], var[3], last[3];
    uint16_t run[3];
    float cp[3], cn[3];
    float A, B, detrend, amp_base;
    uint32_t n;
} sg_state_t;                       // 25 floats + 3 uint16 + 1 uint32 = 116 bytes

static void basis(float lst, float doy, float *x) {
    x[0] = 1.0f;
    for (int k = 1; k <= 3; k++) {
        x[2*k-1] = cosf(2.0f*SG_PI*k*lst/24.0f);
        x[2*k  ] = sinf(2.0f*SG_PI*k*lst/24.0f);
    }
    x[7] = cosf(2.0f*SG_PI*doy/365.25f);
    x[8] = sinf(2.0f*SG_PI*doy/365.25f);
    x[9] = cosf(4.0f*SG_PI*doy/365.25f);
    x[10]= sinf(4.0f*SG_PI*doy/365.25f);
}

static float predict(const float *b, const float *x) {
    float s = 0.0f;
    for (int i = 0; i < NC; i++) s += b[i]*x[i];
    return s;
}

// returns bitmask: 1 range, 2 step, 4 frozen, 8 drift, 16 tide degradation
uint8_t sg_update(sg_state_t *st, float lst, float doy,
                  float T, float P, float RH) {
    float x[NC]; basis(lst, doy, x);
    const float lo[3] = {-40.f, 500.f, 0.f}, hi[3] = {60.f, 1100.f, 100.f};
    const float stepl[3] = {6.f, 5.f, 45.f};
    const uint16_t runl[3] = {6, 6, 10};
    float v[3] = {T, P, RH};
    const float *bt[3] = {BT, BP, BH};
    const float a = 0.02f, k = 3.0f, h = 12.0f;
    uint8_t flags = 0;

    for (int c = 0; c < 3; c++) {
        if (!isfinite(v[c])) continue;
        if (v[c] < lo[c] || v[c] > hi[c]) flags |= 1;
        if (st->n) {
            if (fabsf(v[c] - st->last[c]) > stepl[c]) flags |= 2;
            st->run[c] = (v[c] == st->last[c]) ? st->run[c] + 1 : 0;
            if (st->run[c] >= runl[c]) flags |= 4;
        }
        st->last[c] = v[c];

        float r = v[c] - predict(bt[c], x);
        st->mean[c] = (1.f-a)*st->mean[c] + a*r;
        float d = r - st->mean[c];
        st->var[c] = (1.f-a)*st->var[c] + a*d*d;
        float z = d / (sqrtf(st->var[c]) + 1e-6f);

        st->cp[c] = fmaxf(0.f, st->cp[c] + z - k);
        st->cn[c] = fmaxf(0.f, st->cn[c] - z - k);
        if (fmaxf(st->cp[c], st->cn[c]) > h) { flags |= 8; st->cp[c]=st->cn[c]=0.f; }
    }

    // Semidiurnal tide heartbeat on pressure -- the early-warning channel
    const float ta = 0.01f;
    if (st->n == 0) st->detrend = P;
    st->detrend = (1.f-ta)*st->detrend + ta*P;
    float y = P - st->detrend, w = 2.0f*SG_PI*lst/12.0f;
    st->A = (1.f-ta)*st->A + ta*2.f*y*cosf(w);
    st->B = (1.f-ta)*st->B + ta*2.f*y*sinf(w);
    if (st->n > 336) {
        float amp = sqrtf(st->A*st->A + st->B*st->B);
        if (st->amp_base <= 0.f) st->amp_base = amp;
        else st->amp_base = 0.9995f*st->amp_base + 0.0005f*amp;
        if (st->amp_base > 1e-6f && amp/st->amp_base < 0.55f) flags |= 16;
    }
    st->n++;
    return flags;
}
