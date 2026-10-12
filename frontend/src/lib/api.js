export const API = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8808").replace(/\/+$/, "");

export const isLocalApi = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(API);

export const OFFLINE_MESSAGE = isLocalApi
  ? "Can't reach the processing server. Start the Spring Boot backend on port 8808 and try again."
  : "Can't reach the processing server right now. Try again in a moment.";

const STATUS_MESSAGES = {
  400: "The server rejected these settings. Check the size and format and try again.",
  413: "That file is over the 50 MB upload limit.",
  415: "That file type isn't supported. Use PNG, JPEG, WebP, BMP or TIFF.",
  429: "The server is busy with other jobs. Wait a few seconds and try again.",
  500: "Something went wrong while processing the image. Try again.",
  502: "The processing server is temporarily unavailable.",
  503: "The processing server is temporarily unavailable.",
  504: "The processing server took too long to respond.",
};

/** Pulls the most useful human-readable message out of a failed response. */
export async function parseApiError(response) {
  let message = "";
  try {
    const type = response.headers.get("content-type") || "";
    if (type.includes("application/json")) {
      const body = await response.json();
      if (body?.validationErrors && typeof body.validationErrors === "object") {
        message = Object.values(body.validationErrors).flat().filter(Boolean).join(". ");
      }
      message = message || body?.message || body?.error || "";
    } else {
      const text = (await response.text())?.trim();
      if (text && text.length < 250 && !/<!doctype|<html/i.test(text)) message = text;
    }
  } catch {
    // fall through to the status-based message
  }
  return message || STATUS_MESSAGES[response.status] || `Processing failed (HTTP ${response.status}).`;
}
