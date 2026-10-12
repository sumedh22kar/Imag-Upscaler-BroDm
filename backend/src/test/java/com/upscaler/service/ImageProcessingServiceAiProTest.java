package com.upscaler.service;

import com.upscaler.dto.UpscaleSettingsRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;

import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class ImageProcessingServiceAiProTest {

    private RealEsrganService realEsrganService;
    private ImageProcessingService imageProcessingService;

    @BeforeEach
    void setUp() {
        realEsrganService = mock(RealEsrganService.class);
        imageProcessingService = new ImageProcessingService(realEsrganService);
        ReflectionTestUtils.setField(imageProcessingService, "maxWidthLimit", 8192);
        ReflectionTestUtils.setField(imageProcessingService, "maxHeightLimit", 8192);
        ReflectionTestUtils.setField(imageProcessingService, "minWidthLimit", 1);
        ReflectionTestUtils.setField(imageProcessingService, "minHeightLimit", 1);
    }

    private byte[] createPng(int width, int height) throws Exception {
        BufferedImage image = new BufferedImage(
                width, height, BufferedImage.TYPE_INT_RGB
        );

        Graphics2D graphics = image.createGraphics();
        graphics.setColor(Color.ORANGE);
        graphics.fillRect(0, 0, width, height);
        graphics.dispose();

        ByteArrayOutputStream output = new ByteArrayOutputStream();
        ImageIO.write(image, "png", output);
        image.flush();

        return output.toByteArray();
    }

    @Test
    void aiProResizesNativeFourXOutputToRequestedDimensions() throws Exception {
        byte[] inputBytes = createPng(10, 10);
        byte[] aiOutputBytes = createPng(40, 40);

        when(realEsrganService.upscale(any(), anyInt(), anyInt()))
                .thenReturn(aiOutputBytes);

        MockMultipartFile input = new MockMultipartFile(
                "file",
                "input.png",
                "image/png",
                inputBytes
        );

        UpscaleSettingsRequest settings = new UpscaleSettingsRequest();
        settings.setModel("ai_pro");
        settings.setTargetWidth(30);
        settings.setTargetHeight(20);
        settings.setMaintainAspectRatio(false);
        settings.setOutputFormat("PNG");
        settings.setDpi(300);

        ImageProcessingService.ProcessedImageResult result =
                imageProcessingService.processImage(input, settings);

        assertNotNull(result);
        assertEquals("image/png", result.mimeType());
        assertEquals(30, result.response().getTargetWidth());
        assertEquals(20, result.response().getTargetHeight());
        assertEquals("PNG", result.response().getOutputFormat());
        assertEquals("ai_pro", result.response().getModel());

        BufferedImage decoded = ImageIO.read(
                new ByteArrayInputStream(result.imageBytes())
        );

        assertNotNull(decoded);
        assertEquals(30, decoded.getWidth());
        assertEquals(20, decoded.getHeight());

        decoded.flush();

        verify(realEsrganService, times(1))
                .upscale(any(), eq(10), eq(10));
    }
}
