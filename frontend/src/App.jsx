import { useEffect, useRef, useState } from "react";
import "./App.css";
import { API, OFFLINE_MESSAGE, parseApiError } from "./lib/api.js";
import {
  AI_MAX_LONG_SIDE,
  DPI_CHOICES,
  MAX_SIDE,
  MAX_UPLOAD_BYTES,
  MIN_SIDE,
  PAPERS,
  aspectLabel,
  computeCrop,
  extensionFor,
  fitWithin,
  formatBytes,
  formatOutputFilename,
  getPaperMm,
  isCropNeeded,
  maxDpiForPaper,
  paperToPixels,
  safeBaseName,
  sourceDensity,
} from "./lib/print.js";
import {
  dataUrlToBlob,
  decodeImage,
  hasExifRotation,
  isSupportedFile,
  isTiff,
  readTiffSize,
  renderCrop,
} from "./lib/image.js";
import Segmented from "./components/Segmented.jsx";
import SheetPreview from "./components/SheetPreview.jsx";
import CompareSlider from "./components/CompareSlider.jsx";
import QualityMeter from "./components/QualityMeter.jsx";

const SIZE_MODES = [
  { value: "paper", label: "Paper" },
  { value: "pixels", label: "Pixels" },
  { value: "scale", label: "Scale" },
];

const PAPER_OPTIONS = [
  ...Object.entries(PAPERS).map(([value, p]) => ({ value, label: p.label })),
  { value: "CUSTOM", label: "Custom" },
];

const ORIENTATIONS = [
  { value: "portrait", label: "Portrait" },
  { value: "landscape", label: "Landscape" },
];

const UNITS = [
  { value: "cm", label: "cm" },
  { value: "in", label: "in" },
];

const SCALES = [1, 2, 4, 8];

const METHODS = [
  { value: "bicubic", label: "Bicubic", note: "Fast and smooth. Good for modest enlargements." },
  { value: "classic_pro", label: "Lanczos", note: "Keeps edges crisper. Good for graphics and text." },
  {
    value: "ai_pro",
    label: "AI (Real-ESRGAN)",
    note: `Rebuilds fine detail in photos. Slower, accepts images up to ${AI_MAX_LONG_SIDE} px, and the server must have the AI engine enabled.`,
  },
];

const FORMAT_NOTES = {
  PNG: "Lossless. Larger files.",
  JPEG: "Smallest files. No transparency.",
  WEBP: "Small files. Not every print shop accepts it.",
  BMP: "Uncompressed and very large. Carries no print size.",
  TIFF: "Print-shop standard. Browsers can't preview it.",
};

const DEFAULT_FORMATS = ["PNG", "JPEG", "WEBP", "BMP", "TIFF"];
const BLANK = { w: 0, h: 0 };

const inches = (mm) => (mm / 25.4).toFixed(1);
const cm = (mm) => (mm / 10).toFixed(1);

