package com.upscaler.service;

import org.springframework.stereotype.Service;

import java.awt.Dimension;
import java.util.Locale;
import java.util.Map;

@Service
public class PrintSizeCalculator {

    private static final int MIN_DPI = 72;
    private static final int MAX_DPI = 1200;

    private static final Map<String, double[]> PRESETS = Map.of(
            "A5", new double[]{148, 210},
            "A4", new double[]{210, 297},
            "A3", new double[]{297, 420},
            "LETTER", new double[]{215.9, 279.4},
            "LEGAL", new double[]{215.9, 355.6}
    );

    /**
     * Calculates pixel dimensions from a print-size preset.
     * Preset dimensions are stored in millimetres.
     */
    public Dimension calculatePreset(
            String preset,
            String orientation,
            int dpi
    ) {
        validateDpi(dpi);

        if (preset == null || !PRESETS.containsKey(
                preset.trim().toUpperCase(Locale.ROOT))) {
            throw new IllegalArgumentException(
                    "Unsupported print-size preset: " + preset);
        }

        String normalizedPreset =
                preset.trim().toUpperCase(Locale.ROOT);

        double[] dimensions = PRESETS.get(normalizedPreset);

        double widthMm = dimensions[0];
        double heightMm = dimensions[1];

        if (orientation != null
                && orientation.equalsIgnoreCase("landscape")) {
            double temp = widthMm;
            widthMm = heightMm;
            heightMm = temp;
        } else if (orientation != null
                && !orientation.equalsIgnoreCase("portrait")) {
            throw new IllegalArgumentException(
                    "Orientation must be portrait or landscape");
        }

        int widthPx = millimetresToPixels(widthMm, dpi);
        int heightPx = millimetresToPixels(heightMm, dpi);

        return new Dimension(widthPx, heightPx);
    }

    /**
     * Calculates pixels from custom dimensions in centimetres.
     */
    public Dimension calculateCustom(
            double widthCm,
            double heightCm,
            int dpi
    ) {
        validateDpi(dpi);

        if (!Double.isFinite(widthCm)
                || !Double.isFinite(heightCm)
                || widthCm <= 0
                || heightCm <= 0) {
            throw new IllegalArgumentException(
                    "Custom width and height must be positive numbers");
        }

        int widthPx = (int) Math.round((widthCm / 2.54) * dpi);
        int heightPx = (int) Math.round((heightCm / 2.54) * dpi);

        return new Dimension(widthPx, heightPx);
    }

    private int millimetresToPixels(double millimetres, int dpi) {
        return (int) Math.round((millimetres / 25.4) * dpi);
    }

    private void validateDpi(int dpi) {
        if (dpi < MIN_DPI || dpi > MAX_DPI) {
            throw new IllegalArgumentException(
                    "DPI must be between 72 and 1200");
        }
    }
}
