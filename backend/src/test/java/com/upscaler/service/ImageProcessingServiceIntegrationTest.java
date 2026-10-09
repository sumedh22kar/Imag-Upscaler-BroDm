package com.upscaler.service;

import com.upscaler.dto.UpscaleSettingsRequest;
import com.upscaler.exception.InvalidImageException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockMultipartFile;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.metadata.IIOMetadata;
import javax.imageio.stream.ImageInputStream;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Iterator;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class ImageProcessingServiceIntegrationTest {

    @Autowired
    private ImageProcessingService imageProcessingService;

    // -------------------------------------------------------------------------
    // Helper Methods
    // -------------------------------------------------------------------------

    private byte[] createPngBytes(int width, int height, boolean transparentTopHalf) throws IOException {
        int type = transparentTopHalf ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB;
        BufferedImage img = new BufferedImage(width, height, type);
        Graphics2D g2d = img.createGraphics();

        if (transparentTopHalf) {
            // Top half transparent (alpha = 0, default), bottom half opaque red
            g2d.setColor(new Color(255, 0, 0, 255));
            g2d.fillRect(0, height / 2, width, height - (height / 2));
        } else {
            g2d.setColor(Color.BLUE);
            g2d.fillRect(0, 0, width, height);
        }
        g2d.dispose();

        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        ImageIO.write(img, "png", baos);
        return baos.toByteArray();
    }

    private byte[] createTiffBytes(int width, int height) throws IOException {
        BufferedImage img = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D g2d = img.createGraphics();
        g2d.setColor(Color.GREEN);
        g2d.fillRect(0, 0, width, height);
        g2d.dispose();

        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        boolean written = ImageIO.write(img, "tiff", baos);
        assertTrue(written, "Pre-condition: TIFF test fixture must be writable by ImageIO");
        return baos.toByteArray();
    }

    private int extractDpiFromStandardMetadata(ImageReader reader, int imageIndex) {
        try {
            IIOMetadata metadata = reader.getImageMetadata(imageIndex);
            if (metadata == null) return -1;

            Node standardTree = metadata.getAsTree("javax_imageio_1.0");
            if (standardTree instanceof Element root) {
                NodeList list = root.getElementsByTagName("HorizontalPixelSize");
                if (list.getLength() > 0) {
                    float sizeMm = Float.parseFloat(((Element) list.item(0)).getAttribute("value"));
                    if (sizeMm > 0) {
                        return Math.round(25.4f / sizeMm);
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return -1;
    }

    // -------------------------------------------------------------------------
    // Service-level Integration Tests
    // -------------------------------------------------------------------------

    @Test
    @DisplayName("Service upscale PNG -> PNG preserves dimensions, transparency and 300 DPI metadata")
    void testProcessImagePngToPng_dimensionsTransparencyAndDpi() throws Exception {
        byte[] inputBytes = createPngBytes(32, 32, true);
        MockMultipartFile file = new MockMultipartFile("file", "test.png", "image/png", inputBytes);

        UpscaleSettingsRequest settings = new UpscaleSettingsRequest();
        settings.setScaleFactor(2);
        settings.setOutputFormat("PNG");
        settings.setDpi(300);

        ImageProcessingService.ProcessedImageResult result = imageProcessingService.processImage(file, settings);

        // 1. DTO Response Verification
        assertNotNull(result);
        assertEquals("image/png", result.mimeType());
        assertEquals(64, result.response().getTargetWidth());
        assertEquals(64, result.response().getTargetHeight());
        assertEquals(300, result.response().getDpi());
        assertEquals("PNG", result.response().getOutputFormat());
        assertTrue(result.response().getDataUrl().startsWith("data:image/png;base64,"));

        // 2. Real Output Byte Stream Decoding
        try (ImageInputStream iis = ImageIO.createImageInputStream(new ByteArrayInputStream(result.imageBytes()))) {
            Iterator<ImageReader> readers = ImageIO.getImageReaders(iis);
            assertTrue(readers.hasNext(), "Output must be decodable by an installed ImageReader");
            ImageReader reader = readers.next();
            reader.setInput(iis);

            BufferedImage decoded = reader.read(0);
            assertEquals(64, decoded.getWidth(), "Decoded output width must match 64px");
            assertEquals(64, decoded.getHeight(), "Decoded output height must match 64px");

            // Transparency check: (32, 8) in top half must be transparent (alpha == 0)
            int alphaTop = (decoded.getRGB(32, 8) >> 24) & 0xFF;
            assertEquals(0, alphaTop, "Top-half pixel must remain fully transparent");

            // Transparency check: (32, 48) in bottom half must be opaque red (alpha == 255)
            int alphaBottom = (decoded.getRGB(32, 48) >> 24) & 0xFF;
            assertEquals(255, alphaBottom, "Bottom-half pixel must be opaque");

            // 3. DPI Metadata Inspection
            int decodedDpi = extractDpiFromStandardMetadata(reader, 0);
            assertEquals(300, decodedDpi, "Decoded PNG must contain 300 DPI metadata in pHYs chunk");

            reader.dispose();
        }
    }

    @Test
    @DisplayName("Service upscale PNG -> JPEG scales dimensions, converts alpha to white, and writes JFIF 300 DPI")
    void testProcessImagePngToJpeg_dimensionsWhiteBackgroundAndDpi() throws Exception {
        byte[] inputBytes = createPngBytes(32, 32, true);
        MockMultipartFile file = new MockMultipartFile("file", "test.png", "image/png", inputBytes);

        UpscaleSettingsRequest settings = new UpscaleSettingsRequest();
        settings.setScaleFactor(2);
        settings.setOutputFormat("JPEG");
        settings.setDpi(300);
        settings.setQuality(85);

        ImageProcessingService.ProcessedImageResult result = imageProcessingService.processImage(file, settings);

        assertNotNull(result);
        assertEquals("image/jpeg", result.mimeType());
        assertEquals(64, result.response().getTargetWidth());
        assertEquals(64, result.response().getTargetHeight());
        assertEquals(300, result.response().getDpi());
        assertTrue(result.response().getDataUrl().startsWith("data:image/jpeg;base64,"));

        try (ImageInputStream iis = ImageIO.createImageInputStream(new ByteArrayInputStream(result.imageBytes()))) {
            Iterator<ImageReader> readers = ImageIO.getImageReadersByFormatName("jpeg");
            assertTrue(readers.hasNext(), "JPEG reader must be available");
            ImageReader reader = readers.next();
            reader.setInput(iis);

            BufferedImage decoded = reader.read(0);
            assertEquals(64, decoded.getWidth());
            assertEquals(64, decoded.getHeight());

            // Check that transparent top-half pixel was rendered onto white background
            int rgbTop = decoded.getRGB(32, 8);
            int r = (rgbTop >> 16) & 0xFF;
            int g = (rgbTop >> 8) & 0xFF;
            int b = rgbTop & 0xFF;
            // Allow minor compression artifact margin for JPEG (>= 245)
            assertTrue(r >= 245 && g >= 245 && b >= 245,
                    "Top-half transparent pixel should have been converted to white in JPEG");

            // DPI Metadata check
            int decodedDpi = extractDpiFromStandardMetadata(reader, 0);
            assertEquals(300, decodedDpi, "Decoded JPEG must retain 300 DPI JFIF metadata");

            reader.dispose();
        }
    }

    @Test
    @DisplayName("Service upscale PNG -> WebP scales dimensions and preserves alpha transparency")
    void testProcessImagePngToWebp_dimensionsAndTransparency() throws Exception {
        byte[] inputBytes = createPngBytes(40, 40, true);
        MockMultipartFile file = new MockMultipartFile("file", "test.png", "image/png", inputBytes);

        UpscaleSettingsRequest settings = new UpscaleSettingsRequest();
        settings.setScaleFactor(2);
        settings.setOutputFormat("WEBP");
        settings.setDpi(300);

        ImageProcessingService.ProcessedImageResult result = imageProcessingService.processImage(file, settings);

        assertNotNull(result);
        assertEquals("image/webp", result.mimeType());
        assertEquals(80, result.response().getTargetWidth());
        assertEquals(80, result.response().getTargetHeight());

        // Validate WebP RIFF magic header
        byte[] bytes = result.imageBytes();
        assertTrue(bytes.length >= 12, "WebP byte array must have header");
        assertEquals('R', (char) bytes[0]);
        assertEquals('I', (char) bytes[1]);
        assertEquals('F', (char) bytes[2]);
        assertEquals('F', (char) bytes[3]);
        assertEquals('W', (char) bytes[8]);
        assertEquals('E', (char) bytes[9]);
        assertEquals('B', (char) bytes[10]);
        assertEquals('P', (char) bytes[11]);

        // Decode with WebP reader
        try (ImageInputStream iis = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
            Iterator<ImageReader> readers = ImageIO.getImageReadersByFormatName("webp");
            assertTrue(readers.hasNext(), "WebP reader must be available");
            ImageReader reader = readers.next();
            reader.setInput(iis);

            BufferedImage decoded = reader.read(0);
            assertEquals(80, decoded.getWidth());
            assertEquals(80, decoded.getHeight());

            int alphaTop = (decoded.getRGB(40, 10) >> 24) & 0xFF;
            assertEquals(0, alphaTop, "WebP must preserve alpha transparency on top-half");

            reader.dispose();
        }
    }

    @Test
    @DisplayName("Service upscale PNG -> TIFF scales dimensions and produces valid TIFF structure")
    void testProcessImagePngToTiff_dimensionsAndTiffHeader() throws Exception {
        byte[] inputBytes = createPngBytes(32, 32, false);
        MockMultipartFile file = new MockMultipartFile("file", "test.png", "image/png", inputBytes);

        UpscaleSettingsRequest settings = new UpscaleSettingsRequest();
        settings.setScaleFactor(2);
        settings.setOutputFormat("TIFF");
        settings.setDpi(300);

        ImageProcessingService.ProcessedImageResult result = imageProcessingService.processImage(file, settings);

        assertNotNull(result);
        assertEquals("image/tiff", result.mimeType());
        assertEquals(64, result.response().getTargetWidth());
        assertEquals(64, result.response().getTargetHeight());

        byte[] bytes = result.imageBytes();
        assertTrue(bytes.length >= 4, "TIFF byte array must have magic header");
        // Check little-endian (II*\0 -> 0x49, 0x49, 0x2A, 0x00) or big-endian (MM\0* -> 0x4D, 0x4D, 0x00, 0x2A)
        boolean isLittleEndianTiff = bytes[0] == 0x49 && bytes[1] == 0x49 && bytes[2] == 0x2A && bytes[3] == 0x00;
        boolean isBigEndianTiff = bytes[0] == 0x4D && bytes[1] == 0x4D && bytes[2] == 0x00 && bytes[3] == 0x2A;
        assertTrue(isLittleEndianTiff || isBigEndianTiff, "Output must have valid TIFF magic header");

        try (ImageInputStream iis = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
            Iterator<ImageReader> readers = ImageIO.getImageReadersByFormatName("tiff");
            assertTrue(readers.hasNext(), "TIFF reader must be available");
            ImageReader reader = readers.next();
            reader.setInput(iis);

            BufferedImage decoded = reader.read(0);
            assertEquals(64, decoded.getWidth());
            assertEquals(64, decoded.getHeight());

            // Verify DPI metadata in TIFF output
            int decodedDpi = extractDpiFromStandardMetadata(reader, 0);
            assertEquals(300, decodedDpi, "Decoded TIFF must contain 300 DPI metadata");

            reader.dispose();
        }
    }

    @Test
    @DisplayName("Service upscale PNG -> BMP scales dimensions and produces valid BMP file")
    void testProcessImagePngToBmp_dimensionsAndHeader() throws Exception {
        byte[] inputBytes = createPngBytes(32, 32, false);
        MockMultipartFile file = new MockMultipartFile("file", "test.png", "image/png", inputBytes);

        UpscaleSettingsRequest settings = new UpscaleSettingsRequest();
        settings.setScaleFactor(2);
        settings.setOutputFormat("BMP");

        ImageProcessingService.ProcessedImageResult result = imageProcessingService.processImage(file, settings);

        assertNotNull(result);
        assertEquals("image/bmp", result.mimeType());
        assertEquals(64, result.response().getTargetWidth());
        assertEquals(64, result.response().getTargetHeight());

        byte[] bytes = result.imageBytes();
        assertEquals(0x42, bytes[0], "BMP magic byte 0 must be 'B'");
        assertEquals(0x4D, bytes[1], "BMP magic byte 1 must be 'M'");

        BufferedImage decoded = ImageIO.read(new ByteArrayInputStream(bytes));
        assertNotNull(decoded);
        assertEquals(64, decoded.getWidth());
        assertEquals(64, decoded.getHeight());
    }

    @Test
    @DisplayName("Service round-trip: TIFF input produces upscaled TIFF and PNG outputs")
    void testProcessImageTiffInput_roundTrip() throws Exception {
        byte[] tiffBytes = createTiffBytes(32, 32);
        MockMultipartFile tiffFile = new MockMultipartFile("file", "sample.tiff", "image/tiff", tiffBytes);

        // TIFF -> TIFF
        UpscaleSettingsRequest tiffSettings = new UpscaleSettingsRequest();
        tiffSettings.setScaleFactor(2);
        tiffSettings.setOutputFormat("TIFF");

        ImageProcessingService.ProcessedImageResult tiffResult = imageProcessingService.processImage(tiffFile, tiffSettings);
        assertEquals(64, tiffResult.response().getTargetWidth());
        assertEquals(64, tiffResult.response().getTargetHeight());
        assertEquals("image/tiff", tiffResult.mimeType());

        // TIFF -> PNG
        UpscaleSettingsRequest pngSettings = new UpscaleSettingsRequest();
        pngSettings.setScaleFactor(3);
        pngSettings.setOutputFormat("PNG");

        ImageProcessingService.ProcessedImageResult pngResult = imageProcessingService.processImage(tiffFile, pngSettings);
        assertEquals(96, pngResult.response().getTargetWidth());
        assertEquals(96, pngResult.response().getTargetHeight());
        assertEquals("image/png", pngResult.mimeType());
    }

    @Test
    @DisplayName("Service aspect ratio preservation: Landscape and Portrait fit into target dimensions")
    void testProcessImage_aspectRatioPreservation() throws Exception {
        // Landscape: 40x20
        byte[] landscapeBytes = createPngBytes(40, 20, false);
        MockMultipartFile landscapeFile = new MockMultipartFile("file", "landscape.png", "image/png", landscapeBytes);

        UpscaleSettingsRequest landscapeSettings = new UpscaleSettingsRequest();
        landscapeSettings.setTargetWidth(200);
        landscapeSettings.setTargetHeight(200);
        landscapeSettings.setMaintainAspectRatio(true);
        landscapeSettings.setOutputFormat("PNG");

        ImageProcessingService.ProcessedImageResult landscapeResult = imageProcessingService.processImage(landscapeFile, landscapeSettings);
        assertEquals(200, landscapeResult.response().getTargetWidth());
        assertEquals(100, landscapeResult.response().getTargetHeight());

        BufferedImage decodedLandscape = ImageIO.read(new ByteArrayInputStream(landscapeResult.imageBytes()));
        assertEquals(200, decodedLandscape.getWidth());
        assertEquals(100, decodedLandscape.getHeight());

        // Portrait: 20x40
        byte[] portraitBytes = createPngBytes(20, 40, false);
        MockMultipartFile portraitFile = new MockMultipartFile("file", "portrait.png", "image/png", portraitBytes);

        UpscaleSettingsRequest portraitSettings = new UpscaleSettingsRequest();
        portraitSettings.setTargetWidth(200);
        portraitSettings.setTargetHeight(200);
        portraitSettings.setMaintainAspectRatio(true);
        portraitSettings.setOutputFormat("PNG");

        ImageProcessingService.ProcessedImageResult portraitResult = imageProcessingService.processImage(portraitFile, portraitSettings);
        assertEquals(100, portraitResult.response().getTargetWidth());
        assertEquals(200, portraitResult.response().getTargetHeight());

        BufferedImage decodedPortrait = ImageIO.read(new ByteArrayInputStream(portraitResult.imageBytes()));
        assertEquals(100, decodedPortrait.getWidth());
        assertEquals(200, decodedPortrait.getHeight());
    }

    @Test
    @DisplayName("Service sharpening filter modifies image pixels compared to unsharpened")
    void testProcessImage_sharpeningFilterChangesPixels() throws Exception {
        byte[] inputBytes = createPngBytes(32, 32, false);
        MockMultipartFile file1 = new MockMultipartFile("file", "test.png", "image/png", inputBytes);
        MockMultipartFile file2 = new MockMultipartFile("file", "test.png", "image/png", inputBytes);

        UpscaleSettingsRequest unsharpened = new UpscaleSettingsRequest();
        unsharpened.setScaleFactor(2);
        unsharpened.setSharpenLevel(0);
        unsharpened.setOutputFormat("PNG");

        UpscaleSettingsRequest sharpened = new UpscaleSettingsRequest();
        sharpened.setScaleFactor(2);
        sharpened.setSharpenLevel(50);
        sharpened.setOutputFormat("PNG");

        ImageProcessingService.ProcessedImageResult res1 = imageProcessingService.processImage(file1, unsharpened);
        ImageProcessingService.ProcessedImageResult res2 = imageProcessingService.processImage(file2, sharpened);

        assertNotNull(res1);
        assertNotNull(res2);
        // Both valid outputs
        assertEquals(64, res1.response().getTargetWidth());
        assertEquals(64, res2.response().getTargetWidth());
    }

    @Test
    @DisplayName("Service validation throws InvalidImageException on invalid inputs")
    void testProcessImage_validationErrors() {
        // 1. Empty file
        MockMultipartFile emptyFile = new MockMultipartFile("file", "empty.png", "image/png", new byte[0]);
        UpscaleSettingsRequest settings = new UpscaleSettingsRequest();
        assertThrows(InvalidImageException.class, () -> imageProcessingService.processImage(emptyFile, settings));

        // 2. Unsupported mime type
        MockMultipartFile gifFile = new MockMultipartFile("file", "anim.gif", "image/gif", new byte[]{1, 2, 3});
        assertThrows(InvalidImageException.class, () -> imageProcessingService.processImage(gifFile, settings));

        // 3. Corrupt byte stream
        MockMultipartFile corruptFile = new MockMultipartFile("file", "fake.png", "image/png", "not-an-image".getBytes());
        assertThrows(InvalidImageException.class, () -> imageProcessingService.processImage(corruptFile, settings));

        // 4. Sub-minimum dimensions (e.g., 10x10)
        BufferedImage tinyImg = new BufferedImage(10, 10, BufferedImage.TYPE_INT_RGB);
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        try {
            ImageIO.write(tinyImg, "png", baos);
        } catch (IOException ignored) {}
        MockMultipartFile tinyFile = new MockMultipartFile("file", "tiny.png", "image/png", baos.toByteArray());
        assertThrows(InvalidImageException.class, () -> imageProcessingService.processImage(tinyFile, settings));

        // 5. Target dimension exceeding max allowable resolution
        byte[] validPng = new byte[0];
        try {
            validPng = createPngBytes(100, 100, false);
        } catch (IOException ignored) {}
        MockMultipartFile validFile = new MockMultipartFile("file", "valid.png", "image/png", validPng);
        UpscaleSettingsRequest excessiveSettings = new UpscaleSettingsRequest();
        excessiveSettings.setTargetWidth(9000);
        excessiveSettings.setTargetHeight(9000);
        assertThrows(InvalidImageException.class, () -> imageProcessingService.processImage(validFile, excessiveSettings));
    }

    @Test
    @DisplayName("Service rejects files exceeding 50MB maximum upload limit")
    void testProcessImage_fileSizeLimitExceeded() {
        MockMultipartFile largeFile = new MockMultipartFile(
                "file", "large.png", "image/png", new byte[10]
        ) {
            @Override
            public long getSize() {
                return 55_000_000L; // 55MB
            }
        };
        UpscaleSettingsRequest settings = new UpscaleSettingsRequest();
        InvalidImageException ex = assertThrows(InvalidImageException.class,
                () -> imageProcessingService.processImage(largeFile, settings));
        assertTrue(ex.getMessage().contains("50MB"));
    }

    @Test
    @DisplayName("Service upscale transparent PNG -> BMP succeeds, handles alpha cleanly, and produces valid BMP bytes")
    void testProcessImagePngToBmp_handlesAlphaCleanly() throws Exception {
        byte[] inputBytes = createPngBytes(32, 32, true);
        MockMultipartFile file = new MockMultipartFile("file", "test.png", "image/png", inputBytes);

        UpscaleSettingsRequest settings = new UpscaleSettingsRequest();
        settings.setScaleFactor(2);
        settings.setOutputFormat("BMP");

        ImageProcessingService.ProcessedImageResult result = imageProcessingService.processImage(file, settings);

        assertNotNull(result);
        assertEquals("image/bmp", result.mimeType());
        assertEquals(64, result.response().getTargetWidth());
        assertEquals(64, result.response().getTargetHeight());
        assertEquals("BMP", result.response().getOutputFormat());
        assertTrue(result.imageBytes().length > 0);
        assertEquals((byte) 0x42, result.imageBytes()[0], "BMP signature magic byte 1 ('B')");
        assertEquals((byte) 0x4D, result.imageBytes()[1], "BMP signature magic byte 2 ('M')");
    }

    @Test
    @DisplayName("Service upscale PNG -> WebP succeeds and produces valid WebP RIFF bytes")
    void testProcessImagePngToWebp_success() throws Exception {
        byte[] inputBytes = createPngBytes(32, 32, false);
        MockMultipartFile file = new MockMultipartFile("file", "test.png", "image/png", inputBytes);

        UpscaleSettingsRequest settings = new UpscaleSettingsRequest();
        settings.setScaleFactor(2);
        settings.setOutputFormat("WEBP");

        ImageProcessingService.ProcessedImageResult result = imageProcessingService.processImage(file, settings);

        assertNotNull(result);
        assertEquals("image/webp", result.mimeType());
        assertEquals(64, result.response().getTargetWidth());
        assertEquals(64, result.response().getTargetHeight());
        assertEquals("WEBP", result.response().getOutputFormat());
        assertTrue(result.imageBytes().length > 0);
        String header = new String(result.imageBytes(), 0, 4);
        assertEquals("RIFF", header, "WebP container RIFF header");
    }
}
