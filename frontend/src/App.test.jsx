import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/image.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    renderCrop: vi.fn(async () => ({ blob: new Blob(["crop"], { type: "image/png" }), ext: ".png" })),
  };
});

import { renderCrop } from "./lib/image.js";
import App from "./App.jsx";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

function imageFile(name = "photo.png", type = "image/png", size = 2048) {
  return new File([new ArrayBuffer(size)], name, { type });
}

function stubImage(width, height) {
  const original = globalThis.Image;
  globalThis.Image = class {
    get naturalWidth() {
      return width;
    }
    get naturalHeight() {
      return height;
    }
    set src(_v) {
      setTimeout(() => this.onload?.(), 0);
    }
  };
  return () => {
    globalThis.Image = original;
  };
}

function mockFetch({ upscale, config } = {}) {
  return vi.fn(async (url, opts) => {
    const u = String(url);
    if (u.includes("/config")) {
      if (config === "down") throw new TypeError("Failed to fetch");
      return { ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ supportedFormats: ["PNG", "JPEG", "WEBP", "BMP", "TIFF"] }) };
    }
    if (u.includes("/upscale")) {
      if (upscale) return upscale(opts);
      const body = opts.body;
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          dataUrl: PNG,
          targetWidth: Number(body.get("targetWidth")),
          targetHeight: Number(body.get("targetHeight")),
          outputFormat: body.get("outputFormat"),
          dpi: Number(body.get("dpi")),
          outputSizeBytes: 123456,
          processingDurationMs: 2400,
        }),
      };
    }
    return { ok: false, status: 404, headers: new Headers(), json: async () => ({}), text: async () => "" };
  });
}

const fileInput = () => document.querySelector('input[type="file"]');
const radio = (name) => screen.getByRole("radio", { name });

async function load(user, file = imageFile()) {
  await user.upload(fileInput(), file);
  await screen.findByText(file.name);
  await screen.findByText("Original");
}

let restoreImage;
let fetchMock;

beforeEach(() => {
  restoreImage = stubImage(800, 600);
  fetchMock = mockFetch();
  vi.stubGlobal("fetch", fetchMock);
  renderCrop.mockClear();
});

afterEach(() => {
  restoreImage();
  vi.unstubAllGlobals();
});

describe("first screen", () => {
  it("shows the brand, the empty sheet and a disabled action", async () => {
    render(<App />);
    expect(screen.getByText("PixelPerfect")).toBeInTheDocument();
    expect(screen.getByText("Drop an image on the sheet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upscale image" })).toBeDisabled();
    expect(screen.getByText("Add an image to continue.")).toBeInTheDocument();
    expect(await screen.findByText("Server ready")).toBeInTheDocument();
  });

  it("defaults to A4 portrait at 300 DPI", () => {
    render(<App />);
    expect(radio("A4")).toBeChecked();
    expect(radio("Portrait")).toBeChecked();
    expect(radio(/^300/)).toBeChecked();
  });

  it("says so when the server is unreachable and offers a retry", async () => {
    vi.stubGlobal("fetch", mockFetch({ config: "down" }));
    render(<App />);
    expect(await screen.findByText(/Server offline/)).toBeInTheDocument();
    vi.stubGlobal("fetch", mockFetch());
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Server ready")).toBeInTheDocument();
  });
});

describe("adding an image", () => {
  it("reads the size and picks the matching orientation", async () => {
    const user = userEvent.setup();
    render(<App />);
    await load(user);
    expect(screen.getByText("photo.png")).toBeInTheDocument();
    expect(radio("Landscape")).toBeChecked();
    expect(screen.getByRole("button", { name: "Upscale image" })).toBeEnabled();
  });

  it("accepts a dropped file", async () => {
    render(<App />);
    const stage = screen.getByRole("region", { name: "Preview" });
    fireEvent.drop(stage, { dataTransfer: { files: [imageFile("dropped.png")] } });
    expect(await screen.findByText("dropped.png")).toBeInTheDocument();
  });

  it("rejects unsupported files with a clear message", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<App />);
    await user.upload(fileInput(), new File(["x"], "notes.pdf", { type: "application/pdf" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/isn't a supported image/);
  });

  it("rejects files over 50 MB", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.upload(fileInput(), imageFile("huge.png", "image/png", 52_428_801));
    expect(await screen.findByRole("alert")).toHaveTextContent(/50 MB/);
  });

  it("clears everything when the image is removed", async () => {
    const user = userEvent.setup();
    render(<App />);
    await load(user);
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByText("Drop an image on the sheet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upscale image" })).toBeDisabled();
  });
});

