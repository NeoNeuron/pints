import { FIGURE } from "./config.mjs";

/**
 * Pure checks and maths for abstract figures. The canvas work that actually
 * resizes the bitmap lives in js/storage.js, because it needs a browser; this
 * module stays testable under Node.
 */

/** Same limits as storage.rules. Returns { valid, errors[] }. */
export function validateFigure({ type, size } = {}) {
  const errors = [];
  if (!FIGURE.types.includes(type)) {
    errors.push("The figure must be a PNG, JPEG, or WebP image.");
  }
  if (!Number.isFinite(size) || size <= 0) errors.push("The figure file appears to be empty.");
  else if (size > FIGURE.maxBytes) {
    errors.push(`The figure must be under ${Math.round(FIGURE.maxBytes / (1024 * 1024))} MB.`);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Fit within a maxEdge square, preserving aspect ratio. Never enlarges: a small
 * figure is left alone rather than upscaled into blur.
 */
export function targetSize(width, height, maxEdge = FIGURE.maxEdge) {
  const w = Math.max(0, Math.round(Number(width) || 0));
  const h = Math.max(0, Math.round(Number(height) || 0));
  if (!w || !h) return { width: w, height: h };
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { width: w, height: h };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/**
 * PNG survives as PNG because it may carry transparency that JPEG would fill
 * with black; everything else is re-encoded as JPEG, which is far smaller for
 * the photographs and rendered plots people actually attach.
 */
export function outputType(inputType) {
  return inputType === "image/png" ? "image/png" : "image/jpeg";
}

/** Storage object path. Ownership is encoded in the path — storage.rules cannot read Firestore. */
export function figurePath(uid, abstractId) {
  return `abstract_figures/${uid}/${abstractId}`;
}
