package com.upscaler.controller;

import com.upscaler.dto.ImageUploadResponse;
import com.upscaler.dto.UpscaleSettingsRequest;
import com.upscaler.service.ImageProcessingService;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/images")
public class ImageController {

    private final ImageProcessingService imageProcessingService;

    public ImageController(ImageProcessingService imageProcessingService) {
        this.imageProcessingService = imageProcessingService;
    }

    /**
     * Upload an image and upscale it with specified dimension constraints and user settings.
     * Returns JSON response with metadata and base64 preview data.
     */
    @PostMapping(value = "/upscale", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<ImageUploadResponse> upscaleImage(
            @RequestParam("file") MultipartFile file,
            @Valid @ModelAttribute UpscaleSettingsRequest settings
    ) {
        ImageProcessingService.ProcessedImageResult result = imageProcessingService.processImage(file, settings);
        return ResponseEntity.ok(result.response());
    }

    /**
     * Upload an image and upscale it, directly returning the binary image file for download.
     */
    @PostMapping(value = "/download", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<byte[]> upscaleAndDownload(
            @RequestParam("file") MultipartFile file,
            @Valid @ModelAttribute UpscaleSettingsRequest settings
    ) {
        ImageProcessingService.ProcessedImageResult result = imageProcessingService.processImage(file, settings);
        String originalName = file.getOriginalFilename() != null ? file.getOriginalFilename() : "image";
        originalName = originalName.replace('\\', '/');
        if (originalName.contains("/")) {
            originalName = originalName.substring(originalName.lastIndexOf('/') + 1);
        }
        String baseName = originalName.contains(".") ? originalName.substring(0, originalName.lastIndexOf('.')) : originalName;
        String sanitizedBaseName = baseName.replaceAll("[^a-zA-Z0-9._-]", "_")
                .replaceAll("^\\.+", "");
        if (sanitizedBaseName.isBlank()) {
            sanitizedBaseName = "image";
        }
        String extension = switch (result.response().getOutputFormat().toUpperCase()) {
            case "JPEG" -> ".jpg";
            case "WEBP" -> ".webp";
            case "BMP" -> ".bmp";
            case "TIFF", "TIF" -> ".tiff";
            default -> ".png";
        };
        String filename = "upscaled_" + sanitizedBaseName + extension;

        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .contentType(MediaType.parseMediaType(result.mimeType()))
                .contentLength(result.imageBytes().length)
                .body(result.imageBytes());
    }

    /**
     * Validate dimensions and user settings without uploading a file.
     */
    @PostMapping("/validate-settings")
    public ResponseEntity<Map<String, Object>> validateSettings(
            @Valid @RequestBody UpscaleSettingsRequest settings
    ) {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("valid", true);
        response.put("message", "Dimensions and user settings are valid");
        response.put("settings", settings);
        return ResponseEntity.ok(response);
    }

    /**
     * Return available configuration, supported formats, and limits.
     */
    @GetMapping("/config")
    public ResponseEntity<Map<String, Object>> getConfig() {
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("supportedFormats", List.of("PNG", "JPEG", "WEBP", "BMP", "TIFF"));
        config.put("supportedModels", List.of("standard", "bicubic", "ultra_sharp"));
        config.put("minDimension", 16);
        config.put("maxDimension", 8192);
        config.put("maxScaleFactor", 8);
        config.put("maxFileSize", "50MB");
        config.put("defaultScaleFactor", 2);
        config.put("defaultQuality", 90);

        return ResponseEntity.ok(config);
    }
}
