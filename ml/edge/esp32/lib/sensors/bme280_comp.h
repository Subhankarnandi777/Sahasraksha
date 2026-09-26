/* Bosch BME280 / BMP280 compensation (integer formulas from the Bosch datasheets,
 * BME280 rev 1.6 section 4.2.3 / BMP280 rev 1.14 section 3.11.3). Pure C, no I/O,
 * so it can be unit-tested on a PC (tools/host_test.c). */
#pragma once
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
typedef struct {
    uint16_t T1; int16_t T2, T3;
    uint16_t P1; int16_t P2, P3, P4, P5, P6, P7, P8, P9;
    uint8_t  H1; int16_t H2; uint8_t H3; int16_t H4, H5; int8_t H6;
} bme_calib_t;

/* returns 0.01 degC, writes t_fine */
int32_t  bme_comp_T(const bme_calib_t *c, int32_t adc_T, int32_t *t_fine);
/* returns Pa * 256 (Q24.8) */
uint32_t bme_comp_P(const bme_calib_t *c, int32_t adc_P, int32_t t_fine);
/* returns %RH * 1024 (Q22.10) */
uint32_t bme_comp_H(const bme_calib_t *c, int32_t adc_H, int32_t t_fine);
/* parse the raw calibration blocks: 26 bytes from 0x88, 7 bytes from 0xE1 (BME280 only; NULL for BMP280) */
void bme_parse_calib(bme_calib_t *c, const uint8_t *b88, const uint8_t *bE1);
#ifdef __cplusplus
}
#endif
