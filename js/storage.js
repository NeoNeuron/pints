import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";
// The shared instance, not a second getStorage(app): only that one has been
// pointed at the emulator when a page asks for it.
import { storage } from "./firebase.js";
import { FIGURE } from "./config.mjs";
import { figurePath, outputType, targetSize } from "./figure-utils.mjs";

export { storage };

/**
 * Downscale in a canvas before upload.
 *
 * Two reasons this is not optional. A phone photograph of a plot is routinely
 * 6 MB, which storage.rules rejects outright; and every accepted figure is
 * fetched by every visitor to abstracts.html, so the page weight is the real
 * cost, not the bucket. Resolves to a Blob of `outputType(file.type)`.
 */
async function downscale(file) {
  const bitmap = await createImageBitmap(file);
  const { width, height } = targetSize(bitmap.width, bitmap.height, FIGURE.maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const type = outputType(file.type);
  // White behind a transparent source, so a JPEG re-encode does not go black.
  const ctx = canvas.getContext("2d");
  if (type !== "image/png") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, type, type === "image/png" ? undefined : 0.85));
  // A canvas that fails to encode returns null; fall back to the original file
  // rather than losing the figure altogether.
  return blob ?? file;
}

/** Upload (replacing any previous figure at the same path). -> { url, path }. */
export async function uploadFigure(uid, abstractId, file) {
  const path = figurePath(uid, abstractId);
  const blob = await downscale(file);
  const objectRef = ref(storage, path);
  await uploadBytes(objectRef, blob, { contentType: blob.type || outputType(file.type) });
  return { url: await getDownloadURL(objectRef), path };
}

/**
 * Delete an uploaded figure. A missing object is not an error worth surfacing:
 * the caller's goal is "no figure here", which is already true.
 */
export async function deleteFigure(path) {
  if (!path) return;
  try {
    await deleteObject(ref(storage, path));
  } catch (err) {
    if (err?.code !== "storage/object-not-found") throw err;
  }
}
