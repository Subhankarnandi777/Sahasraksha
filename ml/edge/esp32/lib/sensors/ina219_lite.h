/* Minimal INA219 current monitor (optional, for measured energy). 0x40 default.
 * Assumes the standard 0.1 ohm shunt on the purple/blue breakout boards. */
#pragma once
#include <Arduino.h>
#include <Wire.h>

class Ina219Lite {
public:
    bool begin(TwoWire &w = Wire, uint8_t addr = 0x40, float shunt_ohm = 0.1f);
    float currentMa();   // from the shunt voltage: I = Vshunt / Rshunt
    float busVolts();
private:
    int16_t read16(uint8_t reg);
    TwoWire *w_ = nullptr;
    uint8_t addr_ = 0x40;
    float r_ = 0.1f;
};
