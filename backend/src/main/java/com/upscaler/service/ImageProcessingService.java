package com.upscaler.service;

import com.upscaler.dto.ImageUploadResponse;
import com.upscaler.dto.UpscaleSettingsRequest;
import com.upscaler.exception.InvalidImageException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.ImageTypeSpecifier;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.metadata.IIOMetadata;
import javax.imageio.metadata.IIOMetadataNode;
import javax.imageio.stream.ImageInputStream;
import javax.imageio.stream.MemoryCacheImageOutputStream;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.awt.image.ConvolveOp;
import java.awt.image.Kernel;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Base64;
import java.util.Iterator;
import java.util.List;

@Service
public class ImageProcessingService {

    @Value("${upscaler.image.max-width:8192}")
    private int maxWidthLimit;

    @Value("${upscaler.image.max-height:8192}")
    private int maxHeightLimit;

    @Value("${upscaler.image.min-width:16}")
    private int minWidthLimit;

    @Value("${upscaler.image.min-height:16}")
    private int minHeightLimit;

    private static final List<String> ALLOWED_CONTENT_TYPES = List.of(
            "image/jpeg",
            "image/jpg",
            "image/pjpeg",
            "image/jfif",
            "image/png",
            "image/x-png",
            "image/webp",
            "image/bmp",
            "image/x-ms-bmp",
            "image/tiff",
            "image/tif"
    );

    public record ProcessedImageResult(ImageUploadResponse response, byte[] imageBytes, String mimeType) {}

