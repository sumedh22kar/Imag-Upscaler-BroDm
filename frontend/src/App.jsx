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

function App() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [result, setResult] = useState(null);
  const [settings, setSettings] = useState(initialSettings);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  // Sizing mode & Print size calculator state
  const [sizingMode, setSizingMode] = useState("factor"); // "factor" | "print"
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
    };
  }, [preview]);

  function updateSetting(key, value) {
    setSettings((old) => ({ ...old, [key]: value }));
    setResult(null);
    setError("");
  }

  function chooseFile(selected) {
    if (!selected) return;

    if (!selected.type.startsWith("image/")) {
      setError("Please select a supported image file.");
      return;
    }

    setError("");
    setResult(null);
    setFile(selected);

    const blobUrl = URL.createObjectURL(selected);
    setPreview((old) => {
      if (old.startsWith("blob:")) URL.revokeObjectURL(old);
      return blobUrl;
    });

    const image = new Image();
    image.onload = () => {
      const origW = image.naturalWidth;
      const origH = image.naturalHeight;
      setDimensions({ width: origW, height: origH });

      if (sizingMode === "factor") {
        const scale = Number(settings.scaleFactor) || 2;
        const newW = Math.min(8192, Math.max(16, Math.round(origW * scale)));
        const newH = Math.min(8192, Math.max(16, Math.round(origH * scale)));
        setSettings((old) => ({
          ...old,
          targetWidth: String(newW),
          targetHeight: String(newH),
        }));
      }
    };
    image.src = blobUrl;
  }

  function changeScale(value) {
    const scale = Number(value);
    setSizingMode("factor");
    updateSetting("scaleFactor", value);

    const baseW = dimensions.width > 0 ? dimensions.width : 1240;
    const baseH = dimensions.height > 0 ? dimensions.height : 1754;
    const newW = Math.min(8192, Math.max(16, Math.round(baseW * scale)));
    const newH = Math.min(8192, Math.max(16, Math.round(baseH * scale)));

    setSettings((old) => ({
      ...old,
      scaleFactor: value,
      targetWidth: String(newW),
      targetHeight: String(newH),
    }));
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

  async function processImage() {
    if (!file) {
      setError("Upload an image first.");
      return;
    }

    const targetW = Number(settings.targetWidth);
    const targetH = Number(settings.targetHeight);

    if (!targetW || !targetH || targetW < 16 || targetH < 16) {
      setError("Width and height must both be at least 16 pixels.");
      return;
    }

    if (targetW > 8192 || targetH > 8192) {
      setError(
        `Target dimensions (${targetW} × ${targetH} px) exceed the maximum allowable resolution of 8192 × 8192 px. Please adjust dimensions or lower DPI.`
      );
      return;
    }

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
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        let message = body?.message || body?.error || `Processing failed (HTTP ${response.status}).`;

        // Unpack field-specific validation errors if available
        if (body?.validationErrors) {
          const fieldMsgs = Object.values(body.validationErrors).flat();
          if (fieldMsgs.length > 0) {
            message = fieldMsgs.join(". ");
          }
        }
        throw new Error(message);
      }

      const data = await response.json();

      if (!data.dataUrl) {
        throw new Error(
          "The server returned no preview image. Check the API response format.",
        );
      }

      setResult({
        ...data,
        dataUrl: data.dataUrl,
      });
    } catch (err) {
      if (err.name === "TypeError" && err.message?.toLowerCase().includes("fetch")) {
        setError("Could not connect to backend. Make sure the Spring Boot server is running on port 8808.");
      } else {
        setError(err.message || "An unexpected error occurred during processing.");
      }
    } finally {
      setBusy(false);
    }
  }

  function downloadImage() {
    if (!result?.dataUrl) return;

    const link = document.createElement("a");
    link.href = result.dataUrl;
    link.download = `upscaled-image.${settings.outputFormat.toLowerCase()}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  const activePreview = result?.dataUrl || preview;
  const isOversized = Number(settings.targetWidth) > 8192 || Number(settings.targetHeight) > 8192;

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
              <button
                className="text-button"
                onClick={() => {
                  setFile(null);
                  setResult(null);
                  setDimensions({ width: 0, height: 0 });
                  setPreview((old) => {
                    if (old.startsWith("blob:")) URL.revokeObjectURL(old);
                    return "";
                  });
                  setError("");
                }}
              >
                Remove image
              </button>
            )}
          </div>

          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => chooseFile(event.target.files?.[0])}
          />

          {!file ? (
            <div
              className={`dropzone ${dragging ? "dragging" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                chooseFile(event.dataTransfer.files?.[0]);
              }}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  inputRef.current?.click();
                }
              }}
              role="button"
              tabIndex={0}
            >
              <div className="upload-icon">↑</div>
              <h3>Drop your image here</h3>
              <p>or browse files on your device</p>
              <span className="outline-button">Choose image</span>
              <small>JPG · PNG · WebP · BMP · Other supported formats</small>
            </div>
          ) : (
            <div className="preview-card">
              <div className="preview-image">
                <img src={activePreview} alt="Image preview" />
              </div>
              <div className="file-details">
                <div className="file-name">{file.name}</div>
                <div className="file-meta">
                  {(file.size / 1024).toFixed(1)} KB
                  {dimensions.width > 0 && ` · ${dimensions.width} × ${dimensions.height} px`}
                  {result && " · Processed"}
                </div>
              </div>
            </div>
          )}

          {file && (
            <div className="image-info">
              <div>
                <span>Original file</span>
                <strong>{file.type || "Unknown format"}</strong>
              </div>
              <div>
                <span>Original resolution</span>
                <strong>{dimensions.width > 0 ? `${dimensions.width} × ${dimensions.height} px` : "Reading..."}</strong>
              </div>
              <div>
                <span>Output format</span>
                <strong>{settings.outputFormat}</strong>
              </div>
              <div>
                <span>Target resolution</span>
                <strong>{settings.targetWidth} × {settings.targetHeight} px</strong>
              </div>
            </div>
          )}

          {result && (
            <div className="success-message">
              ✓ Processing complete ({result.processingDurationMs}ms). Output: {result.targetWidth} × {result.targetHeight} px ({result.outputFormat}, {result.dpi} DPI).
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

          {/* Sizing Mode Tabs */}
          <label className="field-label">Sizing method</label>
          <div className="mode-tabs">
            <button
              className={`mode-tab ${sizingMode === "factor" ? "active" : ""}`}
              onClick={() => setSizingMode("factor")}
              type="button"
            >
              <span>Multiplier (1×, 2×, 4×)</span>
            </button>
            <button
              className={`mode-tab ${sizingMode === "print" ? "active" : ""}`}
              onClick={() => setSizingMode("print")}
              type="button"
            >
              <span>🖨️ Print Size Calculator</span>
            </button>
          </div>

          {sizingMode === "factor" ? (
            <>
              <label className="field-label">Resize factor</label>
              <div className="scale-options">
                {["1", "2", "4"].map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`scale-option ${
                      settings.scaleFactor === value ? "selected" : ""
                    }`}
                    onClick={() => changeScale(value)}
                  >
                    <strong>{value}×</strong>
                    <span>
                      {value === "1"
                        ? "Original"
                        : value === "2"
                          ? "Double size"
                          : "Quadruple"}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="print-section">
              <div className="field-row">
                <label>
                  Print standard preset
                  <select
                    value={printPreset}
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
                      >
                        ↕ Portrait
                      </button>
                      <button
                        type="button"
                        className={`orientation-btn ${orientation === "landscape" ? "selected" : ""}`}
                        onClick={() => setOrientation("landscape")}
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
                      >
                        cm
                      </button>
                      <button
                        type="button"
                        className={`unit-btn ${customUnit === "in" ? "active" : ""}`}
                        onClick={() => setCustomUnit("in")}
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
                        : `${printPreset} ${orientation}`}
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

          <div className="field-row">
            <label>
              Width (px)
              <input
                type="number"
                min="16"
                max="8192"
                value={settings.targetWidth}
                onChange={(event) =>
                  updateSetting("targetWidth", event.target.value)
                }
              />
            </label>
            <label>
              Height (px)
              <input
                type="number"
                min="16"
                max="8192"
                value={settings.targetHeight}
                onChange={(event) =>
                  updateSetting("targetHeight", event.target.value)
                }
              />
            </label>
          </div>

          {isOversized && (
            <div className="limit-warning" style={{ marginBottom: "16px" }}>
              <span className="warning-icon">⚠️</span>
              <div>
                Dimensions exceed the backend limit of 8192 × 8192 pixels. Please adjust values before resizing.
              </div>
            </div>
          )}

          <label className="check-row">
            <input
              type="checkbox"
              checked={settings.maintainAspectRatio}
              onChange={(event) =>
                updateSetting("maintainAspectRatio", event.target.checked)
              }
            />
            <span>
              <strong>Maintain aspect ratio</strong>
              <small>Prevent distortion by fitting within target bounds</small>
            </span>
          </label>

          <div className="divider" />

          <div className="field-row">
            <label>
              Output format
              <select
                value={settings.outputFormat}
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
                onChange={(event) =>
                  updateSetting("quality", Number(event.target.value))
                }
              />
            </label>
          )}

          <div className="processing-note">
            <span className="note-icon">i</span>
            <p>
              Uses deterministic bicubic resampling with embedded DPI metadata. Output dimensions are currently capped at 8192 × 8192 pixels.
            </p>
          </div>

          {error && <div className="error-message">{error}</div>}

          <button
            className="primary-button"
            onClick={processImage}
            disabled={!file || busy || isOversized}
          >
            {busy ? (
              <>
                <span className="spinner" /> Processing image...
              </>
            ) : isOversized ? (
              <>Dimensions Exceed 8192px Cap</>
            ) : (
              <>Resize image <span>→</span></>
            )}
          </button>

          {result && (
            <button className="download-button" onClick={downloadImage}>
              ↓ Download processed image ({result.outputFormat})
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
