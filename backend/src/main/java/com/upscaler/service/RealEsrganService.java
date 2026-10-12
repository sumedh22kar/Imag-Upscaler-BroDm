package com.upscaler.service;

import com.upscaler.exception.InvalidImageException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Iterator;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Service
public class RealEsrganService {

    private static final Logger log = LoggerFactory.getLogger(RealEsrganService.class);

    @Value("${upscaler.ai.enabled:false}")
    private boolean enabled;

    @Value("${upscaler.ai.executable:}")
    private String executable;

    @Value("${upscaler.ai.model-dir:}")
    private String modelDirectory;

    @Value("${upscaler.ai.gpu-id:1}")
    private int gpuId;

    @Value("${upscaler.ai.tile-size:128}")
    private int tileSize;

    @Value("${upscaler.ai.timeout-seconds:180}")
    private long timeoutSeconds;

    public byte[] upscale(
            MultipartFile file,
            int originalWidth,
            int originalHeight
    ) {
        if (!enabled) {
            throw new InvalidImageException(
                    "AI Pro is not enabled on this server."
            );
        }

        String extension = getSupportedExtension(file);
        Path tempDirectory = null;
        Process process = null;

        try {
            Path executablePath = Path.of(executable);
            Path modelsPath = Path.of(modelDirectory);

            if (!Files.isRegularFile(executablePath)) {
                throw new InvalidImageException(
                        "Real-ESRGAN executable was not found."
                );
            }

            if (!Files.isDirectory(modelsPath)) {
                throw new InvalidImageException(
                        "Real-ESRGAN model directory was not found."
                );
            }

            tempDirectory = Files.createTempDirectory("real-esrgan-");
            Path inputPath = tempDirectory.resolve("input." + extension);
            Path outputPath = tempDirectory.resolve("output.png");
            Path logPath = tempDirectory.resolve("engine.log");

            file.transferTo(inputPath);

            ProcessBuilder builder = new ProcessBuilder(
                    executablePath.toString(),
                    "-i", inputPath.toString(),
                    "-o", outputPath.toString(),
                    "-n", "realesrgan-x4plus",
                    "-s", "4",
                    "-m", modelsPath.toString(),
                    "-g", Integer.toString(gpuId),
                    "-t", Integer.toString(tileSize),
                    "-f", "png"
            );

            builder.redirectErrorStream(true);
            builder.redirectOutput(logPath.toFile());

            process = builder.start();

            boolean completed = process.waitFor(
                    timeoutSeconds, TimeUnit.SECONDS
            );

            if (!completed) {
                process.destroyForcibly();
                process.waitFor();

                throw new InvalidImageException(
                        "AI upscaling timed out. Try a smaller image."
                );
            }

            if (process.exitValue() != 0) {
                if (Files.exists(logPath)) {
                    String details = Files.readString(logPath);
                    if (details.length() > 1000) {
                        details = details.substring(details.length() - 1000);
                    }
                    log.error("Real-ESRGAN failed with exit code {}: {}", process.exitValue(), details);
                } else {
                    log.error("Real-ESRGAN failed with exit code {}", process.exitValue());
                }

                throw new InvalidImageException(
                        "AI upscaling failed. Please try another image or try again later."
                );
            }

            if (!Files.isRegularFile(outputPath)
                    || Files.size(outputPath) == 0) {
                throw new InvalidImageException(
                        "Real-ESRGAN did not produce an output image."
                );
            }

            validateOutputImage(
                    outputPath,
                    originalWidth,
                    originalHeight
            );

            return Files.readAllBytes(outputPath);

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();

            if (process != null) {
                process.destroyForcibly();
            }

            throw new InvalidImageException(
                    "AI upscaling was interrupted.", e
            );

        } catch (IOException | RuntimeException e) {
            if (process != null && process.isAlive()) {
                process.destroyForcibly();
            }

            if (e instanceof InvalidImageException invalidImageException) {
                throw invalidImageException;
            }

            throw new InvalidImageException(
                    "Failed to run Real-ESRGAN: " + e.getMessage(), e
            );

        } finally {
            if (tempDirectory != null) {
                try (var paths = Files.walk(tempDirectory)) {
                    paths.sorted((a, b) -> b.compareTo(a))
                            .forEach(path -> {
                                try {
                                    Files.deleteIfExists(path);
                                } catch (IOException ignored) {
                                    // Best-effort temporary-file cleanup.
                                }
                            });
                } catch (IOException ignored) {
                    // Best-effort temporary-directory cleanup.
                }
            }
        }
    }

    private String getSupportedExtension(MultipartFile file) {
        String contentType = file.getContentType();

        if (contentType == null) {
            throw new InvalidImageException(
                    "AI Pro requires a JPEG, PNG, or WEBP input image."
            );
        }

        return switch (contentType.toLowerCase(Locale.ROOT)) {
            case "image/jpeg", "image/jpg", "image/pjpeg" -> "jpg";
            case "image/png", "image/x-png" -> "png";
            case "image/webp" -> "webp";
            default -> throw new InvalidImageException(
                    "AI Pro currently supports JPEG, PNG, and WEBP input only."
            );
        };
    }

    private void validateOutputImage(
            Path outputPath,
            int originalWidth,
            int originalHeight
    ) throws IOException {
        try (ImageInputStream input =
                     ImageIO.createImageInputStream(outputPath.toFile())) {

            if (input == null) {
                throw new InvalidImageException(
                        "Real-ESRGAN output could not be inspected."
                );
            }

            Iterator<ImageReader> readers = ImageIO.getImageReaders(input);

            if (!readers.hasNext()) {
                throw new InvalidImageException(
                        "Real-ESRGAN produced an invalid image."
                );
            }

            ImageReader reader = readers.next();

            try {
                reader.setInput(input, true, true);

                int width = reader.getWidth(0);
                int height = reader.getHeight(0);

                long expectedWidth = (long) originalWidth * 4;
                long expectedHeight = (long) originalHeight * 4;

                if (expectedWidth > 8192 || expectedHeight > 8192) {
                    throw new InvalidImageException(
                            "The 4× AI output would exceed the 8192-pixel limit."
                    );
                }

                if (width != expectedWidth || height != expectedHeight) {
                    throw new InvalidImageException(
                            String.format(
                                    "Unexpected AI output dimensions: %dx%d. Expected %dx%d.",
                                    width, height, expectedWidth, expectedHeight
                            )
                    );
                }
            } finally {
                reader.dispose();
            }
        }
    }
}
