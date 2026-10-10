package com.upscaler.service;

import java.awt.image.BufferedImage;

public final class LanczosResampler {

    private static final int RADIUS = 3;

    private LanczosResampler() {
    }

    public static BufferedImage resize(
            BufferedImage source,
            int targetWidth,
            int targetHeight) {

        if (source == null) {
            throw new IllegalArgumentException("Source image is required");
        }

        if (targetWidth < 1 || targetHeight < 1) {
            throw new IllegalArgumentException(
                    "Target dimensions must be positive");
        }

        int sourceWidth = source.getWidth();
        int sourceHeight = source.getHeight();

        if (sourceWidth == targetWidth && sourceHeight == targetHeight) {
            return source;
        }

        boolean hasAlpha = source.getColorModel().hasAlpha();

        double scaleX = (double) targetWidth / sourceWidth;
        double scaleY = (double) targetHeight / sourceHeight;
        double filterScaleX = Math.max(1.0, 1.0 / scaleX);
        double filterScaleY = Math.max(1.0, 1.0 / scaleY);

        Sampling[] horizontal = createSampling(
                sourceWidth, targetWidth, scaleX, filterScaleX);
        Sampling[] vertical = createSampling(
                sourceHeight, targetHeight, scaleY, filterScaleY);

        BufferedImage output = new BufferedImage(
                targetWidth,
                targetHeight,
                hasAlpha
                        ? BufferedImage.TYPE_INT_ARGB
                        : BufferedImage.TYPE_INT_RGB);

        int[] sourcePixels = new int[sourceWidth * sourceHeight];
        source.getRGB(
                0, 0, sourceWidth, sourceHeight,
                sourcePixels, 0, sourceWidth);

        int[] outputRow = new int[targetWidth];

        for (int y = 0; y < targetHeight; y++) {
            Sampling ys = vertical[y];

            for (int x = 0; x < targetWidth; x++) {
                Sampling xs = horizontal[x];

                double alpha = 0;
                double red = 0;
                double green = 0;
                double blue = 0;
                double totalWeight = 0;

                for (int yi = 0; yi < ys.indices.length; yi++) {
                    int sy = ys.indices[yi];
                    double wy = ys.weights[yi];
                    int rowOffset = sy * sourceWidth;

                    for (int xi = 0; xi < xs.indices.length; xi++) {
                        int sx = xs.indices[xi];
                        double weight = xs.weights[xi] * wy;
                        int pixel = sourcePixels[rowOffset + sx];

                        double a = ((pixel >>> 24) & 0xff) / 255.0;

                        alpha += a * weight;
                        red += ((pixel >>> 16) & 0xff) * a * weight;
                        green += ((pixel >>> 8) & 0xff) * a * weight;
                        blue += (pixel & 0xff) * a * weight;
                        totalWeight += weight;
                    }
                }

                if (Math.abs(totalWeight) < 1e-12) {
                    int sx = xs.indices[xs.indices.length / 2];
                    int sy = ys.indices[ys.indices.length / 2];
                    outputRow[x] = sourcePixels[sy * sourceWidth + sx];
                    continue;
                }

                alpha /= totalWeight;
                red /= totalWeight;
                green /= totalWeight;
                blue /= totalWeight;

                int a = clamp((int) Math.round(alpha * 255.0));

                if (alpha > 1e-8) {
                    red /= alpha;
                    green /= alpha;
                    blue /= alpha;
                } else {
                    red = green = blue = 0;
                }

                outputRow[x] = (a << 24)
                        | (clamp((int) Math.round(red)) << 16)
                        | (clamp((int) Math.round(green)) << 8)
                        | clamp((int) Math.round(blue));
            }

            output.setRGB(0, y, targetWidth, 1,
                    outputRow, 0, targetWidth);
        }

        return output;
    }

    private static Sampling[] createSampling(
            int sourceSize,
            int targetSize,
            double scale,
            double filterScale) {

        Sampling[] result = new Sampling[targetSize];

        for (int i = 0; i < targetSize; i++) {
            double sourcePosition = (i + 0.5) / scale - 0.5;

            int first = Math.max(
                    0,
                    (int) Math.floor(
                            sourcePosition - RADIUS * filterScale));
            int last = Math.min(
                    sourceSize - 1,
                    (int) Math.ceil(
                            sourcePosition + RADIUS * filterScale));

            int count = last - first + 1;
            int[] indices = new int[count];
            double[] weights = new double[count];

            for (int j = 0; j < count; j++) {
                int index = first + j;
                indices[j] = index;
                weights[j] = lanczos(
                        (sourcePosition - index) / filterScale);
            }

            result[i] = new Sampling(indices, weights);
        }

        return result;
    }

    private static double lanczos(double value) {
        value = Math.abs(value);

        if (value < 1e-12) {
            return 1.0;
        }

        if (value >= RADIUS) {
            return 0.0;
        }

        double piValue = Math.PI * value;
        return (Math.sin(piValue) / piValue)
                * (Math.sin(piValue / RADIUS)
                / (piValue / RADIUS));
    }

    private static int clamp(int value) {
        return Math.max(0, Math.min(255, value));
    }

    private static final class Sampling {
        private final int[] indices;
        private final double[] weights;

        private Sampling(int[] indices, double[] weights) {
            this.indices = indices;
            this.weights = weights;
        }
    }
}