    public ProcessedImageResult processImage(MultipartFile file, UpscaleSettingsRequest settings) {
        long startTime = System.currentTimeMillis();

        validateFile(file);

        byte[] fileBytes;
        try {
            fileBytes = file.getBytes();
        } catch (IOException e) {
            throw new InvalidImageException("Failed to read image stream: " + e.getMessage(), e);
        }

        int origWidth;
        int origHeight;
        BufferedImage inputImage;

        // Probing dimensions and pixel bounds before loading full raster into memory (Decompression bomb protection)
        try (ByteArrayInputStream bais = new ByteArrayInputStream(fileBytes);
             ImageInputStream iis = ImageIO.createImageInputStream(bais)) {

            if (iis == null) {
                throw new InvalidImageException("The uploaded file is not a valid or supported image stream");
            }

            Iterator<ImageReader> readers = ImageIO.getImageReaders(iis);
            if (!readers.hasNext()) {
                throw new InvalidImageException("The uploaded file is not a valid or supported image");
            }

            ImageReader reader = readers.next();
            try {
                reader.setInput(iis, true, false);
                origWidth = reader.getWidth(0);
                origHeight = reader.getHeight(0);

                validateInputDimensions(origWidth, origHeight);

                long totalInputPixels = (long) origWidth * origHeight;
                long maxPixels = (long) maxWidthLimit * maxHeightLimit;
                if (totalInputPixels > maxPixels) {
                    throw new InvalidImageException(String.format(
                            "Decoded image dimensions (%dx%d = %d pixels) exceed maximum allowable pixel count (%d pixels)",
                            origWidth, origHeight, totalInputPixels, maxPixels
                    ));
                }

                // Calculate and validate target dimensions before allocating scaled buffers
                Dimension targetDim = calculateTargetDimensions(origWidth, origHeight, settings);
                validateTargetDimensions(targetDim.width, targetDim.height);

                inputImage = reader.read(0);
            } finally {
                reader.dispose();
            }
        } catch (InvalidImageException e) {
            throw e;
        } catch (IOException e) {
            throw new InvalidImageException("Failed to inspect or decode image stream: " + e.getMessage(), e);
        }

        if (inputImage == null) {
            throw new InvalidImageException("The uploaded file is not a valid or supported image");
        }

        // Calculate target dimensions
        Dimension targetDim = calculateTargetDimensions(origWidth, origHeight, settings);
        int targetWidth = targetDim.width;
        int targetHeight = targetDim.height;

        validateTargetDimensions(targetWidth, targetHeight);

        // Normalize output format
        String targetFormat = settings.getOutputFormat() != null ? settings.getOutputFormat().toUpperCase() : "PNG";
        if (targetFormat.equals("JPG")) {
            targetFormat = "JPEG";
        }
        if (targetFormat.equals("TIF")) {
            targetFormat = "TIFF";
        }

        boolean hasAlpha = inputImage.getColorModel().hasAlpha() && !targetFormat.equals("JPEG") && !targetFormat.equals("BMP");
        int imageType = hasAlpha ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB;

        BufferedImage scaledImage = new BufferedImage(targetWidth, targetHeight, imageType);
        Graphics2D g2d = scaledImage.createGraphics();

        try {
            g2d.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
            g2d.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
            g2d.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g2d.setRenderingHint(RenderingHints.KEY_COLOR_RENDERING, RenderingHints.VALUE_COLOR_RENDER_QUALITY);
            g2d.setRenderingHint(RenderingHints.KEY_DITHERING, RenderingHints.VALUE_DITHER_ENABLE);

            if (!hasAlpha) {
                g2d.setColor(Color.WHITE);
                g2d.fillRect(0, 0, targetWidth, targetHeight);
            }

            g2d.drawImage(inputImage, 0, 0, targetWidth, targetHeight, null);
        } finally {
            g2d.dispose();
        }

        // Apply sharpening filter if requested
        int effectiveSharpen = settings.getSharpenLevel() != null ? settings.getSharpenLevel() : 0;
        if (effectiveSharpen == 0 && "ultra_sharp".equalsIgnoreCase(settings.getModel())) {
            effectiveSharpen = 25;
        }
        if (effectiveSharpen > 0) {
            scaledImage = applySharpen(scaledImage, effectiveSharpen, hasAlpha);
        }

        int targetDpi = (settings.getDpi() != null && settings.getDpi() >= 72 && settings.getDpi() <= 1200)
                ? settings.getDpi()
                : 300;

        // Encode image with DPI metadata
        byte[] outputBytes = encodeImage(scaledImage, targetFormat, settings.getQuality(), targetDpi);
        long duration = System.currentTimeMillis() - startTime;

        String mimeType = switch (targetFormat) {
            case "JPEG" -> "image/jpeg";
            case "WEBP" -> "image/webp";
            case "BMP" -> "image/bmp";
            case "TIFF", "TIF" -> "image/tiff";
            default -> "image/png";
        };

        String base64Data = Base64.getEncoder().encodeToString(outputBytes);
        String dataUrl = "data:" + mimeType + ";base64," + base64Data;

        ImageUploadResponse response = new ImageUploadResponse();
        response.setOriginalFilename(file.getOriginalFilename());
        response.setContentType(file.getContentType());
        response.setOriginalSizeBytes(file.getSize());
        response.setOriginalWidth(origWidth);
        response.setOriginalHeight(origHeight);

        response.setTargetWidth(targetWidth);
        response.setTargetHeight(targetHeight);
        response.setScaleFactor(settings.getScaleFactor() != null ? settings.getScaleFactor() : 1);
        response.setOutputFormat(targetFormat);
        response.setDpi(targetDpi);
        response.setOutputSizeBytes(outputBytes.length);
        response.setProcessingDurationMs(duration);
        response.setModel(settings.getModel() != null ? settings.getModel() : "standard");
        response.setDataUrl(dataUrl);
        response.setMessage(String.format("Successfully resized image from %dx%d to %dx%d (%s, %d DPI)",
                origWidth, origHeight, targetWidth, targetHeight, targetFormat, targetDpi));

        return new ProcessedImageResult(response, outputBytes, mimeType);
    }

    public void validateFile(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new InvalidImageException("Image file is required and cannot be empty");
        }

        if (file.getSize() > 52_428_800L) {
            throw new InvalidImageException("Uploaded image exceeds maximum allowable file size (50MB)");
        }

