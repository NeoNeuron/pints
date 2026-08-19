/**
 * Index arithmetic and shaping for the archive slideshow.
 *
 * Pure, because off-by-one errors in a carousel are invisible until somebody
 * clicks past the end and the page goes blank. The DOM half lives in
 * js/slideshow.js.
 */

/** A gallery entry is only usable if it points at an image. */
const usable = (photo) => typeof photo?.url === "string" && photo.url.trim() !== "";

/**
 * Gallery documents into what the slideshow shows: one bucket per year, newest
 * first, with unusable entries and empty years dropped.
 *
 * Newest first because "what did last year look like" is the question people
 * arrive with; the older editions are still one click away in the year picker.
 */
export function galleryYears(docs) {
  return (docs ?? [])
    .map((doc) => ({
      year: Number(doc?.year),
      photos: (doc?.photos ?? []).filter(usable).map((photo) => ({
        name: String(photo.name ?? ""),
        url: photo.url,
        caption: String(photo.caption ?? ""),
        // The Storage object behind the photograph, or "" for one synced from
        // Dropbox. The public slideshow has no use for it; the admin console
        // renders from this same shaping and needs it to know whether Remove
        // may delete the object -- see ownsObject() in js/album-utils.mjs.
        path: String(photo.path ?? ""),
      })),
    }))
    .filter((entry) => Number.isFinite(entry.year) && entry.photos.length > 0)
    .sort((a, b) => b.year - a.year);
}

/**
 * Move `delta` slides from `index`, wrapping at both ends.
 *
 * Wrapping rather than stopping: with a next button that does nothing at the
 * last photo, people conclude the page is broken rather than that they have
 * reached the end.
 */
export function stepIndex(index, delta, length) {
  if (!Number.isFinite(length) || length <= 0) return 0;
  const from = Number.isFinite(index) ? index : 0;
  return (((from + delta) % length) + length) % length;
}

/** "3 of 12", or nothing at all when there is nothing to count. */
export function slideLabel(index, length) {
  if (!Number.isFinite(length) || length <= 0) return "";
  return `${stepIndex(index, 0, length) + 1} of ${length}`;
}

/**
 * The slides worth fetching before they are asked for: the neighbours of the one
 * on screen, and nothing else.
 *
 * Preloading both makes the next click instant in either direction without
 * fetching a whole edition's photographs to show one of them. Returns an empty
 * list when there is nowhere to go.
 */
export function neighbourIndexes(current, length) {
  if (!Number.isFinite(length) || length <= 1) return [];
  const next = stepIndex(current, 1, length);
  const previous = stepIndex(current, -1, length);
  return next === previous ? [next] : [next, previous];
}
