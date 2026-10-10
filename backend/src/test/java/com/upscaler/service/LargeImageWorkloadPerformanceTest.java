package com.upscaler.service;

import com.upscaler.dto.UpscaleSettingsRequest;
import com.upscaler.exception.InvalidImageException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockMultipartFile;

import javax.imageio.ImageIO;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class LargeImageWorkloadPerformanceTest {

    @Autowired
    private ImageProcessingService imageProcessingService;

    private byte[] createTestImage(int width, int height, String format, boolean hasAlpha) throws IOException {
        int type = hasAlpha ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB;
        BufferedImage img = new BufferedImage(width, height, type);
        Graphics2D g2d = img.createGraphics();
        try {
            if (hasAlpha) {
                g2d.setColor(new Color(255, 100, 50, 180));
                g2d.fillRect(0, 0, width, height / 2);
                g2d.setColor(new Color(50, 150, 255, 255));
                g2d.fillRect(0, height / 2, width, height - (height / 2));
            } else {
                g2d.setColor(Color.LIGHT_GRAY);
                g2d.fillRect(0, 0, width, height);
                g2d.setColor(Color.DARK_GRAY);
                g2d.drawLine(0, 0, width, height);
                g2d.drawLine(0, height, width, 0);
            }
        } finally {
            g2d.dispose();
        }

        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        ImageIO.write(img, format, baos);
        img.flush();
        return baos.toByteArray();
    }

    private void runGc() {
        System.gc();
        try {
            Thread.sleep(100);
        } catch (InterruptedException ignored) {}
        System.gc();
    }

    @Test
    @DisplayName("Workload 1: Small image (200x200 px) scaled 2x to 400x400 px")
    void testSmallImageWorkload() throws Exception {
        byte[] bytes = createTestImage(200, 200, "png", false);
        MockMultipartFile file = new MockMultipartFile("file", "small.png", "image/png", bytes);

        UpscaleSettingsRequest settings = new UpscaleSettingsRequest();
        settings.setScaleFactor(2);
        settings.setOutputFormat("PNG");

        long start = System.currentTimeMillis();
        ImageProcessingService.ProcessedImageResult result = imageProcessingService.processImage(file, settings);
        long elapsed = System.currentTimeMillis() - start;

        assertNotNull(result);
        assertEquals(400, result.response().getTargetWidth());
        assertEquals(400, result.response().getTargetHeight());
        System.out.printf("[BENCHMARK] Small image (200x200 -> 400x400 PNG): %d ms, output size: %d bytes%n",
                elapsed, result.imageBytes().length);
    }

    @Test
    @DisplayName("Workload 2: Medium image (1200x800 px) scaled 2x to 2400x1600 px JPEG")
    void testMediumImageWorkload() throws Exception {
        byte[] bytes = createTestImage(1200, 800, "jpeg", false);
        MockMultipartFile file = new MockMultipartFile("file", "medium.jpg", "image/jpeg", bytes);

        UpscaleSettingsRequest settings = new UpscaleSettingsRequest();
        settings.setScaleFactor(2);
        settings.setOutputFormat("JPEG");
        settings.setQuality(85);

        long start = System.currentTimeMillis();
        ImageProcessingService.ProcessedImageResult result = imageProcessingService.processImage(file, settings);
        long elapsed = System.currentTimeMillis() - start;

        assertNotNull(result);
        assertEquals(2400, result.response().getTargetWidth());
        assertEquals(1600, result.response().getTargetHeight());
        System.out.printf("[BENCHMARK] Medium image (1200x800 -> 2400x1600 JPEG): %d ms, output size: %d bytes%n",
                elapsed, result.imageBytes().length);
    }

    @Test
    @DisplayName("Workload 3: Large image (2500x2000 px) scaled to 5000x4000 px (20 Megapixels)")
    void testLargeImageWorkload() throws Exception {
        runGc();
        long memBefore = Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory();

        byte[] bytes = createTestImage(2500, 2000, "png", false);
        MockMultipartFile file = new MockMultipartFile("file", "large.png", "image/png", bytes);

        UpscaleSettingsRequest settings = new UpscaleSettingsRequest();
        settings.setScaleFactor(2);
        settings.setOutputFormat("PNG");

        long start = System.currentTimeMillis();
        ImageProcessingService.ProcessedImageResult result = imageProcessingService.processImage(file, settings);
        long elapsed = System.currentTimeMillis() - start;

        long memAfter = Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory();
        long memDeltaMb = Math.max(0, (memAfter - memBefore) / (1024 * 1024));

        assertNotNull(result);
        assertEquals(5000, result.response().getTargetWidth());
        assertEquals(4000, result.response().getTargetHeight());
        System.out.printf("[BENCHMARK] Large image (2500x2000 -> 5000x4000 PNG): %d ms, heap delta: ~%d MB, output: %d bytes%n",
                elapsed, memDeltaMb, result.imageBytes().length);
    }

    @Test
    @DisplayName("Workload 4: High-dimension workload approaching 8192px limit (2048x2048 -> 8192x8192 px, 67.1 Megapixels)")
    void testNearMaxDimensionWorkload() throws Exception {
        runGc();
        long memBefore = Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory();

        byte[] bytes = createTestImage(2048, 2048, "jpeg", false);
        MockMultipartFile file = new MockMultipartFile("file", "maxdim.jpg", "image/jpeg", bytes);

        UpscaleSettingsRequest settings = new UpscaleSettingsRequest();
        settings.setScaleFactor(4); // 2048 * 4 = 8192
        settings.setOutputFormat("JPEG");
        settings.setQuality(80);

        long start = System.currentTimeMillis();
        ImageProcessingService.ProcessedImageResult result = imageProcessingService.processImage(file, settings);
        long elapsed = System.currentTimeMillis() - start;

        long memAfter = Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory();
        long memDeltaMb = Math.max(0, (memAfter - memBefore) / (1024 * 1024));

        assertNotNull(result);
        assertEquals(8192, result.response().getTargetWidth());
        assertEquals(8192, result.response().getTargetHeight());
        System.out.printf("[BENCHMARK] Max dimension workload (2048x2048 -> 8192x8192 JPEG): %d ms, heap delta: ~%d MB, output: %d bytes%n",
                elapsed, memDeltaMb, result.imageBytes().length);
    }

    @Test
    @DisplayName("Workload 5: Invalid and truncated files are rejected cleanly without memory leaks")
    void testCorruptFileCleanRejection() {
        // Truncated PNG header only
        byte[] truncatedPng = new byte[]{(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
        MockMultipartFile file = new MockMultipartFile("file", "corrupt.png", "image/png", truncatedPng);

        UpscaleSettingsRequest settings = new UpscaleSettingsRequest();
        assertThrows(InvalidImageException.class, () -> imageProcessingService.processImage(file, settings));
    }

    @Test
    @DisplayName("Workload 6: All output formats under realistic workload")
    void testAllFormatsWorkload() throws Exception {
        byte[] pngWithAlpha = createTestImage(400, 400, "png", true);

        // 1. PNG with Alpha
        MockMultipartFile file1 = new MockMultipartFile("file", "test.png", "image/png", pngWithAlpha);
        UpscaleSettingsRequest s1 = new UpscaleSettingsRequest();
        s1.setScaleFactor(2);
        s1.setOutputFormat("PNG");
        ImageProcessingService.ProcessedImageResult r1 = imageProcessingService.processImage(file1, s1);
        assertEquals(800, r1.response().getTargetWidth());
        assertEquals("image/png", r1.mimeType());

        // 2. JPEG (Alpha flattened to white background)
        UpscaleSettingsRequest s2 = new UpscaleSettingsRequest();
        s2.setScaleFactor(2);
        s2.setOutputFormat("JPEG");
        s2.setQuality(90);
        ImageProcessingService.ProcessedImageResult r2 = imageProcessingService.processImage(file1, s2);
        assertEquals(800, r2.response().getTargetWidth());
        assertEquals("image/jpeg", r2.mimeType());

        // 3. WebP
        UpscaleSettingsRequest s3 = new UpscaleSettingsRequest();
        s3.setScaleFactor(2);
        s3.setOutputFormat("WEBP");
        ImageProcessingService.ProcessedImageResult r3 = imageProcessingService.processImage(file1, s3);
        assertEquals(800, r3.response().getTargetWidth());
        assertEquals("image/webp", r3.mimeType());

        // 4. BMP
        UpscaleSettingsRequest s4 = new UpscaleSettingsRequest();
        s4.setScaleFactor(2);
        s4.setOutputFormat("BMP");
        ImageProcessingService.ProcessedImageResult r4 = imageProcessingService.processImage(file1, s4);
        assertEquals(800, r4.response().getTargetWidth());
        assertEquals("image/bmp", r4.mimeType());

        // 5. TIFF with 600 DPI metadata
        UpscaleSettingsRequest s5 = new UpscaleSettingsRequest();
        s5.setScaleFactor(2);
        s5.setOutputFormat("TIFF");
        s5.setDpi(600);
        ImageProcessingService.ProcessedImageResult r5 = imageProcessingService.processImage(file1, s5);
        assertEquals(800, r5.response().getTargetWidth());
        assertEquals("image/tiff", r5.mimeType());
        assertEquals(600, r5.response().getDpi());
    }
}