        String contentType = file.getContentType();
        if (contentType == null || !ALLOWED_CONTENT_TYPES.contains(contentType.toLowerCase())) {
            throw new InvalidImageException(
                    "Unsupported image content type: " + contentType + ". Allowed types: JPEG, PNG, WEBP, BMP, TIFF"
            );
        }
    }

    public void validateInputDimensions(int width, int height) {
        if (width < minWidthLimit || height < minHeightLimit) {
            throw new InvalidImageException(
                    String.format(
                            "Image dimensions too small: %dx%d. Minimum allowed dimensions are %dx%d",
                            width, height, minWidthLimit, minHeightLimit
                    )
            );
        }

        if (width > maxWidthLimit || height > maxHeightLimit) {
            throw new InvalidImageException(
                    String.format(
                            "Image dimensions too large: %dx%d. Maximum allowed dimensions are %dx%d",
                            width, height, maxWidthLimit, maxHeightLimit
                    )
            );
        }
    }

    public void validateTargetDimensions(int targetWidth, int targetHeight) {
        if (targetWidth < minWidthLimit || targetHeight < minHeightLimit) {
            throw new InvalidImageException(String.format(
                    "Calculated target dimensions too small: %dx%d. Minimum allowed dimensions are %dx%d",
                    targetWidth, targetHeight, minWidthLimit, minHeightLimit
                    ));
        }

        if (targetWidth > maxWidthLimit || targetHeight > maxHeightLimit) {
            throw new InvalidImageException(String.format(
                    "Target dimensions %dx%d exceed maximum allowable resolution (%dx%d)",
                    targetWidth, targetHeight, maxWidthLimit, maxHeightLimit
            ));
        }
    }

    public Dimension calculateTargetDimensions(int origWidth, int origHeight, UpscaleSettingsRequest settings) {
        if (settings.getTargetWidth() != null && settings.getTargetHeight() != null) {
            if (Boolean.TRUE.equals(settings.getMaintainAspectRatio())) {
                double targetRatio = (double) settings.getTargetWidth() / settings.getTargetHeight();
                double origRatio = (double) origWidth / origHeight;
                if (origRatio > targetRatio) {
                    return new Dimension(settings.getTargetWidth(), (int) Math.round(settings.getTargetWidth() / origRatio));
                } else {
                    return new Dimension((int) Math.round(settings.getTargetHeight() * origRatio), settings.getTargetHeight());
                }
            }
            return new Dimension(settings.getTargetWidth(), settings.getTargetHeight());
        }

        if (settings.getTargetWidth() != null) {
            double ratio = (double) origHeight / origWidth;
            return new Dimension(settings.getTargetWidth(), (int) Math.round(settings.getTargetWidth() * ratio));
        }

        if (settings.getTargetHeight() != null) {
            double ratio = (double) origWidth / origHeight;
            return new Dimension((int) Math.round(settings.getTargetHeight() * ratio), settings.getTargetHeight());
        }

        int factor = (settings.getScaleFactor() != null && settings.getScaleFactor() >= 1)
                ? settings.getScaleFactor()
                : 2;

        return new Dimension(origWidth * factor, origHeight * factor);
    }

    private BufferedImage applySharpen(BufferedImage source, int level, boolean hasAlpha) {
        float factor = (float) level / 100.0f;
        float center = 1.0f + 4.0f * (0.25f * factor);
        float neighbor = - (0.25f * factor);

        float[] kernelData = {
                0.0f, neighbor, 0.0f,
                neighbor, center, neighbor,
                0.0f, neighbor, 0.0f
        };

        Kernel kernel = new Kernel(3, 3, kernelData);
        ConvolveOp op = new ConvolveOp(kernel, ConvolveOp.EDGE_NO_OP, null);

        int imageType = hasAlpha ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB;
        BufferedImage destination = new BufferedImage(source.getWidth(), source.getHeight(), imageType);
        return op.filter(source, destination);
    }

    private byte[] encodeImage(BufferedImage image, String format, Integer quality, int dpi) {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();

        try {
            if ("JPEG".equalsIgnoreCase(format)) {
                Iterator<ImageWriter> writers = ImageIO.getImageWritersByFormatName("jpeg");
                if (writers.hasNext()) {
                    ImageWriter writer = writers.next();
                    try (MemoryCacheImageOutputStream mcios = new MemoryCacheImageOutputStream(baos)) {
                        writer.setOutput(mcios);
                        ImageWriteParam param = writer.getDefaultWriteParam();
                        if (param.canWriteCompressed()) {
                            param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
                            float q = (quality != null && quality >= 1 && quality <= 100) ? quality / 100.0f : 0.95f;
                            param.setCompressionQuality(q);
                        }

                        ImageTypeSpecifier spec = ImageTypeSpecifier.createFromRenderedImage(image);
                        IIOMetadata meta = writer.getDefaultImageMetadata(spec, param);

                        try {
                            IIOMetadataNode root = new IIOMetadataNode("javax_imageio_jpeg_image_1.0");
                            IIOMetadataNode variety = new IIOMetadataNode("JPEGvariety");
                            IIOMetadataNode jfif = new IIOMetadataNode("app0JFIF");
                            jfif.setAttribute("majorVersion", "1");
                            jfif.setAttribute("minorVersion", "2");
                            jfif.setAttribute("resUnits", "1"); // 1 = dots per inch
                            jfif.setAttribute("Xdensity", Integer.toString(dpi));
                            jfif.setAttribute("Ydensity", Integer.toString(dpi));
                            jfif.setAttribute("thumbWidth", "0");
                            jfif.setAttribute("thumbHeight", "0");
                            variety.appendChild(jfif);
                            root.appendChild(variety);
                            IIOMetadataNode markerSequence = new IIOMetadataNode("markerSequence");
                            root.appendChild(markerSequence);
                            meta.mergeTree("javax_imageio_jpeg_image_1.0", root);
                        } catch (Exception ignored) {
                            // Proceed if native metadata merge fails
                        }

                        writer.write(null, new IIOImage(image, null, meta), param);
                    } finally {
                        writer.dispose();
                    }
                    return baos.toByteArray();
                }
            }

            if ("PNG".equalsIgnoreCase(format)) {
                Iterator<ImageWriter> writers = ImageIO.getImageWritersByFormatName("png");
                if (writers.hasNext()) {
                    ImageWriter writer = writers.next();
                    try (MemoryCacheImageOutputStream mcios = new MemoryCacheImageOutputStream(baos)) {
                        writer.setOutput(mcios);
                        ImageWriteParam param = writer.getDefaultWriteParam();
                        ImageTypeSpecifier spec = ImageTypeSpecifier.createFromRenderedImage(image);
                        IIOMetadata meta = writer.getDefaultImageMetadata(spec, param);

                        try {
                            int ppm = (int) Math.round(dpi / 0.0254);
                            IIOMetadataNode nativeRoot = new IIOMetadataNode("javax_imageio_png_1.0");
                            IIOMetadataNode phys = new IIOMetadataNode("pHYs");
                            phys.setAttribute("pixelsPerUnitXAxis", Integer.toString(ppm));
                            phys.setAttribute("pixelsPerUnitYAxis", Integer.toString(ppm));
                            phys.setAttribute("unitSpecifier", "meter");
                            nativeRoot.appendChild(phys);
                            meta.mergeTree("javax_imageio_png_1.0", nativeRoot);
                        } catch (Exception ignored) {
                            // Proceed if native metadata merge fails
                        }

                        writer.write(null, new IIOImage(image, null, meta), param);
                    } finally {
                        writer.dispose();
                    }
                    return baos.toByteArray();
                }
            }

            if ("TIFF".equalsIgnoreCase(format) || "TIF".equalsIgnoreCase(format)) {
                Iterator<ImageWriter> writers = ImageIO.getImageWritersByFormatName("tiff");
                if (writers.hasNext()) {
                    ImageWriter writer = writers.next();
                    try (MemoryCacheImageOutputStream mcios = new MemoryCacheImageOutputStream(baos)) {
                        writer.setOutput(mcios);
                        ImageWriteParam param = writer.getDefaultWriteParam();
                        ImageTypeSpecifier spec = ImageTypeSpecifier.createFromRenderedImage(image);
                        IIOMetadata meta = writer.getDefaultImageMetadata(spec, param);

                        if (meta != null) {
                            try {
                                IIOMetadataNode root = new IIOMetadataNode("com_sun_media_imageio_plugins_tiff_image_1.0");
                                IIOMetadataNode ifd = new IIOMetadataNode("TIFFIFD");

                                IIOMetadataNode xResField = new IIOMetadataNode("TIFFField");
                                xResField.setAttribute("number", "282");
                                xResField.setAttribute("name", "XResolution");
                                IIOMetadataNode xRationals = new IIOMetadataNode("TIFFRationals");
                                IIOMetadataNode xRational = new IIOMetadataNode("TIFFRational");
                                xRational.setAttribute("value", dpi + "/1");
                                xRationals.appendChild(xRational);
                                xResField.appendChild(xRationals);
                                ifd.appendChild(xResField);

                                IIOMetadataNode yResField = new IIOMetadataNode("TIFFField");
                                yResField.setAttribute("number", "283");
                                yResField.setAttribute("name", "YResolution");
                                IIOMetadataNode yRationals = new IIOMetadataNode("TIFFRationals");
                                IIOMetadataNode yRational = new IIOMetadataNode("TIFFRational");
                                yRational.setAttribute("value", dpi + "/1");
                                yRationals.appendChild(yRational);
                                yResField.appendChild(yRationals);
                                ifd.appendChild(yResField);

                                IIOMetadataNode unitField = new IIOMetadataNode("TIFFField");
                                unitField.setAttribute("number", "296");
                                unitField.setAttribute("name", "ResolutionUnit");
                                IIOMetadataNode unitShorts = new IIOMetadataNode("TIFFShorts");
                                IIOMetadataNode unitShort = new IIOMetadataNode("TIFFShort");
                                unitShort.setAttribute("value", "2"); // 2 = Inch
                                unitShorts.appendChild(unitShort);
                                unitField.appendChild(unitShorts);
                                ifd.appendChild(unitField);

                                root.appendChild(ifd);
                                meta.mergeTree("com_sun_media_imageio_plugins_tiff_image_1.0", root);
                            } catch (Exception ignored) {
                                // Proceed if native metadata merge fails
                            }
                        }

                        writer.write(null, new IIOImage(image, null, meta), param);
                    } finally {
                        writer.dispose();
                    }
                    return baos.toByteArray();
                }
            }

            // Fallback for BMP, WEBP or default writers
            BufferedImage imageToWrite = image;
            if ("BMP".equalsIgnoreCase(format) && image.getColorModel().hasAlpha()) {
                imageToWrite = new BufferedImage(image.getWidth(), image.getHeight(), BufferedImage.TYPE_INT_RGB);
                Graphics2D g = imageToWrite.createGraphics();
                try {
                    g.setColor(Color.WHITE);
                    g.fillRect(0, 0, image.getWidth(), image.getHeight());
                    g.drawImage(image, 0, 0, null);
                } finally {
                    g.dispose();
                }
            }

            boolean written = ImageIO.write(imageToWrite, format.toLowerCase(), baos);

            if (!written) {
                throw new InvalidImageException(
                        "Output format is not supported by the installed image encoders: " + format
                );
            }

            return baos.toByteArray();
        } catch (IOException e) {
            throw new InvalidImageException("Failed to encode upscaled image to " + format + ": " + e.getMessage(), e);
        }
    }
}
