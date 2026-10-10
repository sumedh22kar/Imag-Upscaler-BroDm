import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Ensure React 19 recognises the jsdom test environment for act()
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Automatic cleanup after each test
afterEach(() => {
  cleanup();
});

// Stub URL.createObjectURL / revokeObjectURL (not available in jsdom)
if (typeof URL.createObjectURL === "undefined") {
  URL.createObjectURL = vi.fn(() => "blob:http://localhost/fake-object-url");
}
if (typeof URL.revokeObjectURL === "undefined") {
  URL.revokeObjectURL = vi.fn();
}

// Stub HTMLElement.prototype.setPointerCapture / releasePointerCapture
if (typeof HTMLElement.prototype.setPointerCapture === "undefined") {
  HTMLElement.prototype.setPointerCapture = vi.fn();
}
if (typeof HTMLElement.prototype.releasePointerCapture === "undefined") {
  HTMLElement.prototype.releasePointerCapture = vi.fn();
}

// Provide a minimal matchMedia stub for prefers-reduced-motion etc.
if (typeof window.matchMedia === "undefined") {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}
