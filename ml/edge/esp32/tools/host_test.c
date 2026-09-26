/* Run the detector and the BME280 maths on a PC before touching the board.
 *
 *   gcc -std=c99 -O2 -Wall -Ilib/sahasraksha_edge -Ilib/sensors -Iinclude \
 *       tools/host_test.c lib/sahasraksha_edge/sahasraksha_edge.c lib/sensors/bme280_comp.c -lm -o host_test
 *   ./host_test          (Windows: host_test.exe)
 *
 * Expected: "golden 480/480 PASS" and "BMP280 datasheet example PASS". */
#include <stdio.h>
#include <time.h>
#include "sahasraksha_edge.h"
#include "bme280_comp.h"
#include "golden_vectors.h"

int main(void) {
    sg_state_t st; sg_init(&st);
    sg_verdict_t v;
    int agree = 0;
    for (int i = 0; i < GOLDEN_N; i++) {
        const float *r = GOLDEN_IN[i];
        sg_update(&st, &GOLDEN_COEFFS, r[0], r[1], r[2], r[3], r[4], &v);
        if (v.reason == GOLDEN_REASON[i]) agree++;
        else printf("row %d: got %s expected %s\n", i, sg_reason_name(v.reason), sg_reason_name(GOLDEN_REASON[i]));
        if (golden_event(i)[0] && (i == 400 || i == 426 || i == 450 || i == 460))
            printf("row %3d %-36s -> %-10s conf %.2f  T est %.2f +- %.2f\n", i, golden_event(i),
                   sg_reason_name(v.reason), v.confidence, v.estimate[0], v.band[0]);
    }
    printf("golden %d/%d %s\n", agree, GOLDEN_N, agree == GOLDEN_N ? "PASS" : "FAIL");
    printf("sizeof(sg_state_t) = %u bytes\n", (unsigned)sizeof(sg_state_t));

    /* speed on this PC (for comparison with the ESP32 BENCH) */
    clock_t t0 = clock();
    const int REPS = 2000;
    for (int k = 0; k < REPS; k++) {
        sg_init(&st);
        for (int i = 0; i < GOLDEN_N; i++) {
            const float *r = GOLDEN_IN[i];
            sg_update(&st, &GOLDEN_COEFFS, r[0], r[1], r[2], r[3], r[4], &v);
        }
    }
    double us = 1e6 * (double)(clock() - t0) / CLOCKS_PER_SEC / ((double)REPS * GOLDEN_N);
    printf("PC speed: %.3f us per sg_update\n", us);

    /* BMP280 datasheet worked example (section 3.12) */
    bme_calib_t c = {0};
    c.T1 = 27504; c.T2 = 26435; c.T3 = -1000;
    c.P1 = 36477; c.P2 = -10685; c.P3 = 3024; c.P4 = 2855; c.P5 = 140; c.P6 = -7;
    c.P7 = 15500; c.P8 = -14600; c.P9 = 6000;
    int32_t tf;
    int32_t T = bme_comp_T(&c, 519888, &tf);
    double P = bme_comp_P(&c, 415148, tf) / 256.0;
    int ok = (T == 2508) && P > 100652.0 && P < 100654.5;
    printf("BMP280 datasheet example: T %.2f C (25.08), P %.2f Pa (100653.27) %s\n", T / 100.0, P, ok ? "PASS" : "FAIL");
    return (agree == GOLDEN_N && ok) ? 0 : 1;
}
