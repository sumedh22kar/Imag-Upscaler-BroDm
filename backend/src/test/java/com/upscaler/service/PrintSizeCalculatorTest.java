package com.upscaler.service;

import org.junit.jupiter.api.Test;

import java.awt.Dimension;

import static org.junit.jupiter.api.Assertions.*;

class PrintSizeCalculatorTest {

    private final PrintSizeCalculator calculator =
            new PrintSizeCalculator();

    @Test
    void shouldCalculateA4PortraitAt300Dpi() {
        Dimension result =
                calculator.calculatePreset("A4", "portrait", 300);

        assertEquals(2480, result.width);
        assertEquals(3508, result.height);
    }

    @Test
    void shouldCalculateA4LandscapeAt300Dpi() {
        Dimension result =
                calculator.calculatePreset("A4", "landscape", 300);

        assertEquals(3508, result.width);
        assertEquals(2480, result.height);
    }

    @Test
    void shouldCalculateA3PortraitAt300Dpi() {
        Dimension result =
                calculator.calculatePreset("A3", "portrait", 300);

        assertEquals(3508, result.width);
        assertEquals(4961, result.height);
    }

    @Test
    void shouldCalculateCustomSizeInCentimetres() {
        Dimension result =
                calculator.calculateCustom(10, 15, 300);

        assertEquals(1181, result.width);
        assertEquals(1772, result.height);
    }

    @Test
    void shouldRejectUnsupportedPreset() {
        assertThrows(
                IllegalArgumentException.class,
                () -> calculator.calculatePreset(
                        "UNKNOWN", "portrait", 300)
        );
    }

    @Test
    void shouldRejectInvalidDpi() {
        assertThrows(
                IllegalArgumentException.class,
                () -> calculator.calculatePreset(
                        "A4", "portrait", 50)
        );
    }

    @Test
    void shouldRejectInvalidCustomDimensions() {
        assertThrows(
                IllegalArgumentException.class,
                () -> calculator.calculateCustom(-10, 15, 300)
        );
    }
}
