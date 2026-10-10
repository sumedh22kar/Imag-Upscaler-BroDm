package com.upscaler;

import com.upscaler.exception.ConcurrentProcessingLimitExceededException;
import com.upscaler.service.ImageProcessingService;
import org.junit.jupiter.api.DisplayName;
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
import java.io.IOException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class ImageSafetyAndConcurrencyRegressionTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ImageProcessingService imageProcessingService;

    private byte[] createSmallPng(int width, int height) throws IOException {
        BufferedImage img = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = img.createGraphics();
        g.setColor(Color.MAGENTA);
        g.fillRect(0, 0, width, height);
        g.dispose();
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        ImageIO.write(img, "png", baos);
        return baos.toByteArray();
    }

    @Test
    @DisplayName("Safety: Corrupted or truncated image fails safely with 400 Bad Request")
    void testCorruptedImageReturnsBadRequest() throws Exception {
        byte[] corruptedBytes = new byte[]{(byte) 0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0x00, 0x00, 0x00};
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "corrupted.png",
                "image/png",
                corruptedBytes
        );

        mockMvc.perform(multipart("/api/images/upscale")
                        .file(file)
                        .param("scaleFactor", "2")
                        .param("outputFormat", "PNG"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.message").exists());
    }

    @Test
    @DisplayName("Safety: Missing required 'file' part returns 400 Bad Request instead of 500")
    void testMissingFilePartReturnsBadRequest() throws Exception {
        mockMvc.perform(multipart("/api/images/upscale")
                        .param("scaleFactor", "2"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.message").value("Required request part 'file' is missing"));
    }

    @Test
    @DisplayName("Security: Download filename sanitizes directory traversal and leading dots")
    void testDownloadSanitizesPathTraversalInFilename() throws Exception {
        byte[] validPng = createSmallPng(32, 32);
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "../../../../etc/passwd.png",
                "image/png",
                validPng
        );

        mockMvc.perform(multipart("/api/images/download")
                        .file(file)
                        .param("scaleFactor", "2")
                        .param("outputFormat", "PNG"))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Disposition", "attachment; filename=\"upscaled_passwd.png\""))
                .andExpect(header().string("Content-Type", "image/png"));
    }

    @Test
    @DisplayName("Security: Download filename with only dots falls back to safe default name")
    void testDownloadSanitizesAllDotsFilename() throws Exception {
        byte[] validPng = createSmallPng(32, 32);
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "....png",
                "image/png",
                validPng
        );

        mockMvc.perform(multipart("/api/images/download")
                        .file(file)
                        .param("scaleFactor", "2")
                        .param("outputFormat", "JPEG"))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Disposition", "attachment; filename=\"upscaled_image.jpg\""))
                .andExpect(header().string("Content-Type", "image/jpeg"));
    }

    @Test
    @DisplayName("Reliability: Concurrency semaphore rejects requests exceeding capacity with 429 and Retry-After header")
    void testConcurrencyCapacityExceededReturns429() throws Exception {
        int originalCapacity = imageProcessingService.getMaxConcurrentJobs();
        try {
            // Temporarily set concurrency limit to 1 and timeout to 0 for strict rejection testing
            imageProcessingService.setMaxConcurrentJobs(1);
            imageProcessingService.setAcquireTimeoutSeconds(0);

            // Acquire the single permit manually
            boolean acquired = imageProcessingService.getSemaphore().tryAcquire();
            assertEquals(true, acquired, "Should acquire test permit");

            try {
                byte[] validPng = createSmallPng(32, 32);
                MockMultipartFile file = new MockMultipartFile(
                        "file",
                        "concurrent-test.png",
                        "image/png",
                        validPng
                );

                mockMvc.perform(multipart("/api/images/upscale")
                                .file(file)
                                .param("scaleFactor", "2")
                                .param("outputFormat", "PNG"))
                        .andExpect(status().isTooManyRequests())
                        .andExpect(status().is(429))
                        .andExpect(header().string("Retry-After", "5"))
                        .andExpect(jsonPath("$.status").value(429))
                        .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("maximum concurrent image processing capacity")));
            } finally {
                imageProcessingService.getSemaphore().release();
            }
        } finally {
            // Restore default configuration
            imageProcessingService.setMaxConcurrentJobs(originalCapacity);
            imageProcessingService.setAcquireTimeoutSeconds(5);
        }
    }

    @Test
    @DisplayName("Reliability: Controlled parallel requests all succeed within capacity")
    void testControlledParallelRequestsSucceed() throws Exception {
        byte[] validPng = createSmallPng(32, 32);
        int parallelRequests = 3;
        ExecutorService executor = Executors.newFixedThreadPool(parallelRequests);
        CountDownLatch startLatch = new CountDownLatch(1);
        CountDownLatch doneLatch = new CountDownLatch(parallelRequests);
        AtomicInteger successCount = new AtomicInteger(0);

        for (int i = 0; i < parallelRequests; i++) {
            executor.submit(() -> {
                try {
                    startLatch.await();
                    MockMultipartFile file = new MockMultipartFile(
                            "file",
                            "parallel.png",
                            "image/png",
                            validPng
                    );
                    mockMvc.perform(multipart("/api/images/upscale")
                                    .file(file)
                                    .param("scaleFactor", "2")
                                    .param("outputFormat", "PNG"))
                            .andExpect(status().isOk());
                    successCount.incrementAndGet();
                } catch (Exception ignored) {
                } finally {
                    doneLatch.countDown();
                }
            });
        }

        startLatch.countDown();
        boolean completed = doneLatch.await(10, TimeUnit.SECONDS);
        executor.shutdown();

        assertEquals(true, completed, "All parallel requests should finish within timeout");
        assertEquals(parallelRequests, successCount.get(), "All parallel requests within capacity should succeed");
    }

    @Test
    @DisplayName("Validation: Unsupported media type on upscale endpoint returns 415")
    void testUnsupportedMediaTypeReturns415() throws Exception {
        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/api/images/upscale")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.status").value(415));
    }

    @Test
    @DisplayName("Validation: Unsupported HTTP method on upscale endpoint returns 405 Method Not Allowed")
    void testUnsupportedMethodReturns405() throws Exception {
        mockMvc.perform(get("/api/images/upscale"))
                .andExpect(status().isMethodNotAllowed())
                .andExpect(jsonPath("$.status").value(405));
    }

    @Test
    @DisplayName("Boundary: Target dimension calculation exceeding max bounds throws clean validation error")
    void testDimensionBoundaryExceededRejectsSafely() throws Exception {
        byte[] validPng = createSmallPng(32, 32);
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "test.png",
                "image/png",
                validPng
        );

        mockMvc.perform(multipart("/api/images/upscale")
                        .file(file)
                        .param("targetWidth", "9000")
                        .param("targetHeight", "9000"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400));
    }
}