describe("paper sizing", () => {
  it("shows the exact output and print size", async () => {
    const user = userEvent.setup();
    render(<App />);
    await load(user);
    expect(screen.getByText("3307 × 2480 px")).toBeInTheDocument();
    expect(screen.getByText(/28\.0 × 21\.0 cm at 300 DPI/)).toBeInTheDocument();
  });

  it("rates print quality from the original's pixels per inch", async () => {
    const user = userEvent.setup();
    render(<App />);
    await load(user);
    expect(screen.getByText(/pixels per inch from your original/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Print quality 1 of 4: Soft/ })).toBeInTheDocument();
    await user.click(radio("A5"));
    await user.click(radio(/^150/));
    expect(screen.getByRole("img", { name: /Print quality/ })).toBeInTheDocument();
  });

  it("converts custom sizes when the unit changes", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(radio("Custom"));
    expect(screen.getByLabelText("Width (cm)")).toHaveValue(20);
    await user.click(radio("in"));
    expect(screen.getByLabelText("Width (in)")).toHaveValue(7.87);
  });

  it("blocks a sheet that is too big and offers the DPI that fits", async () => {
    const user = userEvent.setup();
    render(<App />);
    await load(user);
    await user.click(radio("A3"));
    await user.click(radio(/^600/));
    expect(screen.getByRole("alert")).toHaveTextContent(/over the 8192 px limit/);
    expect(screen.getByRole("button", { name: "Upscale image" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Use 300 DPI" }));
    expect(radio(/^300/)).toBeChecked();
    expect(screen.getByRole("button", { name: "Upscale image" })).toBeEnabled();
  });
});

describe("pixels and scale", () => {
  it("keeps proportions when one side is typed", async () => {
    const user = userEvent.setup();
    render(<App />);
    await load(user);
    await user.click(radio("Pixels"));
    const w = screen.getByLabelText("Width (px)");
    await user.clear(w);
    await user.type(w, "1600");
    expect(screen.getByLabelText("Height (px)")).toHaveValue(1200);
  });

  it("lets the sides change independently when proportions are unlocked", async () => {
    const user = userEvent.setup();
    render(<App />);
    await load(user);
    await user.click(radio("Pixels"));
    await user.click(screen.getByRole("button", { name: /Keep the image's proportions/ }));
    const w = screen.getByLabelText("Width (px)");
    await user.clear(w);
    await user.type(w, "1000");
    expect(screen.getByLabelText("Height (px)")).toHaveValue(600);
  });

  it("disables scales that would pass the pixel cap", async () => {
    restoreImage();
    restoreImage = stubImage(2000, 1500);
    const user = userEvent.setup();
    render(<App />);
    await user.upload(fileInput(), imageFile());
    await screen.findByText("Original");
    await user.click(radio("Scale"));
    expect(radio(/^8×/)).toBeDisabled();
    expect(radio(/^4×/)).toBeEnabled();
  });
});

describe("processing", () => {
  it("sends exact settings and offers the download", async () => {
    const user = userEvent.setup();
    render(<App />);
    await load(user);
    await user.click(screen.getByRole("button", { name: "Upscale image" }));
    expect(await screen.findByRole("button", { name: "Download PNG" })).toBeInTheDocument();

    const call = fetchMock.mock.calls.find(([u]) => String(u).includes("/upscale"));
    const form = call[1].body;
    expect(form.get("targetWidth")).toBe("3508");
    expect(form.get("targetHeight")).toBe("2480");
    expect(form.get("maintainAspectRatio")).toBe("true");
    expect(form.get("dpi")).toBe("300");
    expect(form.get("model")).toBe("bicubic");
    expect(renderCrop).not.toHaveBeenCalled();
    expect(screen.getByText(/Upscaled to 3508 × 2480 px in 2\.4 s/)).toBeInTheDocument();
  });

  it("crops in the browser and asks for exact dimensions in fill mode", async () => {
    const user = userEvent.setup();
    render(<App />);
    await load(user);
    await user.click(radio(/^Fill sheet/));
    await user.click(screen.getByRole("button", { name: "Upscale image" }));
    await screen.findByRole("button", { name: "Download PNG" });

    expect(renderCrop).toHaveBeenCalledTimes(1);
    const crop = renderCrop.mock.calls[0][1];
    expect(crop.w / crop.h).toBeCloseTo(3508 / 2480, 1);
    const form = fetchMock.mock.calls.find(([u]) => String(u).includes("/upscale"))[1].body;
    expect(form.get("maintainAspectRatio")).toBe("false");
    expect(form.get("file").name).toBe("photo.png");
  });

  it("hides a stale result as soon as a setting changes", async () => {
    const user = userEvent.setup();
    render(<App />);
    await load(user);
    await user.click(screen.getByRole("button", { name: "Upscale image" }));
    await screen.findByRole("button", { name: "Download PNG" });
    await user.click(radio(/^150/));
    expect(screen.queryByRole("button", { name: "Download PNG" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upscale image" })).toBeEnabled();
  });

  it("downloads with a descriptive file name", async () => {
    const user = userEvent.setup();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<App />);
    await load(user);
    await user.click(screen.getByRole("button", { name: "Upscale image" }));
    await user.click(await screen.findByRole("button", { name: "Download PNG" }));
    expect(click).toHaveBeenCalled();
    const anchor = click.mock.contexts[0];
    expect(anchor.download).toBe("photo-A4-3508x2480-300dpi.png");
    click.mockRestore();
  });

  it("shows the server's own message when it rejects the job", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        upscale: async () => ({
          ok: false,
          status: 400,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ message: "AI Pro is disabled on this server." }),
        }),
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await load(user);
    await user.click(screen.getByRole("button", { name: "Upscale image" }));
    expect(await screen.findByText("AI Pro is disabled on this server.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upscale image" })).toBeEnabled();
  });

  it("reports a network failure and marks the server offline", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        upscale: async () => {
          throw new TypeError("Failed to fetch");
        },
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await load(user);
    await user.click(screen.getByRole("button", { name: "Upscale image" }));
    expect(await screen.findByText(/Can't reach the processing server/)).toBeInTheDocument();
    expect(screen.getByText(/Server offline/)).toBeInTheDocument();
  });

  it("can be cancelled while it runs", async () => {
    let release;
    vi.stubGlobal(
      "fetch",
      mockFetch({
        upscale: () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await load(user);
    await user.click(screen.getByRole("button", { name: "Upscale image" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Upscale image" })).toBeEnabled();
    release?.({ ok: true, status: 200, headers: new Headers(), json: async () => ({ dataUrl: PNG, targetWidth: 1, targetHeight: 1 }) });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Download PNG" })).not.toBeInTheDocument());
  });

  it("blocks AI on sources larger than the engine accepts", async () => {
    restoreImage();
    restoreImage = stubImage(5000, 3000);
    const user = userEvent.setup();
    render(<App />);
    await user.upload(fileInput(), imageFile());
    await screen.findByText("Original");
    await user.selectOptions(screen.getByRole("combobox", { name: "Method" }), "ai_pro");
    expect(screen.getByRole("alert")).toHaveTextContent(/AI works on images up to 4096 px/);
    expect(screen.getByRole("button", { name: "Upscale image" })).toBeDisabled();
  });
});

describe("accessibility", () => {
  it("exposes grouped controls with names", () => {
    render(<App />);
    expect(screen.getByRole("radiogroup", { name: "Paper size" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Resolution in DPI" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Resolution" })).toBeInTheDocument();
  });

  it("gives the comparison slider keyboard control", async () => {
    const user = userEvent.setup();
    render(<App />);
    await load(user);
    await user.click(screen.getByRole("button", { name: "Upscale image" }));
    const slider = await screen.findByRole("slider", { name: /Before and after/ });
    expect(slider).toHaveAttribute("aria-valuenow", "50");
    slider.focus();
    await user.keyboard("{ArrowRight}");
    expect(slider).toHaveAttribute("aria-valuenow", "55");
  });
});
