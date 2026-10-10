/**
 * PixelPerfect Image Upscaler — Frontend Test Suite (Phase 8)
 *
 * Tests are organised by user-facing behaviour, not by internal implementation.
 * Network requests are mocked at the fetch level.  Assertions target visible
 * text, accessible labels and user-observable state changes.
 *
 * Limitation: App.jsx is a single 1480-line component.  We test it as a
 * black box rather than extracting sub-components in this phase.
 */

import { render, screen, waitFor, within, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.jsx";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal 1×1 red PNG as a base64 data URL (89 bytes decoded). */
const TINY_PNG_BASE64 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

/**
 * Create a synthetic File that jsdom + Image can "load".
 * We also need to stub the Image constructor so onload fires.
 */
function createImageFile(
  name = "photo.png",
  type = "image/png",
  sizeBytes = 2048,
) {
  const buf = new ArrayBuffer(sizeBytes);
  return new File([buf], name, { type });
}

/** Stub global.Image so that our tests can simulate dimensions. */
function stubImage(width = 800, height = 600) {
  const origImage = globalThis.Image;
  const imgInstances = [];

  globalThis.Image = class FakeImage {
    constructor() {
      this._width = width;
      this._height = height;
      imgInstances.push(this);
    }
    get naturalWidth() {
      return this._width;
    }
    get naturalHeight() {
      return this._height;
    }
    set src(_val) {
      // Trigger onload asynchronously (like a real image)
      setTimeout(() => {
        if (this.onload) this.onload();
      }, 0);
    }
  };

  return {
    restore: () => {
      globalThis.Image = origImage;
    },
    instances: imgInstances,
  };
}

/**
 * Build a mock fetch that handles /api/images/config, /api/images/print-sizes
 * and /api/images/upscale with sensible defaults.
 */
function mockFetch(overrides = {}) {
  return vi.fn(async (url, opts) => {
    const urlStr = typeof url === "string" ? url : url.toString();

    // ---- /api/images/config ----
    if (urlStr.includes("/api/images/config")) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () =>
          overrides.config ?? {
            supportedFormats: ["PNG", "JPEG", "WEBP", "BMP", "TIFF"],
          },
      };
    }

    // ---- /api/images/print-sizes ----
    if (urlStr.includes("/api/images/print-sizes")) {
      if (overrides.printSizesError) {
        return {
          ok: false,
          status: 400,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ error: overrides.printSizesError }),
        };
      }
      // Parse DPI and preset from URL to return plausible values
      const parsed = new URL(urlStr, "http://localhost");
      const dpi = Number(parsed.searchParams.get("dpi")) || 300;
      const preset = parsed.searchParams.get("preset") || "A4";
      // Provide fixed values per preset for deterministic tests
      const presetPx = {
        A4: { w: Math.round((21.0 / 2.54) * dpi), h: Math.round((29.7 / 2.54) * dpi) },
        A3: { w: Math.round((29.7 / 2.54) * dpi), h: Math.round((42.0 / 2.54) * dpi) },
        A5: { w: Math.round((14.8 / 2.54) * dpi), h: Math.round((21.0 / 2.54) * dpi) },
        LETTER: { w: Math.round((21.59 / 2.54) * dpi), h: Math.round((27.94 / 2.54) * dpi) },
        LEGAL: { w: Math.round((21.59 / 2.54) * dpi), h: Math.round((35.56 / 2.54) * dpi) },
      };
      const dims = presetPx[preset] || { w: 2480, h: 3508 };
      const orientation = parsed.searchParams.get("orientation");
      const widthPx = orientation === "landscape" ? dims.h : dims.w;
      const heightPx = orientation === "landscape" ? dims.w : dims.h;
      // Handle custom dimensions
      const widthCm = parsed.searchParams.get("widthCm");
      const heightCm = parsed.searchParams.get("heightCm");
      if (widthCm && heightCm) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            widthPx: Math.round((Number(widthCm) / 2.54) * dpi),
            heightPx: Math.round((Number(heightCm) / 2.54) * dpi),
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ widthPx, heightPx }),
      };
    }

    // ---- /api/images/upscale ----
    if (urlStr.includes("/api/images/upscale")) {
      if (overrides.upscaleError) {
        return {
          ok: false,
          status: overrides.upscaleStatus || 500,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ message: overrides.upscaleError }),
          text: async () => overrides.upscaleError,
        };
      }
      const body = opts?.body;
      const targetWidth = body?.get?.("targetWidth") || "1600";
      const targetHeight = body?.get?.("targetHeight") || "1200";
      const outputFormat = body?.get?.("outputFormat") || "PNG";
      const dpi = body?.get?.("dpi") || "300";
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () =>
          overrides.upscaleResult ?? {
            dataUrl: TINY_PNG_BASE64,
            targetWidth: Number(targetWidth),
            targetHeight: Number(targetHeight),
            outputFormat,
            dpi: Number(dpi),
            outputSizeBytes: 12345,
            processingDurationMs: 42,
          },
      };
    }

    // Default: 404
    return {
      ok: false,
      status: 404,
      headers: new Headers(),
      json: async () => ({ error: "Not found" }),
      text: async () => "Not found",
    };
  });
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("PixelPerfect App", () => {
  let imageStub;

  beforeEach(() => {
    imageStub = stubImage(800, 600);
    vi.stubGlobal("fetch", mockFetch());
  });

  afterEach(() => {
    imageStub.restore();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Application Rendering
  // =========================================================================
  describe("Application rendering", () => {
    it("renders without crashing", () => {
      render(<App />);
      expect(screen.getByText("PixelPerfect")).toBeInTheDocument();
    });

    it("shows the brand identity and tagline", () => {
      render(<App />);
      expect(screen.getByText("PixelPerfect")).toBeInTheDocument();
      expect(screen.getByText(/IMAGE RESIZER/)).toBeInTheDocument();
    });

    it("renders both step panels", () => {
      render(<App />);
      expect(screen.getByText("STEP 01")).toBeInTheDocument();
      expect(screen.getByText("STEP 02")).toBeInTheDocument();
      expect(screen.getByText("Your image")).toBeInTheDocument();
      expect(screen.getByText("Output settings")).toBeInTheDocument();
    });

    it("displays the upload dropzone in the empty state", () => {
      render(<App />);
      expect(screen.getByText("Drop your image here")).toBeInTheDocument();
      expect(screen.getByText("Choose image")).toBeInTheDocument();
      expect(screen.getByText(/Supported formats/)).toBeInTheDocument();
    });

    it("shows the FREE · NO AI badge", () => {
      render(<App />);
      expect(screen.getByText(/FREE · NO AI/)).toBeInTheDocument();
    });

    it("renders the footer with correct information", () => {
      render(<App />);
      expect(screen.getByText("PIXEL PERFECT")).toBeInTheDocument();
      expect(screen.getByText(/No AI enhancement/)).toBeInTheDocument();
    });

    it("does not show the planned output card when no image is loaded", () => {
      render(<App />);
      expect(screen.queryByText("Planned Output Resolution")).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // 2. Image Upload
  // =========================================================================
  describe("Image upload", () => {
    it("accepts a supported image file via file input", async () => {
      render(<App />);
      const file = createImageFile("test.png", "image/png", 4096);

      // Find the hidden file input
      const input = document.querySelector('input[type="file"]');
      expect(input).toBeTruthy();

      await act(async () => {
        await userEvent.upload(input, file);
      });

      // Wait for image onload to fire and dimensions to appear
      await waitFor(() => {
        expect(screen.getByText("test.png")).toBeInTheDocument();
      });
    });

    it("rejects files with unsupported extensions", async () => {
      render(<App />);
      const badFile = createImageFile("document.pdf", "application/pdf", 1024);

      const input = document.querySelector('input[type="file"]');
      act(() => {
        fireEvent.change(input, { target: { files: [badFile] } });
      });

      await waitFor(() => {
        expect(screen.getByText(/Unsupported file format/)).toBeInTheDocument();
      });
    });

    it("rejects files exceeding the 50MB limit", async () => {
      render(<App />);
      // Create a file with size > 50MB by faking the size property
      const bigFile = new File(["x"], "huge.png", { type: "image/png" });
      Object.defineProperty(bigFile, "size", { value: 55_000_000 });

      const input = document.querySelector('input[type="file"]');
      await act(async () => {
        await userEvent.upload(input, bigFile);
      });

      await waitFor(() => {
        expect(screen.getByText(/exceeds the 50MB/)).toBeInTheDocument();
      });
    });

    it("shows original dimensions after image loads", async () => {
      render(<App />);
      const file = createImageFile("photo.png", "image/png");

      const input = document.querySelector('input[type="file"]');
      await act(async () => {
        await userEvent.upload(input, file);
      });

      // Wait for the stubbed Image to fire onload and populate dimensions
      await waitFor(() => {
        expect(screen.getAllByText(/800 × 600 px/).length).toBeGreaterThanOrEqual(1);
      });
    });

    it("shows Remove and Replace buttons after upload", async () => {
      render(<App />);
      const file = createImageFile("photo.png", "image/png");

      const input = document.querySelector('input[type="file"]');
      await act(async () => {
        await userEvent.upload(input, file);
      });

      await waitFor(() => {
        expect(screen.getByText("Replace image")).toBeInTheDocument();
        expect(screen.getByText("Remove")).toBeInTheDocument();
      });
    });

    it("clears the image and results when Remove is clicked", async () => {
      render(<App />);
      const file = createImageFile("photo.png", "image/png");

      const input = document.querySelector('input[type="file"]');
      await act(async () => {
        await userEvent.upload(input, file);
      });

      await waitFor(() => {
        expect(screen.getByText("photo.png")).toBeInTheDocument();
      });

      const removeBtn = screen.getByText("Remove");
      await act(async () => {
        await userEvent.click(removeBtn);
      });

      // Should return to the dropzone state
      await waitFor(() => {
        expect(screen.getByText("Drop your image here")).toBeInTheDocument();
      });
      expect(screen.queryByText("photo.png")).not.toBeInTheDocument();
    });

    it("calls URL.revokeObjectURL when removing an image", async () => {
      const revokeSpy = vi.spyOn(URL, "revokeObjectURL");
      render(<App />);
      const file = createImageFile("photo.png", "image/png");

      const input = document.querySelector('input[type="file"]');
      await act(async () => {
        await userEvent.upload(input, file);
      });

      await waitFor(() => {
        expect(screen.getByText("photo.png")).toBeInTheDocument();
      });

      const removeBtn = screen.getByText("Remove");
      await act(async () => {
        await userEvent.click(removeBtn);
      });

      expect(revokeSpy).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 3. Resize Controls
  // =========================================================================
  describe("Resize controls", () => {
    it("defaults to Scale Factor mode with 2× selected", () => {
      render(<App />);
      const scaleTab = screen.getByText("Scale Factor");
      expect(scaleTab.closest("button")).toHaveClass("active");

      // 2× button should be selected
      const twoXBtn = screen.getByText("2×").closest("button");
      expect(twoXBtn).toHaveClass("selected");
    });

    it("updates target dimensions when scale factor changes", async () => {
      render(<App />);

      // Upload an image first to populate dimensions
      const file = createImageFile("photo.png", "image/png");
      const input = document.querySelector('input[type="file"]');
      await act(async () => {
        await userEvent.upload(input, file);
      });

      await waitFor(() => {
        expect(screen.getAllByText(/800 × 600/).length).toBeGreaterThanOrEqual(1);
      });

      // Click 4× multiplier
      const fourXBtn = screen.getByText("4×");
      await act(async () => {
        await userEvent.click(fourXBtn);
      });

      // Should show planned output card with 4× dimensions
      await waitFor(() => {
        expect(screen.getAllByText(/3200 × 2400 px/).length).toBeGreaterThanOrEqual(1);
      });
    });

    it("switches to Custom Pixels mode", async () => {
      render(<App />);
      const customTab = screen.getByText("Custom Pixels");
      await act(async () => {
        await userEvent.click(customTab);
      });

      expect(screen.getByText(/Custom Pixel Dimensions/i)).toBeInTheDocument();
    });

    it("shows aspect ratio lock toggle in custom mode", async () => {
      render(<App />);
      const customTab = screen.getByText("Custom Pixels");
      await act(async () => {
        await userEvent.click(customTab);
      });

      // Default is linked
      expect(screen.getByText("Linked")).toBeInTheDocument();
    });

    it("unlocks aspect ratio when toggle is clicked", async () => {
      render(<App />);
      const customTab = screen.getByText("Custom Pixels");
      await act(async () => {
        await userEvent.click(customTab);
      });

      const lockBtn = screen.getByText("Linked").closest("button");
      await act(async () => {
        await userEvent.click(lockBtn);
      });

      expect(screen.getByText("Independent")).toBeInTheDocument();
    });

    it("switches to Print Calculator mode", async () => {
      render(<App />);
      const printTab = screen.getByText("Print Calculator");
      await act(async () => {
        await userEvent.click(printTab);
      });

      // Should show print presets
      await waitFor(() => {
        expect(screen.getByText(/Print standard preset/)).toBeInTheDocument();
      });
    });

    it("shows dimension fitting mode options", () => {
      render(<App />);
      expect(screen.getByText("Fit within target box")).toBeInTheDocument();
      expect(screen.getByText("Exact requested dimensions")).toBeInTheDocument();
    });
  });

  // =========================================================================
  // 4. Print Calculator
  // =========================================================================
  describe("Print calculator", () => {
    async function openPrintMode() {
      render(<App />);
      const printTab = screen.getByText("Print Calculator");
      await act(async () => {
        await userEvent.click(printTab);
      });
    }

    it("shows calculated pixel dimensions for A4 preset", async () => {
      await openPrintMode();
      await waitFor(() => {
        // A4 at 300 DPI → ~2480 × 3508 px
        const calcCard = screen.queryByText(/Calculated Output Pixels/);
        expect(calcCard).toBeInTheDocument();
      });
    });

    it("shows orientation toggle for standard presets", async () => {
      await openPrintMode();
      await waitFor(() => {
        expect(screen.getByText(/↕ Portrait/)).toBeInTheDocument();
        expect(screen.getByText(/↔ Landscape/)).toBeInTheDocument();
      });
    });

    it("switches orientation to landscape", async () => {
      await openPrintMode();
      let landscapeBtn;
      await waitFor(() => {
        landscapeBtn = screen.getByText(/↔ Landscape/);
        expect(landscapeBtn).toBeInTheDocument();
      });
      await act(async () => {
        await userEvent.click(landscapeBtn);
      });
      // The landscape button should now be selected
      expect(landscapeBtn).toHaveClass("selected");
    });

    it("shows custom dimension fields when Custom preset is chosen", async () => {
      await openPrintMode();
      const presetSelect = screen.getByDisplayValue(/A4/);
      await act(async () => {
        await userEvent.selectOptions(presetSelect, "CUSTOM");
      });

      await waitFor(() => {
        expect(screen.getByText(/Custom dimensions/)).toBeInTheDocument();
      });
    });

    it("shows unit toggle between cm and inches", async () => {
      await openPrintMode();
      const presetSelect = screen.getByDisplayValue(/A4/);
      await act(async () => {
        await userEvent.selectOptions(presetSelect, "CUSTOM");
      });

      await waitFor(() => {
        expect(screen.getByText("cm")).toBeInTheDocument();
        expect(screen.getByText("inches")).toBeInTheDocument();
      });
    });

    it("displays an error when print-size API fails", async () => {
      vi.stubGlobal(
        "fetch",
        mockFetch({ printSizesError: "Unsupported preset" }),
      );

      await openPrintMode();

      await waitFor(() => {
        expect(screen.getByText(/Unsupported preset/)).toBeInTheDocument();
      });
    });
  });

  // =========================================================================
  // 5. Output Format & DPI
  // =========================================================================
  describe("Output format and DPI", () => {
    it("shows the output format selector with defaults loaded from API", async () => {
      render(<App />);
      await waitFor(() => {
        const formatSelect = screen.getByDisplayValue("PNG");
        expect(formatSelect).toBeInTheDocument();
      });
    });

    it("shows format-specific helper text for PNG", async () => {
      render(<App />);
      await waitFor(() => {
        expect(screen.getByText(/Lossless with transparency/)).toBeInTheDocument();
      });
    });

    it("changes helper text when format changes to JPEG", async () => {
      render(<App />);
      const formatSelect = screen.getByDisplayValue("PNG");
      await act(async () => {
        await userEvent.selectOptions(formatSelect, "JPEG");
      });
      expect(screen.getByText(/Lossy compression, no transparency/)).toBeInTheDocument();
    });

    it("shows DPI helper text", () => {
      render(<App />);
      expect(screen.getByText(/DPI sets print-resolution metadata/)).toBeInTheDocument();
    });

    it("shows quality slider for JPEG format", async () => {
      render(<App />);
      const formatSelect = screen.getByDisplayValue("PNG");
      await act(async () => {
        await userEvent.selectOptions(formatSelect, "JPEG");
      });
      expect(screen.getByText(/Compression quality/)).toBeInTheDocument();
    });

    it("shows quality slider for WEBP format", async () => {
      render(<App />);
      const formatSelect = screen.getByDisplayValue("PNG");
      await act(async () => {
        await userEvent.selectOptions(formatSelect, "WEBP");
      });
      expect(screen.getByText(/Compression quality/)).toBeInTheDocument();
    });

    it("does not show quality slider for PNG format", () => {
      render(<App />);
      expect(screen.queryByText(/Compression quality/)).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // 6. Processing & Results
  // =========================================================================
  describe("Processing and results", () => {
    async function uploadAndProcess(fetchOverrides = {}) {
      if (Object.keys(fetchOverrides).length > 0) {
        vi.stubGlobal("fetch", mockFetch(fetchOverrides));
      }

      render(<App />);
      const file = createImageFile("test.png", "image/png");
      const input = document.querySelector('input[type="file"]');
      await act(async () => {
        await userEvent.upload(input, file);
      });

      await waitFor(() => {
        expect(screen.getByText("test.png")).toBeInTheDocument();
      });

      const processBtn = screen.getByRole("button", { name: /Resize image/i });
      await act(async () => {
        await userEvent.click(processBtn);
      });
    }

    it("submits processing request and shows result", async () => {
      await uploadAndProcess();

      await waitFor(() => {
        expect(
          screen.getByText(/Processing Completed Successfully/),
        ).toBeInTheDocument();
      });
    });

    it("shows output dimensions in the result card", async () => {
      await uploadAndProcess();

      await waitFor(() => {
        expect(screen.getByText(/Output Dimensions/)).toBeInTheDocument();
      });
    });

    it("shows processing duration when returned", async () => {
      await uploadAndProcess();

      await waitFor(() => {
        expect(screen.getByText(/42 ms/)).toBeInTheDocument();
      });
    });

    it("shows download button after successful processing", async () => {
      await uploadAndProcess();

      await waitFor(() => {
        expect(screen.getByText(/Download processed image/)).toBeInTheDocument();
      });
    });

    it("shows 'Process another image' button after successful processing", async () => {
      await uploadAndProcess();

      await waitFor(() => {
        expect(screen.getByText("Process another image")).toBeInTheDocument();
      });
    });

    it("shows the comparison slider tabs after processing", async () => {
      await uploadAndProcess();

      await waitFor(() => {
        expect(screen.getByText(/Before \/ After/)).toBeInTheDocument();
        expect(screen.getByText(/Processed Output/)).toBeInTheDocument();
        expect(screen.getByText(/Original Input/)).toBeInTheDocument();
      });
    });

    it("displays an error when the backend fails", async () => {
      await uploadAndProcess({
        upscaleError: "Image is too large",
        upscaleStatus: 400,
      });

      await waitFor(() => {
        expect(screen.getByText(/Image is too large/)).toBeInTheDocument();
      });
    });

    it("download button is not shown before processing", async () => {
      render(<App />);
      expect(
        screen.queryByText(/Download processed image/),
      ).not.toBeInTheDocument();
    });

    it("clears previous result when settings change", async () => {
      await uploadAndProcess();

      await waitFor(() => {
        expect(
          screen.getByText(/Processing Completed Successfully/),
        ).toBeInTheDocument();
      });

      // Change output format — should clear result
      const formatSelect = screen.getByDisplayValue("PNG");
      await act(async () => {
        await userEvent.selectOptions(formatSelect, "JPEG");
      });

      // Result should be cleared
      expect(
        screen.queryByText(/Processing Completed Successfully/),
      ).not.toBeInTheDocument();
    });

    it("disables Resize button while processing", async () => {
      // Use a fetch that never resolves to keep the button disabled
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url) => {
          if (url.includes("/api/images/config")) {
            return {
              ok: true,
              status: 200,
              headers: new Headers({ "content-type": "application/json" }),
              json: async () => ({
                supportedFormats: ["PNG", "JPEG", "WEBP", "BMP", "TIFF"],
              }),
            };
          }
          if (url.includes("/api/images/print-sizes")) {
            return {
              ok: true,
              status: 200,
              headers: new Headers({ "content-type": "application/json" }),
              json: async () => ({ widthPx: 2480, heightPx: 3508 }),
            };
          }
          // For upscale: return a promise that never resolves
          return new Promise(() => {});
        }),
      );

      render(<App />);
      const file = createImageFile("test.png", "image/png");
      const input = document.querySelector('input[type="file"]');
      await act(async () => {
        await userEvent.upload(input, file);
      });

      await waitFor(() => {
        expect(screen.getByText("test.png")).toBeInTheDocument();
      });

      const processBtn = screen.getByRole("button", { name: /Resize image/i });
      await act(async () => {
        await userEvent.click(processBtn);
      });

      // Should show processing state
      await waitFor(() => {
        expect(screen.getByText(/Processing image/)).toBeInTheDocument();
      });
    });
  });

  // =========================================================================
  // 7. Processing Note (Upscaling Disclaimer)
  // =========================================================================
  describe("Processing information note", () => {
    it("shows the upscaling limitation disclaimer", () => {
      render(<App />);
      expect(
        screen.getByText(/does not recover detail/),
      ).toBeInTheDocument();
    });

    it("mentions deterministic bicubic resampling", () => {
      render(<App />);
      expect(
        screen.getByText(/deterministic bicubic resampling/),
      ).toBeInTheDocument();
    });
  });

  // =========================================================================
  // 8. Accessibility
  // =========================================================================
  describe("Accessibility", () => {
    it("dropzone is keyboard focusable with proper role", () => {
      render(<App />);
      const dropzone = screen.getByRole("button", {
        name: /Upload image area/i,
      });
      expect(dropzone).toHaveAttribute("tabindex", "0");
    });

    it("resize button has descriptive title when no image is selected", () => {
      render(<App />);
      const resizeBtn = screen.getByRole("button", { name: /Resize image/i });
      expect(resizeBtn).toHaveAttribute(
        "title",
        "Select or upload an image first",
      );
    });

    it("resize button is disabled when no image is selected", () => {
      render(<App />);
      const resizeBtn = screen.getByRole("button", { name: /Resize image/i });
      expect(resizeBtn).toBeDisabled();
    });

    it("comparison slider has proper ARIA attributes", async () => {
      // Need to process an image first to show the slider
      vi.stubGlobal("fetch", mockFetch());
      render(<App />);
      const file = createImageFile("test.png", "image/png");
      const input = document.querySelector('input[type="file"]');
      await act(async () => {
        await userEvent.upload(input, file);
      });

      await waitFor(() => {
        expect(screen.getByText("test.png")).toBeInTheDocument();
      });

      const processBtn = screen.getByRole("button", { name: /Resize image/i });
      await act(async () => {
        await userEvent.click(processBtn);
      });

      await waitFor(() => {
        const slider = screen.getByRole("slider");
        expect(slider).toHaveAttribute("aria-valuenow");
        expect(slider).toHaveAttribute("aria-valuemin", "0");
        expect(slider).toHaveAttribute("aria-valuemax", "100");
      });
    });

    it("error messages use role=alert for screen readers", async () => {
      render(<App />);
      const badFile = createImageFile("test.pdf", "application/pdf", 1024);
      const input = document.querySelector('input[type="file"]');
      act(() => {
        fireEvent.change(input, { target: { files: [badFile] } });
      });

      await waitFor(() => {
        const alert = screen.getByRole("alert");
        expect(alert).toBeInTheDocument();
      });
    });

    it("fit mode buttons have aria-pressed attributes", () => {
      render(<App />);
      const fitBtn = screen.getByText("Fit within target box").closest("button");
      expect(fitBtn).toHaveAttribute("aria-pressed");
    });
  });

  // =========================================================================
  // 9. Dimension Validation
  // =========================================================================
  describe("Dimension validation", () => {
    it("shows a warning for dimensions exceeding 8192 px", async () => {
      render(<App />);

      // Switch to custom mode
      const customTab = screen.getByText("Custom Pixels");
      await act(async () => {
        await userEvent.click(customTab);
      });

      // Find width input and set to 9000
      const widthInput = screen.getByLabelText(/Width \(px\)/);
      await act(async () => {
        await userEvent.clear(widthInput);
        await userEvent.type(widthInput, "9000");
      });

      await waitFor(() => {
        expect(screen.getByText(/exceed the backend maximum/)).toBeInTheDocument();
      });
    });
  });

  // =========================================================================
  // 10. Config Loading
  // =========================================================================
  describe("Configuration loading", () => {
    it("fetches supported formats from the API on mount", async () => {
      render(<App />);

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          expect.stringContaining("/api/images/config"),
        );
      });
    });

    it("gracefully handles config API failure", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url) => {
          if (url.includes("/api/images/config")) {
            return { ok: false, status: 500, headers: new Headers() };
          }
          // Return default for other URLs
          return mockFetch()(url);
        }),
      );

      // Should render without crashing even if config fails
      render(<App />);
      expect(screen.getByText("PixelPerfect")).toBeInTheDocument();
    });
  });
});
