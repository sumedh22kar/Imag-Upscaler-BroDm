package com.upscaler.service;

import com.upscaler.dto.UpscaleSettingsRequest;
import com.upscaler.exception.InvalidImageException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class ImageProcessingServiceAiProTest {

    private RealEsrganService realEsrganService;
    private ImageProcessingService imageProcessingService;

    @BeforeEach
    void setUp() {
        realEsrganService = mock(RealEsrganService.class);
        imageProcessingService = new ImageProcessingService(realEsrganService);

        ReflectionTestUtils.setField(
                imageProcessingService, "maxWidthLimit", 8192
        );
        ReflectionTestUtils.setField(
                imageProcessingService, "maxHeightLimit", 8192
        );
        ReflectionTestUtils.setField(
                imageProcessingService, "minWidthLimit", 1
        );
        ReflectionTestUtils.setField(
                imageProcessingService, "minHeightLimit", 1
        );
    }

    private byte[] createPng(int width, int height) throws Exception {
        BufferedImage image = new BufferedImage(
                width, height, BufferedImage.TYPE_INT_RGB
        );

        try {
            Graphics2D graphics = image.createGraphics();
            try {
                graphics.setColor(Color.ORANGE);
                graphics.fillRect(0, 0, width, height);
            } finally {
                graphics.dispose();
            }

            ByteArrayOutputStream output = new ByteArrayOutputStream();
            assertTrue(ImageIO.write(image, "png", output));
            return output.toByteArray();
        } finally {
            image.flush();
        }
    }

    private MockMultipartFile createInput(int width, int height)
            throws Exception {
        return new MockMultipartFile(
                "file",
                "input.png",
                "image/png",
                createPng(width, height)
        );
    }

    private UpscaleSettingsRequest defaultAiProSettings() {
        UpscaleSettingsRequest settings = new UpscaleSettingsRequest();
        settings.setModel("ai_pro");
        settings.setOutputFormat("PNG");
        settings.setDpi(300);
        return settings;
    }

    @Test
    void aiProResizesNativeFourXOutputToRequestedDimensions()
            throws Exception {
        byte[] aiOutputBytes = createPng(40, 40);

        when(realEsrganService.upscale(any(), anyInt(), anyInt(), anyInt()))
                .thenReturn(aiOutputBytes);

        MockMultipartFile input = createInput(10, 10);

        UpscaleSettingsRequest settings = defaultAiProSettings();
        settings.setTargetWidth(30);
        settings.setTargetHeight(20);
        settings.setMaintainAspectRatio(false);

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
        try {
            assertEquals(30, decoded.getWidth());
            assertEquals(20, decoded.getHeight());
        } finally {
            decoded.flush();
        }

        verify(realEsrganService).upscale(any(), eq(10), eq(10), eq(4));
    }

    @Test
    void selectsFourXForSmallImages() throws Exception {
        when(realEsrganService.upscale(any(), anyInt(), anyInt(), anyInt()))
                .thenReturn(createPng(400, 200));

        ImageProcessingService.ProcessedImageResult result =
                imageProcessingService.processImage(
                        createInput(100, 50),
                        defaultAiProSettings()
                );

        assertEquals(400, result.response().getTargetWidth());
        assertEquals(200, result.response().getTargetHeight());

        verify(realEsrganService).upscale(any(), eq(100), eq(50), eq(4));
    }

    @Test
    void prescalesAndRunsNativeFourXWhenLongestSideIs2049() throws Exception {
        when(realEsrganService.upscale(any(), anyInt(), anyInt(), anyInt()))
                .thenReturn(createPng(8192, 8));

        ImageProcessingService.ProcessedImageResult result =
                imageProcessingService.processImage(
                        createInput(2049, 2),
                        defaultAiProSettings()
                );

        assertEquals(8192, result.response().getTargetWidth());
        assertEquals(8, result.response().getTargetHeight());

        verify(realEsrganService).upscale(any(), eq(2048), eq(2), eq(4));
    }

    @Test
    void prescalesAndRunsNativeFourXWhenLongestSideIs2731() throws Exception {
        when(realEsrganService.upscale(any(), anyInt(), anyInt(), anyInt()))
                .thenReturn(createPng(8192, 8));

        ImageProcessingService.ProcessedImageResult result =
                imageProcessingService.processImage(
                        createInput(2731, 2),
                        defaultAiProSettings()
                );

        assertEquals(8192, result.response().getTargetWidth());
        assertEquals(8, result.response().getTargetHeight());

        verify(realEsrganService).upscale(any(), eq(2048), eq(1), eq(4));
    }

    @Test
    void supportsInputWithLongestSideOf4096() throws Exception {
        when(realEsrganService.upscale(any(), anyInt(), anyInt(), anyInt()))
                .thenReturn(createPng(8192, 8));

        ImageProcessingService.ProcessedImageResult result =
                imageProcessingService.processImage(
                        createInput(4096, 2),
                        defaultAiProSettings()
                );

        assertEquals(8192, result.response().getTargetWidth());
        assertEquals(8, result.response().getTargetHeight());

        verify(realEsrganService).upscale(any(), eq(2048), eq(1), eq(4));
    }

    @Test
    void rejectsInputWithLongestSideAbove4096() throws Exception {
        MockMultipartFile input = createInput(4097, 1);

        InvalidImageException exception = assertThrows(
                InvalidImageException.class,
                () -> imageProcessingService.processImage(
                        input, defaultAiProSettings()
                )
        );

        assertTrue(exception.getMessage().contains("4096"));

        verifyNoInteractions(realEsrganService);
    }
}
