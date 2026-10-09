package com.upscaler;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;

import javax.imageio.ImageIO;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class ImageControllerTest {

    @Autowired
    private MockMvc mockMvc;

    private byte[] sampleImageBytes;

    @BeforeEach
    void setUp() throws Exception {
        BufferedImage img = new BufferedImage(32, 32, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = img.createGraphics();
        g.setColor(Color.BLUE);
        g.fillRect(0, 0, 32, 32);
        g.dispose();

        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        ImageIO.write(img, "png", baos);
        sampleImageBytes = baos.toByteArray();
    }

    @Test
    void testUpscaleImageSuccess() throws Exception {
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "test.png",
                "image/png",
                sampleImageBytes
        );

        mockMvc.perform(multipart("/api/images/upscale")
                        .file(file)
                        .param("scaleFactor", "2")
                        .param("outputFormat", "PNG")
                        .param("dpi", "300")
                        .param("quality", "95")
                        .param("model", "standard"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.originalWidth").value(32))
                .andExpect(jsonPath("$.originalHeight").value(32))
                .andExpect(jsonPath("$.targetWidth").value(64))
                .andExpect(jsonPath("$.targetHeight").value(64))
                .andExpect(jsonPath("$.outputFormat").value("PNG"))
                .andExpect(jsonPath("$.dpi").value(300))
                .andExpect(jsonPath("$.dataUrl").exists());
    }

    @Test
    void testUpscaleWithExplicitTargetDimensions() throws Exception {
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "test.png",
                "image/png",
                sampleImageBytes
        );

        mockMvc.perform(multipart("/api/images/upscale")
                        .file(file)
                        .param("targetWidth", "128")
                        .param("targetHeight", "128")
                        .param("maintainAspectRatio", "false")
                        .param("outputFormat", "JPEG"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.targetWidth").value(128))
                .andExpect(jsonPath("$.targetHeight").value(128))
                .andExpect(jsonPath("$.outputFormat").value("JPEG"));
    }

    @Test
    void testUpscaleValidationFailsOnInvalidQualityAndScaleFactor() throws Exception {
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "test.png",
                "image/png",
                sampleImageBytes
        );

        mockMvc.perform(multipart("/api/images/upscale")
                        .file(file)
                        .param("scaleFactor", "99") // max is 8
                        .param("quality", "150")) // max is 100
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.validationErrors.scaleFactor").exists())
                .andExpect(jsonPath("$.validationErrors.quality").exists());
    }

    @Test
    void testUpscaleValidationFailsOnInvalidTargetDimension() throws Exception {
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "test.png",
                "image/png",
                sampleImageBytes
        );

        mockMvc.perform(multipart("/api/images/upscale")
                        .file(file)
                        .param("targetWidth", "5")) // min is 16
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.validationErrors.targetWidth").exists());
    }

    @Test
    void testDownloadEndpointSuccess() throws Exception {
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "test.png",
                "image/png",
                sampleImageBytes
        );

        mockMvc.perform(multipart("/api/images/download")
                        .file(file)
                        .param("scaleFactor", "2")
                        .param("outputFormat", "PNG"))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", "image/png"))
                .andExpect(header().exists("Content-Disposition"));
    }

    @Test
    void testValidateSettingsEndpoint() throws Exception {
        String validJson = """
                {
                    "targetWidth": 1024,
                    "targetHeight": 768,
                    "scaleFactor": 4,
                    "outputFormat": "PNG",
                    "quality": 90,
                    "model": "ultra_sharp"
                }
                """;

        mockMvc.perform(post("/api/images/validate-settings")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(validJson))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.valid").value(true));
    }

    @Test
    void testTransparentPngToPngPreservesFormat() throws Exception {
        BufferedImage transparentImg = new BufferedImage(32, 32, BufferedImage.TYPE_INT_ARGB);
        // transparent image (alpha = 0)
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        ImageIO.write(transparentImg, "png", baos);

        MockMultipartFile file = new MockMultipartFile(
                "file",
                "transparent.png",
                "image/png",
                baos.toByteArray()
        );

        mockMvc.perform(multipart("/api/images/upscale")
                        .file(file)
                        .param("scaleFactor", "2")
                        .param("outputFormat", "PNG"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outputFormat").value("PNG"))
                .andExpect(jsonPath("$.targetWidth").value(64))
                .andExpect(jsonPath("$.targetHeight").value(64));
    }

    @Test
    void testTransparentPngToJpegProducesJpeg() throws Exception {
        BufferedImage transparentImg = new BufferedImage(32, 32, BufferedImage.TYPE_INT_ARGB);
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        ImageIO.write(transparentImg, "png", baos);

        MockMultipartFile file = new MockMultipartFile(
                "file",
                "transparent.png",
                "image/png",
                baos.toByteArray()
        );

        mockMvc.perform(multipart("/api/images/upscale")
                        .file(file)
                        .param("scaleFactor", "2")
                        .param("outputFormat", "JPEG"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outputFormat").value("JPEG"));
    }

    @Test
    void testAspectRatioPreservationLandscapeAndPortrait() throws Exception {
        // Landscape image: 40x20 (2:1)
        BufferedImage landscape = new BufferedImage(40, 20, BufferedImage.TYPE_INT_RGB);
        ByteArrayOutputStream baos1 = new ByteArrayOutputStream();
        ImageIO.write(landscape, "png", baos1);

        MockMultipartFile landscapeFile = new MockMultipartFile(
                "file", "landscape.png", "image/png", baos1.toByteArray()
        );

        mockMvc.perform(multipart("/api/images/upscale")
                        .file(landscapeFile)
                        .param("targetWidth", "100")
                        .param("targetHeight", "100")
                        .param("maintainAspectRatio", "true")
                        .param("outputFormat", "PNG"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.targetWidth").value(100))
                .andExpect(jsonPath("$.targetHeight").value(50));

        // Portrait image: 20x40 (1:2)
        BufferedImage portrait = new BufferedImage(20, 40, BufferedImage.TYPE_INT_RGB);
        ByteArrayOutputStream baos2 = new ByteArrayOutputStream();
        ImageIO.write(portrait, "png", baos2);

        MockMultipartFile portraitFile = new MockMultipartFile(
                "file", "portrait.png", "image/png", baos2.toByteArray()
        );

        mockMvc.perform(multipart("/api/images/upscale")
                        .file(portraitFile)
                        .param("targetWidth", "100")
                        .param("targetHeight", "100")
                        .param("maintainAspectRatio", "true")
                        .param("outputFormat", "PNG"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.targetWidth").value(50))
                .andExpect(jsonPath("$.targetHeight").value(100));
    }

    @Test
    void testUnsupportedOutputFormatFails() throws Exception {
        MockMultipartFile file = new MockMultipartFile(
                "file", "test.png", "image/png", sampleImageBytes
        );

        mockMvc.perform(multipart("/api/images/upscale")
                        .file(file)
                        .param("outputFormat", "GIF"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400));
    }

    @Test
    void testUpscaleToTiffSuccess() throws Exception {
        MockMultipartFile file = new MockMultipartFile(
                "file", "test.png", "image/png", sampleImageBytes
        );

        mockMvc.perform(multipart("/api/images/upscale")
                        .file(file)
                        .param("scaleFactor", "2")
                        .param("outputFormat", "TIFF"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outputFormat").value("TIFF"))
                .andExpect(jsonPath("$.dataUrl").exists());
    }

    @Test
    void testConfigEndpoint() throws Exception {
        mockMvc.perform(get("/api/images/config"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.supportedFormats").isArray())
                .andExpect(jsonPath("$.supportedModels").isArray())
                .andExpect(jsonPath("$.maxDimension").value(8192));
    }
}
