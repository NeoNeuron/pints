import { HERO } from "./config.mjs";

/**
 * Shaping and paths for the home page hero photographs.
 *
 * Pure, and separate from js/hero-slider.js for the same reason
 * js/slideshow-utils.mjs is separate from js/slideshow.js: this half is
 * testable under Node, and the half that touches the DOM is not.
 *
 * The index arithmetic is deliberately *not* here -- stepIndex and
 * neighbourIndexes in js/slideshow-utils.mjs already do it, already wrap
 * correctly at both ends, and are already tested. The slider imports them.
 */

/** A hero entry is only usable if it points at an image. */
const usable = (photo) => typeof photo?.url === "string" && photo.url.trim() !== "";

/**
 * The config/hero document into the list the slider shows: unusable entries
 * dropped, every field a string, and no more than HERO.maxPhotos of them.
 *
 * The cap is applied here as well as in firestore.rules because the rules
 * protect the database and this protects the visitor: a document written before
 * the cap existed must not turn the landing page into a photo album.
 */
export function heroPhotos(doc) {
  return (doc?.photos ?? [])
    .filter(usable)
    .slice(0, HERO.maxPhotos)
    .map((photo) => ({
      path: String(photo.path ?? ""),
      url: photo.url,
      alt: String(photo.alt ?? ""),
    }));
}

/**
 * Storage object path for a hero photograph.
 *
 * The uid is in the path for the same reason it is in figurePath(): storage
 * rules cannot read Firestore, so they cannot ask whether the uploader is an
 * organizer. Matching the uid in the path is the strongest check available
 * there, and the Firestore write that actually puts a photo on the home page is
 * admin-gated separately.
 */
export function heroPath(uid, id) {
  return `hero/${uid}/${id}`;
}

/** A fresh object id. Two organizers uploading at once must not collide. */
export function heroPhotoId() {
  return crypto.randomUUID();
}

/**
 * Move the photo at `from` to `to`, returning a new list.
 *
 * The admin tab reorders with up/down buttons rather than drag-and-drop: the
 * list is at most twelve long, and a keyboard user gets the same affordance as
 * everybody else without a drag implementation.
 */
export function movePhoto(photos, from, to) {
  const list = [...(photos ?? [])];
  if (!Number.isInteger(from) || from < 0 || from >= list.length) return list;
  if (!Number.isInteger(to) || to < 0 || to >= list.length) return list;
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  return list;
}