export default function App() {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [src, setSrc] = useState(BLANK);
  const [previewable, setPreviewable] = useState(true);
  const [exifRotated, setExifRotated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [mode, setMode] = useState("paper");
  const [paper, setPaper] = useState({ preset: "A4", orientation: "portrait", unit: "cm", w: "20", h: "30" });
  const [px, setPx] = useState({ w: "", h: "", lock: true });
  const [scale, setScale] = useState(2);
  const [dpi, setDpi] = useState(300);
  const [fit, setFit] = useState("fit");
  const [focus, setFocus] = useState({ x: 0.5, y: 0.5 });
  const [model, setModel] = useState("bicubic");
  const [format, setFormat] = useState("PNG");
  const [quality, setQuality] = useState(95);
  const [formats, setFormats] = useState(DEFAULT_FORMATS);

  const [server, setServer] = useState("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [view, setView] = useState("compare");

  const inputRef = useRef(null);
  const urlRef = useRef("");
  const loadId = useRef(0);
  const runId = useRef(0);
  const abortRef = useRef(null);

  /* ---------- server ---------- */

  const [probeTick, setProbeTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/api/images/config`)
      .then((res) => {
        if (!res.ok) throw new Error("config");
        return res.json();
      })
      .then((cfg) => {
        if (cancelled) return;
        setServer("up");
        if (Array.isArray(cfg.supportedFormats) && cfg.supportedFormats.length) {
          setFormats(cfg.supportedFormats);
          setFormat((old) => (cfg.supportedFormats.includes(old) ? old : cfg.supportedFormats[0]));
        }
      })
      .catch(() => {
        if (!cancelled) setServer("down");
      });
    return () => {
      cancelled = true;
    };
  }, [probeTick]);

  function retryServer() {
    setServer("checking");
    setProbeTick((n) => n + 1);
  }

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  /* ---------- derived print maths ---------- */

  const hasSrc = src.w > 0 && src.h > 0;
  const paperMm = getPaperMm({
    preset: paper.preset,
    orientation: paper.orientation,
    unit: paper.unit,
    customW: paper.w,
    customH: paper.h,
  });

  let box = null;
  if (mode === "paper") {
    box = paperToPixels(paperMm, dpi);
  } else if (mode === "pixels") {
    const w = Math.round(Number(px.w));
    const h = Math.round(Number(px.h));
    if (w > 0 && h > 0) box = { w, h };
  }

  const effFit = mode === "scale" || !previewable ? "fit" : fit;

  let out = null;
  let used = null;
  let crop = null;
  if (hasSrc) {
    if (mode === "scale") {
      out = { w: Math.round(src.w * scale), h: Math.round(src.h * scale) };
      used = src;
    } else if (box) {
      if (effFit === "fill") {
        crop = computeCrop(src.w, src.h, box.w, box.h, focus.x, focus.y);
        out = box;
        used = { w: crop.w, h: crop.h };
      } else {
        out = fitWithin(src.w, src.h, box.w, box.h);
        used = src;
      }
    }
  }

  const density = out && used ? sourceDensity(used.w, used.h, out.w, out.h, dpi) : null;

  const sheetRatio = box ? box.w / box.h : mode === "scale" && hasSrc ? src.w / src.h : 3 / 4;

  /* ---------- blocking problems ---------- */

  let problem = "";
  let fixDpi = null;
  if (mode === "paper" && !paperMm) {
    problem = "Enter a width and a height greater than zero.";
  } else if (mode === "pixels" && !box) {
    problem = "Enter a width and a height in pixels.";
  } else if (box || out) {
    const tooSmall = (box && (box.w < MIN_SIDE || box.h < MIN_SIDE)) || (out && (out.w < MIN_SIDE || out.h < MIN_SIDE));
    const tooBig = (box && (box.w > MAX_SIDE || box.h > MAX_SIDE)) || (out && (out.w > MAX_SIDE || out.h > MAX_SIDE));
    const dims = box || out;
    if (tooSmall) {
      problem = `${dims.w} × ${dims.h} px is below the ${MIN_SIDE} px minimum on one side.`;
    } else if (tooBig) {
      problem = `${dims.w} × ${dims.h} px is over the ${MAX_SIDE} px limit on one side.`;
      if (mode === "paper") {
        const ceiling = maxDpiForPaper(paperMm);
        const fits = [...DPI_CHOICES].reverse().find((d) => d.value <= ceiling);
        if (fits) {
          fixDpi = fits.value;
          problem += ` This sheet fits at ${fits.value} DPI or lower.`;
        } else {
          problem += " Choose a smaller sheet.";
        }
      } else if (mode === "scale") {
        problem += " Choose a smaller scale.";
      } else {
        problem += " Enter smaller dimensions.";
      }
    }
  }
  if (!problem && model === "ai_pro" && used && Math.max(used.w, used.h) > AI_MAX_LONG_SIDE) {
    problem = `AI works on images up to ${AI_MAX_LONG_SIDE} px on the longest side. This one is ${Math.max(used.w, used.h)} px. Switch to Lanczos or crop the image first.`;
  }

  /* ---------- result bookkeeping ---------- */

  const signature = JSON.stringify([
    file?.name,
    file?.size,
    mode,
    box,
    scale,
    dpi,
    effFit,
    effFit === "fill" ? crop : null,
    model,
    format,
    quality,
  ]);
  const activeResult = result && result.sig === signature ? result : null;
  const activeError = error && (error.sig === null || error.sig === signature) ? error.msg : "";
  const resultFormat = (activeResult?.data.outputFormat || format).toUpperCase();
  const outputPreviewable = resultFormat !== "TIFF";
  const canCompare = Boolean(activeResult && previewable && outputPreviewable);
  const showCompare = canCompare && view === "compare";

  /* ---------- file handling ---------- */

  function replaceUrl(next) {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = next;
    setPreviewUrl(next);
  }

  async function chooseFile(selected) {
    if (!selected) return;
    runId.current++;
    abortRef.current?.abort();
    setBusy(false);

    if (!isSupportedFile(selected)) {
      setError({ sig: null, msg: `${selected.name || "That file"} isn't a supported image. Use PNG, JPEG, WebP, BMP or TIFF.` });
      return;
    }
    if (selected.size > MAX_UPLOAD_BYTES) {
      setError({ sig: null, msg: `${selected.name} is ${formatBytes(selected.size)}. The upload limit is 50 MB.` });
      return;
    }

    const id = ++loadId.current;
    setError(null);
    setLoading(true);

    const url = URL.createObjectURL(selected);
    let size = null;
    let canPreview = true;
    try {
      const decoded = await decodeImage(url);
      size = { width: decoded.width, height: decoded.height };
    } catch {
      canPreview = false;
      if (isTiff(selected)) size = await readTiffSize(selected);
    }

    if (id !== loadId.current) {
      URL.revokeObjectURL(url);
      return;
    }
    if (!size) {
      URL.revokeObjectURL(url);
      setLoading(false);
      setError({ sig: null, msg: "This file couldn't be read. It may be damaged or saved in an unusual variant." });
      return;
    }
    if (size.width < MIN_SIDE || size.height < MIN_SIDE) {
      URL.revokeObjectURL(url);
      setLoading(false);
      setError({ sig: null, msg: `This image is ${size.width} × ${size.height} px. The minimum is ${MIN_SIDE} × ${MIN_SIDE} px.` });
      return;
    }

    const rotated = canPreview ? await hasExifRotation(selected, size.width, size.height) : false;
    if (id !== loadId.current) {
      URL.revokeObjectURL(url);
      return;
    }

    replaceUrl(url);
    setFile(selected);
    setSrc({ w: size.width, h: size.height });
    setPreviewable(canPreview);
    setExifRotated(rotated);
    setFocus({ x: 0.5, y: 0.5 });
    setResult(null);
    setView("compare");
    setPx({ w: String(size.width), h: String(size.height), lock: true });
    setPaper((p) => (p.preset === "CUSTOM" ? p : { ...p, orientation: size.width > size.height ? "landscape" : "portrait" }));
    setLoading(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  function removeImage() {
    runId.current++;
    loadId.current++;
    abortRef.current?.abort();
    replaceUrl("");
    setFile(null);
    setSrc(BLANK);
    setResult(null);
    setError(null);
    setBusy(false);
    setLoading(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  function openPicker() {
    if (!busy) inputRef.current?.click();
  }

  /* ---------- size controls ---------- */

  function changeUnit(next) {
    setPaper((p) => {
      if (p.unit === next) return p;
      const k = p.unit === "cm" ? 1 / 2.54 : 2.54;
      const convert = (v) => {
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? String(Math.round(n * k * 100) / 100) : v;
      };
      return { ...p, unit: next, w: convert(p.w), h: convert(p.h) };
    });
  }

  function changePxW(v) {
    setPx((old) => {
      const next = { ...old, w: v };
      if (old.lock && hasSrc && Number(v) > 0) next.h = String(Math.round((Number(v) * src.h) / src.w));
      return next;
    });
  }

  function changePxH(v) {
    setPx((old) => {
      const next = { ...old, h: v };
      if (old.lock && hasSrc && Number(v) > 0) next.w = String(Math.round((Number(v) * src.w) / src.h));
      return next;
    });
  }

  /* ---------- processing ---------- */

  async function buildUpload() {
    const needsCrop = effFit === "fill" && crop && isCropNeeded(crop, src.w, src.h);
    if (!needsCrop && !exifRotated) return file;
    const rect = needsCrop ? crop : { x: 0, y: 0, w: src.w, h: src.h };
    const { blob, ext } = await renderCrop(file, rect);
    return new File([blob], `${safeBaseName(file.name)}${ext}`, { type: blob.type });
  }

  async function run() {
    if (!file || busy || problem) return;

    const id = ++runId.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const limitMs = model === "ai_pro" ? 240_000 : 90_000;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, limitMs);

    const sig = signature;
    setBusy(true);
    setError(null);

    try {
      const upload = await buildUpload();
      if (id !== runId.current) return;

      const form = new FormData();
      form.append("file", upload);
      form.append("model", model);
      form.append("outputFormat", format);
      form.append("dpi", String(dpi));
      form.append("quality", String(quality));
      if (mode === "scale") {
        form.append("scaleFactor", String(scale));
        form.append("targetWidth", String(out.w));
        form.append("targetHeight", String(out.h));
        form.append("maintainAspectRatio", "false");
      } else {
        form.append("targetWidth", String(box.w));
        form.append("targetHeight", String(box.h));
        form.append("maintainAspectRatio", effFit === "fit" ? "true" : "false");
      }

      const res = await fetch(`${API}/api/images/upscale`, { method: "POST", body: form, signal: controller.signal });
      if (id !== runId.current) return;
      if (!res.ok) throw new Error(await parseApiError(res));

      const data = await res.json();
      if (id !== runId.current) return;
      if (!data?.dataUrl) throw new Error("The server finished but sent no image back. Try again.");

      setResult({ data, sig });
      setView("compare");
      setServer("up");
    } catch (err) {
      if (id !== runId.current) return;
      if (err?.name === "AbortError") {
        if (timedOut) {
          setError({ sig, msg: `This took longer than ${limitMs / 1000} seconds and was stopped. Try a smaller output size.` });
        }
        return;
      }
      if (err instanceof TypeError) {
        setServer("down");
        setError({ sig, msg: OFFLINE_MESSAGE });
      } else {
        setError({ sig, msg: err?.message || "Something went wrong while processing the image." });
      }
    } finally {
      clearTimeout(timer);
      if (id === runId.current) setBusy(false);
    }
  }

  function cancel() {
    runId.current++;
    abortRef.current?.abort();
    setBusy(false);
  }

  function download() {
    if (!activeResult) return;
    const { data } = activeResult;
    try {
      const blob = dataUrlToBlob(data.dataUrl);
      const name = formatOutputFilename({
        originalName: file.name,
        mode,
        scale,
        paperPreset: paper.preset,
        paperLabel: paper.preset === "CUSTOM" ? "custom" : PAPERS[paper.preset]?.label,
        targetWidth: data.targetWidth,
        targetHeight: data.targetHeight,
        dpi: data.dpi,
        model,
        outputFormat: data.outputFormat,
      });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 2000);
    } catch {
      setError({ sig: signature, msg: "The download couldn't be created. Run the upscale again." });
    }
  }

  /* ---------- labels for the stage ---------- */

  let labelW = "";
  let labelH = "";
  if (mode === "paper" && paperMm) {
    labelW = `${cm(paperMm.w)} cm / ${inches(paperMm.w)} in`;
    labelH = `${cm(paperMm.h)} cm / ${inches(paperMm.h)} in`;
  } else if (box) {
    labelW = `${box.w} px`;
    labelH = `${box.h} px`;
  } else if (out) {
    labelW = `${out.w} px`;
    labelH = `${out.h} px`;
  }

  const printCm = out ? { w: ((out.w / dpi) * 2.54).toFixed(1), h: ((out.h / dpi) * 2.54).toFixed(1) } : null;
  const qualityActive = (format === "JPEG" || format === "WEBP") && !busy;

  const emptySheet = (
    <div className="empty">
      <strong>{loading ? "Reading image" : "Drop an image on the sheet"}</strong>
      <span>PNG, JPEG, WebP, BMP or TIFF, up to 50 MB.</span>
      <button type="button" className="btn btn-primary" onClick={openPicker} disabled={loading}>
        Choose image
      </button>
    </div>
  );

  const sheetPlaceholder = file ? (
    <div className="empty">
      <strong>{outputPreviewable ? "No preview in this browser" : "TIFF can't be previewed here"}</strong>
      <span>{activeResult ? "Your file is ready to download." : "The file will still be processed."}</span>
    </div>
  ) : (
    emptySheet
  );

  /* ---------- render ---------- */

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark" aria-hidden="true" />
          PixelPerfect
        </a>
        <div className={`server is-${server}`} role="status">
          <span className="server-dot" aria-hidden="true" />
          {server === "up" && <span className="sr-only">Server ready</span>}
          {server === "checking" && <span className="sr-only">Checking server</span>}
          {server === "down" && (
            <>
              Server offline
              <button type="button" className="text-btn" onClick={retryServer}>
                Retry
              </button>
            </>
          )}
        </div>
      </header>

      <div className="workbench">
        <section
          className={`stage${dragging ? " is-dragging" : ""}`}
          aria-label="Preview"
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!busy) chooseFile(e.dataTransfer.files?.[0]);
          }}
        >
          <div className="stage-bar">
            {file ? (
              <>
                <div className="file-id">
                  <strong title={file.name}>{file.name}</strong>
                  <span>
                    {src.w} × {src.h} px, {aspectLabel(src.w, src.h)}, {formatBytes(file.size)}
                  </span>
                </div>
                <div className="stage-actions">
                  {activeResult && (
                    <Segmented
                      name="view"
                      label="Preview"
                      value={showCompare ? "compare" : "sheet"}
                      onChange={setView}
                      options={[
                        { value: "compare", label: "Before and after", disabled: !canCompare },
                        { value: "sheet", label: "Sheet" },
                      ]}
                    />
                  )}
                  <button type="button" className="text-btn" onClick={openPicker} disabled={busy}>
                    Replace
                  </button>
                  <button type="button" className="text-btn" onClick={removeImage} disabled={busy}>
                    Remove
                  </button>
                </div>
              </>
            ) : (
              <div className="file-id">
                <strong>Print sheet</strong>
                <span>Choose the paper on the right, then add your image.</span>
              </div>
            )}
          </div>

          {showCompare ? (
            <CompareSlider
              beforeSrc={previewUrl}
              afterSrc={activeResult.data.dataUrl}
              ratio={activeResult.data.targetWidth / activeResult.data.targetHeight}
              beforeLabel="Original"
              beforeDims={`${src.w} × ${src.h}`}
              afterLabel="Upscaled"
              afterDims={`${activeResult.data.targetWidth} × ${activeResult.data.targetHeight}`}
              beforeStyle={effFit === "fill" ? { objectPosition: `${focus.x * 100}% ${focus.y * 100}%` } : undefined}
            />
          ) : (
            <SheetPreview
              ratio={sheetRatio}
              labelW={labelW}
              labelH={labelH}
              src={previewUrl}
              srcW={src.w}
              srcH={src.h}
              previewable={previewable}
              fit={effFit}
              focus={focus}
              onFocus={setFocus}
              placeholder={sheetPlaceholder}
            />
          )}

          {out && (
            <div className="stage-foot">
              <dl className="facts">
                <div>
                  <dt>Original</dt>
                  <dd>
                    {src.w} × {src.h} px
                  </dd>
                </div>
                <div>
                  <dt>Output</dt>
                  <dd>
                    {out.w} × {out.h} px
                  </dd>
                </div>
                <div>
                  <dt>Prints at</dt>
                  <dd>
                    {printCm.w} × {printCm.h} cm at {dpi} DPI
                  </dd>
                </div>
              </dl>
              {file && density != null && !problem && <QualityMeter density={density} ai={model === "ai_pro"} />}
            </div>
          )}
        </section>

        <form
          className="inspector"
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          <div className="inspector-body">
            <input
              ref={inputRef}
              type="file"
              hidden
              accept="image/png,image/jpeg,image/webp,image/bmp,image/tiff,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff"
              onChange={(e) => chooseFile(e.target.files?.[0])}
            />

            <fieldset className="group" disabled={busy}>
              <legend>Size by</legend>
              <Segmented name="mode" label="Size by" value={mode} onChange={setMode} options={SIZE_MODES} />

              {mode === "paper" && (
                <>
                  <Segmented
                    name="paper"
                    label="Paper size"
                    className="wrap"
                    value={paper.preset}
                    onChange={(preset) => setPaper((p) => ({ ...p, preset }))}
                    options={PAPER_OPTIONS}
                  />
                  {paper.preset !== "CUSTOM" ? (
                    <Segmented
                      name="orientation"
                      label="Orientation"
                      value={paper.orientation}
                      onChange={(orientation) => setPaper((p) => ({ ...p, orientation }))}
                      options={ORIENTATIONS}
                    />
                  ) : (
                    <>
                      <Segmented name="unit" label="Unit" value={paper.unit} onChange={changeUnit} options={UNITS} />
                      <div className="pair">
                        <label className="field">
                          <span>Width ({paper.unit})</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0.1"
                            step="0.1"
                            value={paper.w}
                            onChange={(e) => setPaper((p) => ({ ...p, w: e.target.value }))}
                          />
                        </label>
                        <label className="field">
                          <span>Height ({paper.unit})</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0.1"
                            step="0.1"
                            value={paper.h}
                            onChange={(e) => setPaper((p) => ({ ...p, h: e.target.value }))}
                          />
                        </label>
                      </div>
                    </>
                  )}
                </>
              )}

              {mode === "pixels" && (
                <>
                  <div className="pair">
                    <label className="field">
                      <span>Width (px)</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={MIN_SIDE}
                        max={MAX_SIDE}
                        value={px.w}
                        onChange={(e) => changePxW(e.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span>Height (px)</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={MIN_SIDE}
                        max={MAX_SIDE}
                        value={px.h}
                        onChange={(e) => changePxH(e.target.value)}
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="toggle"
                    aria-pressed={px.lock}
                    onClick={() => setPx((old) => ({ ...old, lock: !old.lock }))}
                  >
                    <span className="toggle-box" aria-hidden="true" />
                    Keep the image's proportions
                  </button>
                </>
              )}

              {mode === "scale" && (
                <Segmented
                  name="scale"
                  label="Scale"
                  value={scale}
                  onChange={(v) => setScale(Number(v))}
                  options={SCALES.map((s) => {
                    const longest = hasSrc ? Math.round(Math.max(src.w, src.h) * s) : 0;
                    return {
                      value: s,
                      label: `${s}×`,
                      hint: hasSrc ? `${longest} px` : undefined,
                      disabled: longest > MAX_SIDE,
                    };
                  })}
                />
              )}
            </fieldset>

            <fieldset className="group" disabled={busy}>
              <legend>Resolution</legend>
              <Segmented
                name="dpi"
                label="Resolution in DPI"
                value={dpi}
                onChange={(v) => setDpi(Number(v))}
                options={DPI_CHOICES.map((d) => ({ value: d.value, label: d.label, hint: d.hint }))}
              />
              <p className="hint">
                {mode === "paper"
                  ? "The sheet stays the same size. A higher DPI means more pixels to fill it."
                  : "Saved in the file so printers know the intended print size."}
              </p>
            </fieldset>

            {mode !== "scale" && (
              <fieldset className="group" disabled={busy}>
                <legend>Fit</legend>
                <Segmented
                  name="fit"
                  label="Fit"
                  value={effFit}
                  onChange={setFit}
                  options={[
                    { value: "fit", label: "Fit inside", hint: "Keep it all" },
                    { value: "fill", label: "Fill sheet", hint: "Crop to shape", disabled: !previewable },
                  ]}
                />
                <p className="hint">
                  {effFit === "fill"
                    ? "Crops the image to the sheet's shape. Drag the image on the sheet to choose what stays."
                    : !previewable && file
                      ? "Cropping needs an image this browser can display, so it's off for this file."
                      : "The whole image stays visible. One edge may leave a blank margin."}
                </p>
              </fieldset>
            )}

            <fieldset className="group" disabled={busy}>
              <legend>Method</legend>
              <label className="field">
                <span className="sr-only">Method</span>
                <select value={model} onChange={(e) => setModel(e.target.value)}>
                  {METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="hint">{METHODS.find((m) => m.value === model)?.note}</p>
            </fieldset>

            <fieldset className="group" disabled={busy}>
              <legend>File</legend>
              <label className="field">
                <span>Format</span>
                <select value={format} onChange={(e) => setFormat(e.target.value)}>
                  {formats.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
              <p className="hint">{FORMAT_NOTES[format] || ""}</p>
              {(format === "JPEG" || format === "WEBP") && (
                <label className="field">
                  <span>
                    Compression quality <b>{quality}%</b>
                  </span>
                  <input
                    type="range"
                    min="50"
                    max="100"
                    step="5"
                    value={quality}
                    disabled={!qualityActive}
                    onChange={(e) => setQuality(Number(e.target.value))}
                  />
                </label>
              )}
            </fieldset>

          </div>

          <div className="actions">
            {problem && (
              <div className="notice" role="alert">
                <p>{problem}</p>
                {fixDpi && (
                  <button type="button" className="btn btn-quiet" onClick={() => setDpi(fixDpi)}>
                    Use {fixDpi} DPI
                  </button>
                )}
              </div>
            )}

            {activeError && (
              <div className="notice is-error" role="alert">
                <p>{activeError}</p>
              </div>
            )}
            {activeResult ? (
              <>
                <p className="done" role="status">
                  Upscaled to {activeResult.data.targetWidth} × {activeResult.data.targetHeight} px
                  {activeResult.data.processingDurationMs != null && ` in ${(activeResult.data.processingDurationMs / 1000).toFixed(1)} s`}
                  {activeResult.data.outputSizeBytes > 0 && `, ${formatBytes(activeResult.data.outputSizeBytes)}`}.
                </p>
                <button type="button" className="btn btn-primary" onClick={download}>
                  Download {resultFormat}
                </button>
                <button type="button" className="btn btn-quiet" onClick={openPicker}>
                  Choose another image
                </button>
              </>
            ) : busy ? (
              <>
                <button type="button" className="btn btn-primary" disabled aria-busy="true">
                  <span className="spinner" aria-hidden="true" />
                  Upscaling
                </button>
                <p className="hint" role="status">
                  {model === "ai_pro" ? "AI upscaling can take a minute or more." : "This usually takes a few seconds."}
                </p>
                <button type="button" className="btn btn-quiet" onClick={cancel}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button type="submit" className="btn btn-primary" disabled={!file || Boolean(problem) || loading}>
                  Upscale image
                </button>
                {!file && <p className="hint">Add an image to continue.</p>}
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
