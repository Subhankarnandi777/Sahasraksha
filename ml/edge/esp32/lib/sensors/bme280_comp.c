#include "bme280_comp.h"
#include <string.h>

int32_t bme_comp_T(const bme_calib_t *c, int32_t adc_T, int32_t *t_fine) {
    int32_t var1 = ((((adc_T >> 3) - ((int32_t)c->T1 << 1))) * ((int32_t)c->T2)) >> 11;
    int32_t var2 = (((((adc_T >> 4) - ((int32_t)c->T1)) * ((adc_T >> 4) - ((int32_t)c->T1))) >> 12) *
                    ((int32_t)c->T3)) >> 14;
    *t_fine = var1 + var2;
    return (*t_fine * 5 + 128) >> 8;
}

uint32_t bme_comp_P(const bme_calib_t *c, int32_t adc_P, int32_t t_fine) {
    int64_t var1 = ((int64_t)t_fine) - 128000;
    int64_t var2 = var1 * var1 * (int64_t)c->P6;
    var2 = var2 + ((var1 * (int64_t)c->P5) << 17);
    var2 = var2 + (((int64_t)c->P4) << 35);
    var1 = ((var1 * var1 * (int64_t)c->P3) >> 8) + ((var1 * (int64_t)c->P2) << 12);
    var1 = (((((int64_t)1) << 47) + var1)) * ((int64_t)c->P1) >> 33;
    if (var1 == 0) return 0;                      /* avoid division by zero */
    int64_t p = 1048576 - adc_P;
    p = (((p << 31) - var2) * 3125) / var1;
    var1 = (((int64_t)c->P9) * (p >> 13) * (p >> 13)) >> 25;
    var2 = (((int64_t)c->P8) * p) >> 19;
    p = ((p + var1 + var2) >> 8) + (((int64_t)c->P7) << 4);
    return (uint32_t)p;
}

uint32_t bme_comp_H(const bme_calib_t *c, int32_t adc_H, int32_t t_fine) {
    int32_t v = (t_fine - ((int32_t)76800));
    v = (((((adc_H << 14) - (((int32_t)c->H4) << 20) - (((int32_t)c->H5) * v)) + ((int32_t)16384)) >> 15) *
         (((((((v * ((int32_t)c->H6)) >> 10) * (((v * ((int32_t)c->H3)) >> 11) + ((int32_t)32768))) >> 10) +
            ((int32_t)2097152)) * ((int32_t)c->H2) + 8192) >> 14));
    v = (v - (((((v >> 15) * (v >> 15)) >> 7) * ((int32_t)c->H1)) >> 4));
    v = (v < 0 ? 0 : v);
    v = (v > 419430400 ? 419430400 : v);
    return (uint32_t)(v >> 12);
}

static uint16_t u16le(const uint8_t *b) { return (uint16_t)(b[0] | (b[1] << 8)); }

void bme_parse_calib(bme_calib_t *c, const uint8_t *b, const uint8_t *e) {
    memset(c, 0, sizeof(*c));
    c->T1 = u16le(b + 0);  c->T2 = (int16_t)u16le(b + 2);  c->T3 = (int16_t)u16le(b + 4);
    c->P1 = u16le(b + 6);  c->P2 = (int16_t)u16le(b + 8);  c->P3 = (int16_t)u16le(b + 10);
    c->P4 = (int16_t)u16le(b + 12); c->P5 = (int16_t)u16le(b + 14); c->P6 = (int16_t)u16le(b + 16);
    c->P7 = (int16_t)u16le(b + 18); c->P8 = (int16_t)u16le(b + 20); c->P9 = (int16_t)u16le(b + 22);
    c->H1 = b[25];                                        /* register 0xA1 */
    if (e) {                                              /* 0xE1..0xE7 */
        c->H2 = (int16_t)u16le(e + 0);
        c->H3 = e[2];
        c->H4 = (int16_t)(((int16_t)(int8_t)e[3] << 4) | (e[4] & 0x0F));
        c->H5 = (int16_t)(((int16_t)(int8_t)e[5] << 4) | (e[4] >> 4));
        c->H6 = (int8_t)e[6];
    }
}
