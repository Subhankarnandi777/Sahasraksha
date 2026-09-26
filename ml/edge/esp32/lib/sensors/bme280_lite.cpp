#include "bme280_lite.h"

bool Bme280Lite::rd(uint8_t reg, uint8_t *buf, size_t n) {
    w_->beginTransmission(addr_);
    w_->write(reg);
    if (w_->endTransmission(false) != 0) return false;
    if (w_->requestFrom((int)addr_, (int)n) != (int)n) return false;
    for (size_t i = 0; i < n; i++) buf[i] = w_->read();
    return true;
}

bool Bme280Lite::wr(uint8_t reg, uint8_t v) {
    w_->beginTransmission(addr_);
    w_->write(reg);
    w_->write(v);
    return w_->endTransmission() == 0;
}

bool Bme280Lite::begin(TwoWire &w) {
    w_ = &w;
    const uint8_t cands[2] = {0x76, 0x77};
    for (uint8_t a : cands) {
        addr_ = a;
        uint8_t id = 0;
        if (rd(0xD0, &id, 1) && (id == 0x60 || id == 0x58)) { chip_ = id; break; }
        chip_ = 0;
    }
    if (!chip_) return false;
    wr(0xE0, 0xB6);                                   // soft reset
    delay(5);
    uint8_t b88[26], bE1[7];
    if (!rd(0x88, b88, 26)) return false;
    if (chip_ == 0x60) { if (!rd(0xE1, bE1, 7)) return false; }
    bme_parse_calib(&cal_, b88, chip_ == 0x60 ? bE1 : nullptr);
    wr(0xF5, 0x00);                                   // no IIR filter, standby unused (forced mode)
    if (chip_ == 0x60) wr(0xF2, 0x01);                // humidity oversampling x1 (must precede 0xF4)
    wr(0xF4, (1 << 5) | (1 << 2) | 0x00);             // T x1, P x1, sleep mode
    return true;
}

bool Bme280Lite::read(float &T_c, float &P_hpa, float &RH_pct) {
    if (!chip_) return false;
    uint32_t t0 = micros();
    if (chip_ == 0x60) wr(0xF2, 0x01);
    wr(0xF4, (1 << 5) | (1 << 2) | 0x01);             // forced mode: one measurement, then sleep
    uint8_t st = 0x08;
    for (int i = 0; i < 50 && (st & 0x08); i++) {     // wait for "measuring" bit to clear (~8 ms)
        delay(1);
        if (!rd(0xF3, &st, 1)) return false;
    }
    uint8_t d[8];
    if (!rd(0xF7, d, chip_ == 0x60 ? 8 : 6)) return false;
    measUs_ = micros() - t0;
    int32_t adcP = ((int32_t)d[0] << 12) | ((int32_t)d[1] << 4) | (d[2] >> 4);
    int32_t adcT = ((int32_t)d[3] << 12) | ((int32_t)d[4] << 4) | (d[5] >> 4);
    int32_t tf;
    T_c = bme_comp_T(&cal_, adcT, &tf) / 100.0f;
    P_hpa = bme_comp_P(&cal_, adcP, tf) / 25600.0f;
    if (chip_ == 0x60) {
        int32_t adcH = ((int32_t)d[6] << 8) | d[7];
        RH_pct = bme_comp_H(&cal_, adcH, tf) / 1024.0f;
    } else {
        RH_pct = NAN;
    }
    return true;
}
