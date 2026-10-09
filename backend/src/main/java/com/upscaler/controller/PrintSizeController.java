package com.upscaler.controller;

import com.upscaler.service.PrintSizeCalculator;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.awt.Dimension;
import java.util.Map;

@RestController
@RequestMapping("/api/images/print-sizes")
public class PrintSizeController {

    private final PrintSizeCalculator calculator;

    public PrintSizeController(PrintSizeCalculator calculator) {
        this.calculator = calculator;
    }

    @GetMapping
    public ResponseEntity<?> calculatePrintSize(
            @RequestParam(required = false) String preset,
            @RequestParam(defaultValue = "portrait") String orientation,
            @RequestParam(defaultValue = "300") int dpi,
            @RequestParam(required = false) Double widthCm,
            @RequestParam(required = false) Double heightCm) {

        try {
            Dimension dimensions;

            boolean hasWidth = widthCm != null;
            boolean hasHeight = heightCm != null;

            if (hasWidth != hasHeight) {
                throw new IllegalArgumentException(
                        "Both widthCm and heightCm are required for custom size");
            }

            if (hasWidth) {
                if (preset != null && !preset.isBlank()) {
                    throw new IllegalArgumentException(
                            "Use either a preset or custom dimensions, not both");
                }

                dimensions = calculator.calculateCustom(
                        widthCm, heightCm, dpi);

            } else {
                if (preset == null || preset.isBlank()) {
                    throw new IllegalArgumentException(
                            "Provide a preset or custom dimensions");
                }

                dimensions = calculator.calculatePreset(
                        preset, orientation, dpi);
            }

            return ResponseEntity.ok(Map.of(
                    "preset", preset == null ? "CUSTOM" : preset.toUpperCase(),
                    "orientation", hasWidth ? "custom" : orientation.toLowerCase(),
                    "dpi", dpi,
                    "widthPx", dimensions.width,
                    "heightPx", dimensions.height
            ));

        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", e.getMessage()
            ));
        }
    }
}
