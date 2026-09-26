/* Minimal BME280 / BMP280 driver (no external library).
 * Auto-detects the chip at 0x76 or 0x77 by chip-ID: 0x60 = BME280 (T, P, RH),
 * 0x58 = BMP280 (T, P only - NO humidity). Many "HW-611" boards are BMP280. */
#pragma once
#include <Arduino.h>
#include <Wire.h>
#include "bme280_comp.h"

class Bme280Lite {
public:
    bool begin(TwoWire &w = Wire);          // true if a BME280 or BMP280 answered
    bool read(float &T_c, float &P_hpa, float &RH_pct);  // one forced-mode measurement
    bool hasHumidity() const { return chip_ == 0x60; }
    uint8_t address() const { return addr_; }
    uint8_t chipId() const { return chip_; }
    const char *name() const { return chip_ == 0x60 ? "BME280" : chip_ == 0x58 ? "BMP280" : "none"; }
    uint32_t lastMeasureUs() const { return measUs_; }
private:
    bool rd(uint8_t reg, uint8_t *buf, size_t n);
    bool wr(uint8_t reg, uint8_t v);
    TwoWire *w_ = nullptr;
    uint8_t addr_ = 0, chip_ = 0;
    bme_calib_t cal_{};
    uint32_t measUs_ = 0;
};
