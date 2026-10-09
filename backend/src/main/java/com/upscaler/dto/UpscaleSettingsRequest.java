package com.upscaler.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;

public class UpscaleSettingsRequest {

    @Min(value = 16, message = "Target width must be at least 16 pixels")
    @Max(value = 8192, message = "Target width cannot exceed 8192 pixels")
    private Integer targetWidth;

    @Min(value = 16, message = "Target height must be at least 16 pixels")
    @Max(value = 8192, message = "Target height cannot exceed 8192 pixels")
    private Integer targetHeight;

    @Min(value = 1, message = "Scale factor must be at least 1x")
    @Max(value = 8, message = "Scale factor cannot exceed 8x")
    private Integer scaleFactor = 2;

    @Pattern(
            regexp = "(?i)^(PNG|JPEG|JPG|WEBP|BMP|TIFF|TIF)$",
            message = "Output format must be PNG, JPEG, WEBP, BMP, or TIFF"
    )
    private String outputFormat = "PNG";

    @Min(value = 1, message = "Quality must be at least 1")
    @Max(value = 100, message = "Quality cannot exceed 100")
    private Integer quality = 90;

    @Min(value = 72, message = "DPI must be at least 72")
    @Max(value = 1200, message = "DPI cannot exceed 1200")
    private Integer dpi = 300;

    @Pattern(regexp = "(?i)^(standard|ultra_sharp|anime|cinematic|art|bicubic)$", message = "Model must be one of: standard, ultra_sharp, anime, cinematic, art, bicubic")
    private String model = "standard";

    @Min(value = 0, message = "Denoise level must be at least 0")
    @Max(value = 100, message = "Denoise level cannot exceed 100")
    private Integer denoiseLevel = 0;

    @Min(value = 0, message = "Sharpen level must be at least 0")
    @Max(value = 100, message = "Sharpen level cannot exceed 100")
    private Integer sharpenLevel = 0;

    private Boolean maintainAspectRatio = true;

    public UpscaleSettingsRequest() {
    }

    public Integer getTargetWidth() {
        return targetWidth;
    }

    public void setTargetWidth(Integer targetWidth) {
        this.targetWidth = targetWidth;
    }

    public Integer getTargetHeight() {
        return targetHeight;
    }

    public void setTargetHeight(Integer targetHeight) {
        this.targetHeight = targetHeight;
    }

    public Integer getScaleFactor() {
        return scaleFactor;
    }

    public void setScaleFactor(Integer scaleFactor) {
        this.scaleFactor = scaleFactor;
    }

    public String getOutputFormat() {
        return outputFormat;
    }

    public void setOutputFormat(String outputFormat) {
        this.outputFormat = outputFormat;
    }

    public Integer getQuality() {
        return quality;
    }

    public void setQuality(Integer quality) {
        this.quality = quality;
    }

    public Integer getDpi() {
        return dpi;
    }

    public void setDpi(Integer dpi) {
        this.dpi = dpi;
    }

    public String getModel() {
        return model;
    }

    public void setModel(String model) {
        this.model = model;
    }

    public Integer getDenoiseLevel() {
        return denoiseLevel;
    }

    public void setDenoiseLevel(Integer denoiseLevel) {
        this.denoiseLevel = denoiseLevel;
    }

    public Integer getSharpenLevel() {
        return sharpenLevel;
    }

    public void setSharpenLevel(Integer sharpenLevel) {
        this.sharpenLevel = sharpenLevel;
    }

    public Boolean getMaintainAspectRatio() {
        return maintainAspectRatio;
    }

    public void setMaintainAspectRatio(Boolean maintainAspectRatio) {
        this.maintainAspectRatio = maintainAspectRatio;
    }
}
