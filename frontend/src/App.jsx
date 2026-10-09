import { useEffect, useRef, useState, useCallback } from "react";
import "./App.css";

const API = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8808"
).replace(/\/+$/, "");

const initialSettings = {
  scaleFactor: "2",
  targetWidth: "2480",
  targetHeight: "3508",
  outputFormat: "PNG",
  dpi: "300",
  quality: 95,
  maintainAspectRatio: true,
};

const ALLOWED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"];
const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/x-png",
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/jfif",
  "image/webp",
  "image/bmp",
  "image/x-ms-bmp",
  "image/tiff",
  "image/tif",
];

function getAspectRatioLabel(width, height) {
  if (!width || !height) return "—";
  const ratio = width / height;
  if (Math.abs(ratio - 1) < 0.02) return "1:1 (Square)";
  if (Math.abs(ratio - 16 / 9) < 0.03) return "16:9 (Landscape)";
  if (Math.abs(ratio - 9 / 16) < 0.03) return "9:16 (Portrait)";
  if (Math.abs(ratio - 4 / 3) < 0.03) return "4:3 (Standard)";
  if (Math.abs(ratio - 3 / 4) < 0.03) return "3:4 (Portrait)";
  if (Math.abs(ratio - 3 / 2) < 0.03) return "3:2 (Photo)";
  if (Math.abs(ratio - 2 / 3) < 0.03) return "2:3 (Photo Portrait)";
  return `${ratio.toFixed(2)}:1`;
}

const PRESET_METADATA = {
  A5: { name: "A5", wMm: 148, hMm: 210, cm: "14.8 × 21.0 cm", in: "5.83 × 8.27 in" },
  A4: { name: "A4", wMm: 210, hMm: 297, cm: "21.0 × 29.7 cm", in: "8.27 × 11.69 in" },
  A3: { name: "A3", wMm: 297, hMm: 420, cm: "29.7 × 42.0 cm", in: "11.69 × 16.54 in" },
  LETTER: { name: "Letter", wMm: 215.9, hMm: 279.4, cm: "21.6 × 27.9 cm", in: "8.50 × 11.00 in" },
  LEGAL: { name: "Legal", wMm: 215.9, hMm: 355.6, cm: "21.6 × 35.6 cm", in: "8.50 × 14.00 in" },
};

function computeEffectiveDimensions(origW, origH, targetW, targetH, maintainAspect) {
  const w = Number(targetW);
  const h = Number(targetH);
  if (!w || !h || isNaN(w) || isNaN(h) || w < 16 || h < 16) return null;
  if (!origW || !origH || !maintainAspect) return { width: w, height: h };
  const targetRatio = w / h;
  const origRatio = origW / origH;
  if (origRatio > targetRatio) {
    return { width: w, height: Math.round(w / origRatio) };
  } else {
    return { width: Math.round(h * origRatio), height: h };
  }
}

