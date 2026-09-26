#include "ina219_lite.h"

bool Ina219Lite::begin(TwoWire &w, uint8_t addr, float shunt_ohm) {
    w_ = &w; addr_ = addr; r_ = shunt_ohm;
    // config: 32 V range, PGA /8 (+-320 mV shunt), 12-bit ADCs, continuous shunt + bus
    w_->beginTransmission(addr_);
    w_->write(0x00); w_->write(0x39); w_->write(0x9F);
    return w_->endTransmission() == 0;
}

int16_t Ina219Lite::read16(uint8_t reg) {
    w_->beginTransmission(addr_);
    w_->write(reg);
    if (w_->endTransmission(false) != 0) return 0;
    if (w_->requestFrom((int)addr_, 2) != 2) return 0;
    uint16_t v = ((uint16_t)w_->read() << 8) | w_->read();
    return (int16_t)v;
}

float Ina219Lite::currentMa() {
    float shunt_mV = read16(0x01) * 0.01f;       // 10 uV per LSB
    return shunt_mV / r_;                        // mV / ohm = mA
}

float Ina219Lite::busVolts() {
    return ((uint16_t)read16(0x02) >> 3) * 0.004f;   // bits 15..3, 4 mV per LSB
}
