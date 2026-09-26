/*
 * Sahasraksha-Edge — on-device AWS self-diagnosis (SIH26073)
 *
 * C99 port of StreamingSahasraksha.update() in ml/sahasraksha/stream.py,
 * the detector the live site runs. Same gates, same thresholds, same
 * statistics. No heap, no model file, no network, no library beyond libm.
 *
 * Per station: one sg_state_t (88 bytes) + one sg_coeffs_t (132 bytes, const,
 * lives in flash). Call sg_init() once, then sg_update() once per reading.
 */
#ifndef SAHASRAKSHA_EDGE_H
#define SAHASRAKSHA_EDGE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define SG_NC 11                 /* 1 + 3 diurnal harmonic pairs + 2 annual pairs */

/* verdict flag bits (several can be set at once) */
#define SG_RANGE       0x0001u   /* outside gross physical limits             */
#define SG_STEP        0x0002u   /* jump bigger than the atmosphere can make   */
#define SG_FROZEN      0x0004u   /* identical value repeated too long          */
#define SG_DRIFT       0x0008u   /* CUSUM on own-baseline residual             */
#define SG_DEGRADING   0x0010u   /* pressure lost its 12-hour tide             */
#define SG_MISSING     0x0020u   /* channel absent (NaN)                       */
#define SG_IMPOSSIBLE  0x0040u   /* >52 C, dewpoint >34 C, or Td > T           */
#define SG_ANOMALY     0x0080u   /* |z| > 4 against own baseline               */

/* reason = the single label shown to an operator (same priority as stream.py) */
typedef enum {
    SG_R_OK = 0, SG_R_IMPOSSIBLE, SG_R_RANGE, SG_R_FROZEN, SG_R_STEP,
    SG_R_MISSING, SG_R_DEGRADING, SG_R_DRIFT, SG_R_ANOMALY
} sg_reason_t;

/* per-station harmonic baseline, fitted offline (tools/make_coeffs.py) */
typedef struct {
    float b[3][SG_NC];           /* [T, P, RH][11 terms] */
} sg_coeffs_t;

typedef struct {
    float mean[3], var[3], last[3];
    uint16_t run[3];
    float cp[3], cn[3];
    float A, B, detrend, amp_base;
    uint32_t n;
} sg_state_t;                    /* 19 floats + 3 uint16 + pad + 1 uint32 = 88 bytes */

typedef struct {
    uint16_t flags;              /* SG_* bits                                  */
    uint8_t  reason;             /* sg_reason_t                                */
    uint8_t  flag;               /* 1 = anomalous reading                      */
    float severity;              /* 0..1                                       */
    float confidence;            /* 1.0 for physics rules, else margin past threshold (0.5 = on the line) */
    float degradation;           /* 0..1 tide-amplitude loss                   */
    float zmax;                  /* largest |z| over channels                  */
    float estimate[3];           /* expected T, P, RH (own baseline + bias)    */
    float band[3];               /* +/- 2 sigma                                */
} sg_verdict_t;

void sg_init(sg_state_t *st);

/* lst = local solar time in hours (UTC hour + lon/15, wrapped to 0..24)
 * doy = day of year (1..366). Pass NAN for a missing channel. */
void sg_update(sg_state_t *st, const sg_coeffs_t *c, float lst, float doy,
               float T, float P, float RH, sg_verdict_t *out);

/* Same as sg_update, for a station that does not HAVE every sensor (e.g. a
 * BMP280 has no humidity). channels: bit0 = T, bit1 = P, bit2 = RH. A channel
 * outside the mask is skipped silently instead of being flagged "missing".
 * sg_update() == sg_update_ex(..., SG_CH_ALL, ...). */
#define SG_CH_T   0x1u
#define SG_CH_P   0x2u
#define SG_CH_RH  0x4u
#define SG_CH_ALL 0x7u
void sg_update_ex(sg_state_t *st, const sg_coeffs_t *c, float lst, float doy,
                  float T, float P, float RH, uint8_t channels, sg_verdict_t *out);

const char *sg_reason_name(uint8_t reason);
const char *sg_action(uint8_t reason);

#ifdef __cplusplus
}
#endif
#endif