function dataUrlToBlob(dataUrl) {
  const parts = dataUrl.split(",");
  const mime = parts[0].match(/:(.*?);/)?.[1] || "application/octet-stream";
  const bstr = atob(parts[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

function sanitizeFilename(name) {
  if (!name) return "image";
  return name
    .replace(/\.[^/.]+$/, "")
    .replace(/[<>:"/\\|?*]/g, "_")
    .split("")
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join("")
    .trim()
    .slice(0, 80) || "image";
}

function getExtensionForFormat(format) {
  const norm = (format || "").trim().toUpperCase();
  switch (norm) {
    case "JPEG":
    case "JPG":
      return ".jpg";
    case "WEBP":
      return ".webp";
    case "BMP":
      return ".bmp";
    case "TIFF":
    case "TIF":
      return ".tiff";
    case "PNG":
    default:
      return ".png";
  }
}

function getDpiSupportNote(format) {
  const norm = (format || "").toUpperCase();
  if (norm === "PNG" || norm === "JPEG" || norm === "JPG" || norm === "TIFF" || norm === "TIF") {
    return "Verified DPI metadata written to header";
  }
  return "Resampled to target pixel dimensions";
}

async function parseApiError(response) {
  let message = "";
  try {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = await response.json();
      if (body?.validationErrors && typeof body.validationErrors === "object") {
        const fieldMsgs = Object.values(body.validationErrors).flat().filter(Boolean);
        if (fieldMsgs.length > 0) message = fieldMsgs.join(". ");
      }
      if (!message && body?.message) {
        message = body.message;
      }
      if (!message && body?.error) {
        message = body.error;
      }
    } else {
      const text = await response.text();
      if (text && text.trim().length > 0 && text.length < 250 && !text.includes("<!DOCTYPE") && !text.includes("<html")) {
        message = text.trim();
      }
    }
  } catch {
    // Fall back to HTTP status message below
  }

  if (!message) {
    switch (response.status) {
      case 400:
        message = "Invalid image processing request. Please verify the dimensions and format settings.";
        break;
      case 413:
        message = "The uploaded file exceeds the 50MB maximum server upload limit.";
        break;
      case 415:
        message = "Unsupported image format. Please upload a PNG, JPEG, WebP, BMP, or TIFF file.";
        break;
      case 429:
        message = "Too many requests. Please wait a moment before trying again.";
        break;
      case 500:
        message = "Server error occurred while processing the image. Please try again.";
        break;
      case 502:
      case 503:
      case 504:
        message = "The image processing service is temporarily unavailable. Please verify the backend is running on port 8808.";
        break;
      default:
        message = `Image processing failed with status HTTP ${response.status}.`;
        break;
    }
  }

  return message;
}

function ImageComparisonSlider({
  originalSrc,
  processedSrc,
  originalDimensions,
  processedDimensions,
}) {
  const [sliderPos, setSliderPos] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef(null);

  const updatePosition = useCallback((clientX) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const x = clientX - rect.left;
    const pos = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPos(pos);
  }, []);

  const handlePointerDown = (e) => {
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    updatePosition(e.clientX);
  };

  const handlePointerMove = (e) => {
    if (!isDragging) return;
    updatePosition(e.clientX);
  };

  const handlePointerUp = (e) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Pointer capture may have already been released
      }
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setSliderPos((p) => Math.max(0, p - 5));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setSliderPos((p) => Math.min(100, p + 5));
    } else if (e.key === "Home") {
      e.preventDefault();
      setSliderPos(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setSliderPos(100);
    }
  };

  return (
    <div
      ref={containerRef}
      className="comparison-container"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      role="slider"
      aria-label="Before and after image comparison slider. Use left and right arrow keys to adjust split position."
      aria-valuenow={Math.round(sliderPos)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* Background layer: Original image (revealed on the left) */}
      <div className="comparison-layer comparison-original">
        <img src={originalSrc} alt="Original input image" draggable={false} />
        <span className="comparison-badge badge-original">
          ORIGINAL {originalDimensions?.width ? `(${originalDimensions.width} × ${originalDimensions.height} px)` : ""}
        </span>
      </div>

      {/* Foreground layer: Processed image (revealed on the right) */}
      <div
        className="comparison-layer comparison-processed"
        style={{ clipPath: `inset(0 0 0 ${sliderPos}%)` }}
      >
        <img src={processedSrc} alt="Processed resampled output image" draggable={false} />
        <span className="comparison-badge badge-processed">
          PROCESSED {processedDimensions?.width ? `(${processedDimensions.width} × ${processedDimensions.height} px)` : ""}
        </span>
      </div>

      {/* Interactive Divider Line and Center Grab Handle */}
      <div className="comparison-divider" style={{ left: `${sliderPos}%` }}>
        <div className="comparison-handle" aria-hidden="true">
          <span>‹</span>
          <span>›</span>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [result, setResult] = useState(null);
  const [settings, setSettings] = useState(initialSettings);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [previewMode, setPreviewMode] = useState("slider"); // "slider" | "processed" | "original"
  const [downloading, setDownloading] = useState(false);
  const inputRef = useRef(null);
  const loadCounterRef = useRef(0);
  const activeProcessingIdRef = useRef(0);
  const abortControllerRef = useRef(null);

  // Sizing mode & Print size calculator state
  const [sizingMode, setSizingMode] = useState("factor"); // "factor" | "custom" | "print"
  const [aspectRatioLocked, setAspectRatioLocked] = useState(true);
  const [printPreset, setPrintPreset] = useState("A4");
  const [orientation, setOrientation] = useState("portrait");
  const [customUnit, setCustomUnit] = useState("cm"); // "cm" | "in"
  const [customWidth, setCustomWidth] = useState("10");
  const [customHeight, setCustomHeight] = useState("15");
  const [calculatedPrintPx, setCalculatedPrintPx] = useState(null);
  const [printCalcError, setPrintCalcError] = useState("");

  const [supportedFormats, setSupportedFormats] = useState([
    "PNG",
    "JPEG",
    "WEBP",
    "BMP",
    "TIFF",
  ]);

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      try {
        const response = await fetch(`${API}/api/images/config`);
        if (!response.ok) {
          throw new Error("Could not load supported formats");
        }

        const config = await response.json();

        if (!cancelled && Array.isArray(config.supportedFormats)) {
          setSupportedFormats(config.supportedFormats);

          setSettings((old) => ({
            ...old,
            outputFormat: config.supportedFormats.includes(old.outputFormat)
              ? old.outputFormat
              : config.supportedFormats[0] || "PNG",
          }));
        }
      } catch (err) {
        console.error("Format configuration unavailable:", err);
      }
    }

    loadConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (preview.startsWith("blob:")) URL.revokeObjectURL(preview);
      abortControllerRef.current?.abort();
    };
  }, [preview]);

  function updateSetting(key, value) {
    if (busy) return;
    setSettings((old) => ({ ...old, [key]: value }));
    setResult(null);
    setError("");
  }

  function handleRemoveImage() {
    activeProcessingIdRef.current++;
    abortControllerRef.current?.abort();
    loadCounterRef.current++;
    setFile(null);
    setResult(null);
    setDimensions({ width: 0, height: 0 });
    setPreview((old) => {
      if (old.startsWith("blob:")) URL.revokeObjectURL(old);
      return "";
    });
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleReplaceImage() {
    if (busy) return;
    activeProcessingIdRef.current++;
    abortControllerRef.current?.abort();
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.click();
    }
  }

  function chooseFile(selected) {
    if (!selected) return;

    activeProcessingIdRef.current++;
    abortControllerRef.current?.abort();

    const fileNameLower = (selected.name || "").toLowerCase();
    const hasValidExt = ALLOWED_EXTENSIONS.some((ext) => fileNameLower.endsWith(ext));
    const hasValidMime = selected.type && ALLOWED_MIME_TYPES.includes(selected.type.toLowerCase());

    if (!hasValidExt && !hasValidMime) {
      setError(
        "Unsupported file format. Please select a PNG, JPEG, WebP, BMP, or TIFF image file."
      );
      return;
    }

    if (selected.size > 52_428_800) {
      setError(
        `File size (${(selected.size / (1024 * 1024)).toFixed(1)} MB) exceeds the 50MB maximum upload limit. Please select an image under 50MB.`
      );
      return;
    }

    const currentLoadId = ++loadCounterRef.current;
    setError("");
    setResult(null);
    setPreviewMode("slider");
    setFile(selected);

    const blobUrl = URL.createObjectURL(selected);
    setPreview((old) => {
      if (old.startsWith("blob:")) URL.revokeObjectURL(old);
      return blobUrl;
    });

    const image = new Image();
    image.onload = () => {
      if (loadCounterRef.current !== currentLoadId) return;

      const origW = image.naturalWidth;
      const origH = image.naturalHeight;

      if (!origW || !origH || origW < 16 || origH < 16) {
        setError(
          `Image dimensions (${origW} × ${origH} px) are smaller than the minimum 16 × 16 pixel requirement.`
        );
        return;
      }

      setDimensions({ width: origW, height: origH });

      if (sizingMode === "factor") {
        const scale = Number(settings.scaleFactor) || 2;
        const newW = Math.max(16, Math.round(origW * scale));
        const newH = Math.max(16, Math.round(origH * scale));
        setSettings((old) => ({
          ...old,
          targetWidth: String(newW),
          targetHeight: String(newH),
        }));
      }
    };

    image.onerror = () => {
      if (loadCounterRef.current !== currentLoadId) return;
      setError(
        "Failed to decode image. The file may be corrupt or encoded in an unsupported variant."
      );
    };

    image.src = blobUrl;
  }

  function changeScale(value) {
    const scale = Number(value);
    setSizingMode("factor");
    updateSetting("scaleFactor", value);

    const baseW = dimensions.width > 0 ? dimensions.width : 1240;
    const baseH = dimensions.height > 0 ? dimensions.height : 1754;
    // Calculate un-clamped target dimensions to avoid silent clamping
    const newW = Math.max(16, Math.round(baseW * scale));
    const newH = Math.max(16, Math.round(baseH * scale));

    setSettings((old) => ({
      ...old,
      scaleFactor: value,
      targetWidth: String(newW),
      targetHeight: String(newH),
    }));
  }

  function handleCustomWidthChange(val) {
    setSizingMode("custom");
    setResult(null);
    setError("");

    if (!aspectRatioLocked) {
      setSettings((old) => ({ ...old, targetWidth: val }));
      return;
    }

    const num = Number(val);
    const ratio =
      dimensions.width > 0 && dimensions.height > 0
        ? dimensions.width / dimensions.height
        : Number(settings.targetWidth) && Number(settings.targetHeight)
          ? Number(settings.targetWidth) / Number(settings.targetHeight)
          : 1;

    if (!isNaN(num) && num > 0) {
      const computedH = Math.round(num / ratio);
      setSettings((old) => ({
        ...old,
        targetWidth: val,
        targetHeight: String(computedH),
      }));
    } else {
      setSettings((old) => ({ ...old, targetWidth: val }));
    }
  }

  function handleCustomHeightChange(val) {
    setSizingMode("custom");
    setResult(null);
    setError("");

    if (!aspectRatioLocked) {
      setSettings((old) => ({ ...old, targetHeight: val }));
      return;
    }

    const num = Number(val);
    const ratio =
      dimensions.width > 0 && dimensions.height > 0
        ? dimensions.width / dimensions.height
        : Number(settings.targetWidth) && Number(settings.targetHeight)
          ? Number(settings.targetWidth) / Number(settings.targetHeight)
          : 1;

    if (!isNaN(num) && num > 0) {
      const computedW = Math.round(num * ratio);
      setSettings((old) => ({
        ...old,
        targetHeight: val,
        targetWidth: String(computedW),
      }));
    } else {
      setSettings((old) => ({ ...old, targetHeight: val }));
    }
  }

  function resetToOriginalDimensions() {
    if (dimensions.width > 0 && dimensions.height > 0) {
      setSettings((old) => ({
        ...old,
        scaleFactor: "1",
        targetWidth: String(dimensions.width),
        targetHeight: String(dimensions.height),
      }));
      setResult(null);
      setError("");
    }
  }

  // Fetch print size calculations from Spring Boot backend
  const calculatePrintSizes = useCallback(async () => {
    if (sizingMode !== "print") return;

    try {
      setPrintCalcError("");
      let url = `${API}/api/images/print-sizes?dpi=${settings.dpi}`;

      if (printPreset !== "CUSTOM") {
        url += `&preset=${printPreset}&orientation=${orientation}`;
      } else {
        const wCm = customUnit === "in" ? Number(customWidth) * 2.54 : Number(customWidth);
        const hCm = customUnit === "in" ? Number(customHeight) * 2.54 : Number(customHeight);

        if (!wCm || !hCm || wCm <= 0 || hCm <= 0 || isNaN(wCm) || isNaN(hCm)) {
          setPrintCalcError("Enter valid positive numbers for custom width and height.");
          return;
        }
        url += `&widthCm=${wCm}&heightCm=${hCm}`;
      }

      const response = await fetch(url);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || `Print size calculation failed (HTTP ${response.status})`);
      }

      const data = await response.json();
      setCalculatedPrintPx({ width: data.widthPx, height: data.heightPx });

      // Automatically apply to image settings
      setSettings((old) => ({
        ...old,
        targetWidth: String(data.widthPx),
        targetHeight: String(data.heightPx),
      }));

      // Check against backend limit of 8192 x 8192 px
      if (data.widthPx > 8192 || data.heightPx > 8192) {
        setPrintCalcError(
          `Output dimensions (${data.widthPx} × ${data.heightPx} px) exceed the backend maximum limit of 8192 × 8192 px. The image processor will reject this. Please reduce DPI or choose a smaller size.`
        );
      } else {
        setPrintCalcError("");
      }
    } catch (err) {
      setPrintCalcError(err.message || "Failed to calculate print dimensions.");
    }
  }, [sizingMode, printPreset, orientation, settings.dpi, customUnit, customWidth, customHeight]);

  useEffect(() => {
    calculatePrintSizes();
  }, [calculatePrintSizes]);

  const targetWNum = Number(settings.targetWidth);
  const targetHNum = Number(settings.targetHeight);

  let dimensionWarning = "";
  if (
    settings.targetWidth === "" ||
    settings.targetHeight === "" ||
    isNaN(targetWNum) ||
    isNaN(targetHNum)
  ) {
    dimensionWarning = "Target width and height must both be valid positive numbers.";
  } else if (targetWNum < 16 || targetHNum < 16) {
    dimensionWarning = `Target dimensions (${targetWNum} × ${targetHNum} px) cannot be smaller than the minimum 16 × 16 pixel backend limit.`;
  } else if (targetWNum > 8192 || targetHNum > 8192) {
    dimensionWarning = `Target dimensions (${targetWNum} × ${targetHNum} px) exceed the backend maximum limit of 8192 × 8192 pixels. Please adjust dimensions or lower DPI.`;
  }

  const isInvalidDimensions = Boolean(dimensionWarning);
  const effectiveOutput = computeEffectiveDimensions(
    dimensions.width,
    dimensions.height,
    settings.targetWidth,
    settings.targetHeight,
    settings.maintainAspectRatio
  );

  async function processImage() {
    if (!file) {
      setError("Upload an image first.");
      return;
    }

    if (busy) return;

    if (isInvalidDimensions) {
      setError(dimensionWarning);
      return;
    }

    const currentProcId = ++activeProcessingIdRef.current;
    abortControllerRef.current?.abort();

    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Timeout guard: 90 seconds
    const timeoutId = setTimeout(() => {
      controller.abort(new Error("Image processing timed out after 90 seconds. Please try a smaller resolution or scale factor."));
    }, 90000);

    setBusy(true);
    setError("");
    setResult(null);

    try {
      const form = new FormData();
      form.append("file", file);
      form.append("scaleFactor", settings.scaleFactor);
      form.append("targetWidth", settings.targetWidth);
      form.append("targetHeight", settings.targetHeight);
      form.append("outputFormat", settings.outputFormat);
      form.append("dpi", settings.dpi);
      form.append("quality", String(settings.quality));
      form.append("model", "bicubic");
      form.append("denoiseLevel", "0");
      form.append("sharpenLevel", "0");
      form.append(
        "maintainAspectRatio",
        String(settings.maintainAspectRatio),
      );

      const response = await fetch(`${API}/api/images/upscale`, {
        method: "POST",
        body: form,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Check if another request or file replacement occurred while in-flight
      if (activeProcessingIdRef.current !== currentProcId) {
        return;
      }

      if (!response.ok) {
        const errorMsg = await parseApiError(response);
        throw new Error(errorMsg);
      }

      const data = await response.json();

      if (activeProcessingIdRef.current !== currentProcId) {
        return;
      }

      if (!data || !data.dataUrl) {
        throw new Error(
          "The server returned an incomplete response with no preview image data.",
        );
      }

      setResult({
        ...data,
        dataUrl: data.dataUrl,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (activeProcessingIdRef.current !== currentProcId) {
        return;
      }
      if (err.name === "AbortError") {
        if (err.message && err.message.includes("timed out")) {
          setError(err.message);
        }
        return;
      }
      if (err.name === "TypeError" && (err.message?.toLowerCase().includes("fetch") || err.message?.toLowerCase().includes("network"))) {
        setError("Could not connect to the backend server. Please verify the Spring Boot service is running on port 8808.");
      } else {
        setError(err.message || "An unexpected error occurred during processing.");
      }
    } finally {
      clearTimeout(timeoutId);
      if (activeProcessingIdRef.current === currentProcId) {
        setBusy(false);
      }
    }
  }

  async function downloadImage() {
    if (!result?.dataUrl || downloading) return;

    try {
      setDownloading(true);
      const blob = dataUrlToBlob(result.dataUrl);
      const baseName = sanitizeFilename(file?.name || "upscaled");
      const ext = getExtensionForFormat(result.outputFormat || settings.outputFormat);
      const outW = result.targetWidth || settings.targetWidth;
      const outH = result.targetHeight || settings.targetHeight;
      const filename = `${baseName}_upscaled_${outW}x${outH}${ext}`;

      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
      }, 1500);
    } catch (err) {
      console.error("Download failed:", err);
      setError("Failed to create download file. Please try processing the image again.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-icon">P</span>
          <span>
            PixelPerfect
            <small>IMAGE RESIZER &amp; PRINT TOOL</small>
          </span>
        </a>
        <div className="free-badge">
          <span /> FREE · NO AI
        </div>
      </header>

      <section className="hero">
        <div className="eyebrow">
          <span className="eyebrow-dot" /> DETERMINISTIC IMAGE PROCESSING
        </div>
        <h1>
          Bigger images.
          <br />
          <span>Natural quality.</span>
        </h1>
        <p>
          Resize images, calculate precise print dimensions (A4, A3, Letter, custom cm/in),
          and export in your preferred format. No AI filters or color alteration.
        </p>
      </section>

      <div className="workspace">
        <section className="panel upload-panel">
          <div className="panel-heading">
            <div>
              <span className="step-label">STEP 01</span>
              <h2>Your image</h2>
            </div>
            {file && (
              <div className="preview-actions">
                <button
                  type="button"
                  className="text-button"
                  onClick={handleReplaceImage}
                  disabled={busy}
                  title="Choose a different image"
                >
                  Replace image
                </button>
                <button
                  type="button"
                  className="text-button text-button-danger"
                  onClick={handleRemoveImage}
                  disabled={busy}
                  title="Clear selected image and results"
                >
                  Remove
                </button>
              </div>
            )}
          </div>

          <input
            ref={inputRef}
            type="file"
            accept="image/*,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff"
            hidden
            onChange={(event) => chooseFile(event.target.files?.[0])}
          />

          {!file ? (
            <div
              className={`dropzone ${dragging ? "dragging" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                if (!busy) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                if (!busy) chooseFile(event.dataTransfer.files?.[0]);
              }}
              onClick={() => {
                if (!busy) inputRef.current?.click();
              }}
              onKeyDown={(event) => {
                if (!busy && (event.key === "Enter" || event.key === " ")) {
                  inputRef.current?.click();
                }
              }}
              role="button"
              tabIndex={0}
              aria-label="Upload image area. Click or drag and drop an image file here."
            >
              <div className="upload-icon">↑</div>
              <h3>Drop your image here</h3>
              <p>or click to browse files on your device</p>
              <span className="outline-button">Choose image</span>
              <small>Supported formats: PNG, JPEG, WebP, BMP, TIFF (Max 50MB · Min 16×16 px)</small>
            </div>
          ) : (
            <div className="preview-card">
              {result && (
                <div className="preview-mode-bar" role="tablist" aria-label="Preview display modes">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={previewMode === "slider"}
                    className={`preview-mode-btn ${previewMode === "slider" ? "active" : ""}`}
                    onClick={() => setPreviewMode("slider")}
                  >
                    ↔ Before / After
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={previewMode === "processed"}
                    className={`preview-mode-btn ${previewMode === "processed" ? "active" : ""}`}
                    onClick={() => setPreviewMode("processed")}
                  >
                    Processed Output ({result.targetWidth} × {result.targetHeight})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={previewMode === "original"}
                    className={`preview-mode-btn ${previewMode === "original" ? "active" : ""}`}
                    onClick={() => setPreviewMode("original")}
                  >
                    Original Input ({dimensions.width} × {dimensions.height})
                  </button>
                </div>
              )}

              {result && previewMode === "slider" ? (
                <ImageComparisonSlider
                  originalSrc={preview}
                  processedSrc={result.dataUrl}
                  originalDimensions={dimensions}
                  processedDimensions={{
                    width: result.targetWidth,
                    height: result.targetHeight,
                  }}
                />
              ) : result && previewMode === "processed" ? (
                <div className="preview-image">
                  <img src={result.dataUrl} alt="Processed output preview" />
                </div>
              ) : (
                <div className="preview-image">
                  <img src={preview} alt="Original image preview" />
                </div>
              )}

              <div className="file-details">
                <div className="file-name">{file.name}</div>
                <div className="file-meta">
                  {file.size >= 1048576
                    ? `${(file.size / 1048576).toFixed(2)} MB`
                    : `${(file.size / 1024).toFixed(1)} KB`}
                  {dimensions.width > 0 && ` · ${dimensions.width} × ${dimensions.height} px`}
                  {dimensions.width > 0 && ` · Aspect: ${getAspectRatioLabel(dimensions.width, dimensions.height)}`}
                  {file.type ? ` · ${file.type.replace("image/", "").toUpperCase()}` : ""}
                  {result && " · Processed"}
                </div>
              </div>
            </div>
          )}

          {file && (
            <div className="image-info">
              <div>
                <span>Original file</span>
                <strong>{file.type ? file.type.replace("image/", "").toUpperCase() : (file.name ? file.name.split(".").pop().toUpperCase() : "Unknown")}</strong>
              </div>
              <div>
                <span>Original resolution</span>
                <strong>{dimensions.width > 0 ? `${dimensions.width} × ${dimensions.height} px` : "Reading..."}</strong>
              </div>
              <div>
                <span>Aspect ratio</span>
                <strong>{getAspectRatioLabel(dimensions.width, dimensions.height)}</strong>
              </div>
              <div>
                <span>Target resolution</span>
                <strong>{settings.targetWidth} × {settings.targetHeight} px</strong>
              </div>
            </div>
          )}

          {result && (
            <div className="result-metrics-card">
              <div className="result-metrics-heading">
                <span>✓ Processing Completed Successfully</span>
                {result.processingDurationMs !== undefined && (
                  <span>{result.processingDurationMs} ms</span>
                )}
              </div>
              <div className="result-metrics-grid">
                <div className="result-metric-item">
                  <span>Input Dimensions</span>
                  <strong>{dimensions.width} × {dimensions.height} px</strong>
                </div>
                <div className="result-metric-item">
                  <span>Output Dimensions</span>
                  <strong>{result.targetWidth} × {result.targetHeight} px</strong>
                </div>
                <div className="result-metric-item">
                  <span>Scale Factor</span>
                  <strong>
                    {dimensions.width > 0
                      ? `${(result.targetWidth / dimensions.width).toFixed(2).replace(/\.00$/, "")}×`
                      : `${settings.scaleFactor}×`}
                  </strong>
                </div>
                <div className="result-metric-item">
                  <span>Output Format &amp; DPI</span>
                  <strong>{result.outputFormat || settings.outputFormat} · {result.dpi || settings.dpi} DPI</strong>
                </div>
                <div className="result-metric-item result-metric-full">
                  <span>DPI Metadata Verification</span>
                  <strong>{getDpiSupportNote(result.outputFormat || settings.outputFormat)}</strong>
                </div>
                {result.outputSizeBytes > 0 && (
                  <div className="result-metric-item">
                    <span>Output File Size</span>
                    <strong>
                      {result.outputSizeBytes >= 1048576
                        ? `${(result.outputSizeBytes / 1048576).toFixed(2)} MB`
                        : `${(result.outputSizeBytes / 1024).toFixed(1)} KB`}
                    </strong>
                  </div>
                )}
                {file.size > 0 && (
                  <div className="result-metric-item">
                    <span>Original File Size</span>
                    <strong>
                      {file.size >= 1048576
                        ? `${(file.size / 1048576).toFixed(2)} MB`
                        : `${(file.size / 1024).toFixed(1)} KB`}
                    </strong>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="panel settings-panel">
          <div className="panel-heading">
            <div>
              <span className="step-label">STEP 02</span>
              <h2>Output settings</h2>
            </div>
          </div>

          {/* Sizing Method Selector (3 Clear Modes) */}
          <label className="field-label">Sizing method</label>
          <div className="mode-tabs">
            <button
              className={`mode-tab ${sizingMode === "factor" ? "active" : ""}`}
              onClick={() => {
                setSizingMode("factor");
                changeScale(settings.scaleFactor || "2");
              }}
              disabled={busy}
              type="button"
            >
              <span>Scale Factor</span>
            </button>
            <button
              className={`mode-tab ${sizingMode === "custom" ? "active" : ""}`}
              onClick={() => setSizingMode("custom")}
              disabled={busy}
              type="button"
            >
              <span>Custom Pixels</span>
            </button>
            <button
              className={`mode-tab ${sizingMode === "print" ? "active" : ""}`}
              onClick={() => setSizingMode("print")}
              disabled={busy}
              type="button"
            >
              <span>🖨️ Print Calculator</span>
            </button>
          </div>

          {/* Mode 1: Scale Multiplier Options (1x, 2x, 4x, 8x) */}
          {sizingMode === "factor" && (
            <>
              <label className="field-label">Resize multiplier</label>
              <div className="scale-options">
                {[
                  { value: "1", label: "1×", desc: "Original (100%)" },
                  { value: "2", label: "2×", desc: "Double (200%)" },
                  { value: "4", label: "4×", desc: "Quadruple (400%)" },
                  { value: "8", label: "8×", desc: "Max (800%)" },
                ].map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={`scale-option ${settings.scaleFactor === item.value ? "selected" : ""}`}
                    onClick={() => changeScale(item.value)}
                    disabled={busy}
                  >
                    <strong>{item.label}</strong>
                    <span>{item.desc}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Mode 2: Custom Dimensions with Aspect Ratio Lock */}
          {sizingMode === "custom" && (
            <div className="custom-dim-section">
              <label className="field-label" style={{ marginBottom: "12px" }}>Custom Pixel Dimensions</label>
              <div className="custom-dim-grid">
                <label>
                  Width (px)
                  <input
                    type="number"
                    min="16"
                    max="8192"
                    value={settings.targetWidth}
                    disabled={busy}
                    onChange={(e) => handleCustomWidthChange(e.target.value)}
                  />
                </label>

                <button
                  type="button"
                  className={`aspect-lock-btn ${aspectRatioLocked ? "locked" : "unlocked"}`}
                  onClick={() => setAspectRatioLocked(!aspectRatioLocked)}
                  disabled={busy}
                  aria-pressed={aspectRatioLocked}
                  aria-label={aspectRatioLocked ? "Aspect ratio locked. Click to unlock." : "Aspect ratio unlocked. Click to lock."}
                  title={aspectRatioLocked ? "Aspect ratio locked (proportional changes)" : "Aspect ratio unlocked (independent changes)"}
                >
                  <span className="lock-icon">{aspectRatioLocked ? "🔒" : "🔓"}</span>
                  <span className="lock-text">{aspectRatioLocked ? "Locked" : "Unlocked"}</span>
                </button>

                <label>
                  Height (px)
                  <input
                    type="number"
                    min="16"
                    max="8192"
                    value={settings.targetHeight}
                    disabled={busy}
                    onChange={(e) => handleCustomHeightChange(e.target.value)}
                  />
                </label>
              </div>

              <div className="custom-dim-hints">
                <span>
                  {aspectRatioLocked ? "Proportional sizing active" : "Independent width & height editing"}
                  {dimensions.width > 0 && ` · Aspect: ${getAspectRatioLabel(dimensions.width, dimensions.height)}`}
                </span>
                {dimensions.width > 0 && (
                  <button
                    type="button"
                    className="reset-dim-btn"
                    onClick={resetToOriginalDimensions}
                    disabled={busy}
                  >
                    Reset to 1× ({dimensions.width} × {dimensions.height})
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Mode 3: Print Size Calculator */}
          {sizingMode === "print" && (
            <div className="print-section">
              <div className="field-row">
                <label>
                  Print standard preset
                  <select
                    value={printPreset}
                    disabled={busy}
                    onChange={(e) => setPrintPreset(e.target.value)}
                  >
                    <option value="A4">A4 (21.0 × 29.7 cm)</option>
                    <option value="A3">A3 (29.7 × 42.0 cm)</option>
                    <option value="A5">A5 (14.8 × 21.0 cm)</option>
                    <option value="LETTER">Letter (8.5 × 11 in / 21.6 × 27.9 cm)</option>
                    <option value="LEGAL">Legal (8.5 × 14 in / 21.6 × 35.6 cm)</option>
                    <option value="CUSTOM">Custom Dimensions (cm / in)</option>
                  </select>
                </label>

                {printPreset !== "CUSTOM" && (
                  <label>
                    Orientation
                    <div className="orientation-toggle">
                      <button
                        type="button"
                        className={`orientation-btn ${orientation === "portrait" ? "selected" : ""}`}
                        onClick={() => setOrientation("portrait")}
                        disabled={busy}
                      >
                        ↕ Portrait
                      </button>
                      <button
                        type="button"
                        className={`orientation-btn ${orientation === "landscape" ? "selected" : ""}`}
                        onClick={() => setOrientation("landscape")}
                        disabled={busy}
                      >
                        ↔ Landscape
                      </button>
                    </div>
                  </label>
                )}
              </div>

              {printPreset === "CUSTOM" && (
                <div className="custom-print-box">
                  <div className="custom-unit-bar">
                    <span className="field-label" style={{ margin: 0 }}>Custom dimensions:</span>
                    <div className="unit-toggle">
                      <button
                        type="button"
                        className={`unit-btn ${customUnit === "cm" ? "active" : ""}`}
                        onClick={() => setCustomUnit("cm")}
                        disabled={busy}
                      >
                        cm
                      </button>
                      <button
                        type="button"
                        className={`unit-btn ${customUnit === "in" ? "active" : ""}`}
                        onClick={() => setCustomUnit("in")}
                        disabled={busy}
                      >
                        inches
                      </button>
                    </div>
                  </div>

                  <div className="field-row" style={{ marginTop: "10px" }}>
                    <label>
                      Width ({customUnit})
                      <input
                        type="number"
                        step="0.1"
                        min="1"
                        value={customWidth}
                        disabled={busy}
                        onChange={(e) => setCustomWidth(e.target.value)}
                      />
                    </label>
                    <label>
                      Height ({customUnit})
                      <input
                        type="number"
                        step="0.1"
                        min="1"
                        value={customHeight}
                        disabled={busy}
                        onChange={(e) => setCustomHeight(e.target.value)}
                      />
                    </label>
                  </div>
                </div>
              )}

              {calculatedPrintPx && (
                <div className="calculated-px-card">
                  <div>
                    <div className="calc-label">Calculated Output Pixels ({settings.dpi} DPI)</div>
                    <div className="calc-preset-name">
                      {printPreset === "CUSTOM"
                        ? `Custom ${customWidth} × ${customHeight} ${customUnit}`
                        : `${PRESET_METADATA[printPreset]?.name || printPreset} · ${orientation === "portrait" ? "Portrait" : "Landscape"} (${orientation === "landscape" ? (PRESET_METADATA[printPreset]?.hMm / 10).toFixed(1) + " × " + (PRESET_METADATA[printPreset]?.wMm / 10).toFixed(1) + " cm" : PRESET_METADATA[printPreset]?.cm || ""})`}
                    </div>
                  </div>
                  <div className="calc-value">
                    {calculatedPrintPx.width} × {calculatedPrintPx.height} px
                  </div>
                </div>
              )}

              {printCalcError && (
                <div className="limit-warning">
                  <span className="warning-icon">⚠️</span>
                  <div>{printCalcError}</div>
                </div>
              )}
            </div>
          )}

          {/* Dimension Fitting Mode (Preserve Aspect vs Exact Dimensions) */}
          <div className="fit-mode-section">
            <label className="field-label">Dimension Fitting Mode</label>
            <div className="fit-mode-options">
              <button
                type="button"
                className={`fit-mode-card ${settings.maintainAspectRatio ? "selected" : ""}`}
                onClick={() => updateSetting("maintainAspectRatio", true)}
                disabled={busy}
                aria-pressed={settings.maintainAspectRatio}
              >
                <div className="fit-mode-title">
                  <span className="fit-mode-indicator">{settings.maintainAspectRatio ? "●" : "○"}</span>
                  <strong>Fit within target box</strong>
                </div>
                <p>
                  Preserves original aspect ratio without distortion. Output fits inside target dimensions and may be smaller on one edge.
                </p>
              </button>
              <button
                type="button"
                className={`fit-mode-card ${!settings.maintainAspectRatio ? "selected" : ""}`}
                onClick={() => updateSetting("maintainAspectRatio", false)}
                disabled={busy}
                aria-pressed={!settings.maintainAspectRatio}
              >
                <div className="fit-mode-title">
                  <span className="fit-mode-indicator">{!settings.maintainAspectRatio ? "●" : "○"}</span>
                  <strong>Exact requested dimensions</strong>
                </div>
                <p>
                  Produces exact target width &amp; height. If aspect ratio differs from the original, the image will stretch to fill.
                </p>
              </button>
            </div>
          </div>

          {/* Planned Output Dimension Preview */}
          {effectiveOutput && (
            <div className="output-summary-card">
              <div className="output-summary-header">
                <span className="output-summary-title">Planned Output Resolution</span>
                <span className="output-summary-badge">
                  {settings.maintainAspectRatio ? "PROPORTIONAL FIT" : "EXACT SIZE"}
                </span>
              </div>
              <div className="output-summary-grid">
                <div className="output-summary-item">
                  <span>Target Box</span>
                  <strong>{settings.targetWidth} × {settings.targetHeight} px</strong>
                </div>
                <div className="output-summary-item">
                  <span>Final Output</span>
                  <strong>{effectiveOutput.width} × {effectiveOutput.height} px</strong>
                </div>
                <div className="output-summary-item">
                  <span>Effective Scale</span>
                  <strong>
                    {dimensions.width > 0
                      ? `${(effectiveOutput.width / dimensions.width).toFixed(2).replace(/\.00$/, "")}×`
                      : `${settings.scaleFactor}×`}
                  </strong>
                </div>
              </div>
            </div>
          )}

          {dimensionWarning && (
            <div className="limit-warning" style={{ marginBottom: "16px" }}>
              <span className="warning-icon">⚠️</span>
              <div>{dimensionWarning}</div>
            </div>
          )}

          <div className="divider" />

          <div className="field-row">
            <label>
              Output format
              <select
                value={settings.outputFormat}
                disabled={busy}
                onChange={(event) =>
                  updateSetting("outputFormat", event.target.value)
                }
              >
                {supportedFormats.map((format) => (
                  <option key={format} value={format}>
                    {format}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Print DPI
              <select
                value={settings.dpi}
                disabled={busy}
                onChange={(event) =>
                  updateSetting("dpi", event.target.value)
                }
              >
                <option value="72">72 DPI · Screen</option>
                <option value="96">96 DPI · Web</option>
                <option value="150">150 DPI · Draft Print</option>
                <option value="300">300 DPI · High Quality Print</option>
                <option value="600">600 DPI · Ultra Fine</option>
              </select>
            </label>
          </div>

          {(settings.outputFormat === "JPEG" ||
            settings.outputFormat === "WEBP") && (
            <label className="quality-control">
              <span>
                Compression quality <strong>{settings.quality}%</strong>
              </span>
              <input
                type="range"
                min="50"
                max="100"
                step="5"
                value={settings.quality}
                disabled={busy}
                onChange={(event) =>
                  updateSetting("quality", Number(event.target.value))
                }
              />
            </label>
          )}

          <div className="processing-note">
            <span className="note-icon">i</span>
            <p>
              Uses deterministic bicubic resampling with embedded DPI metadata. Output dimensions are capped between 16 × 16 px and 8192 × 8192 pixels.
            </p>
          </div>

          {error && (
            <div className="error-message" role="alert" aria-live="assertive">
              <span className="error-icon" aria-hidden="true">✕</span>
              <div>{error}</div>
            </div>
          )}

          <button
            type="button"
            className="primary-button"
            onClick={processImage}
            disabled={!file || busy || isInvalidDimensions}
            aria-busy={busy}
            title={
              !file
                ? "Select or upload an image first"
                : isInvalidDimensions
                  ? dimensionWarning
                  : busy
                    ? "Image processing in progress..."
                    : "Resize image with current settings"
            }
          >
            {busy ? (
              <>
                <span className="spinner" aria-hidden="true" />
                <span aria-live="polite">Processing image...</span>
              </>
            ) : isInvalidDimensions ? (
              <>Adjust Dimensions to Continue</>
            ) : (
              <>Resize image <span aria-hidden="true">→</span></>
            )}
          </button>

          {result && (
            <button
              type="button"
              className="download-button"
              onClick={downloadImage}
              disabled={downloading}
              aria-busy={downloading}
              title={downloading ? "Preparing your download..." : `Download ${result.outputFormat} file`}
            >
              {downloading ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Preparing download...
                </>
              ) : (
                <>↓ Download processed image ({result.outputFormat})</>
              )}
            </button>
          )}
        </section>
      </div>

      <footer className="footer">
        <span>PIXEL PERFECT</span>
        <span>Free image processing · No AI enhancement · Max 8192 × 8192 px</span>
      </footer>
    </main>
  );
}

export default App;
