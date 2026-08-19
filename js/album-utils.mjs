/**
 * Shaping, paths and ownership for the archive albums.
 *
 * Pure, and separate from js/slideshow.js for the same reason
 * js/hero-utils.mjs is separate from js/hero-slider.js: this half is testable
 * under Node and the half that touches the DOM is not. The index arithmetic
 * lives in js/slideshow-utils.mjs and is shared with both slideshows.
 */

/**
 * The edition a heading is about, or null.
 *
 * The albums are anchored to the page copy by year rather than by a marker
 * typed into it, because the markdown sanitizer allows `class` but not `id`
 * (PAGE_ALLOWLIST in js/markdown-render-utils.mjs) -- there is no stable handle
 * to put in the copy in the first place. Matching the year means "## PINTS 2025"
 * and "## The 2025 meeting" both work and neither has to be remembered.
 *
 * A heading with no year finds nothing, and its album falls back to the section
 * at the foot of the page rather than disappearing.
 */
export function yearInHeading(text) {
  const found = String(text ?? "").match(/\b(?:19|20)\d{2}\b/);
  return found ? Number(found[0]) : null;
}

/**
 * Storage object path for an archive photograph.
 *
 * `archive/`, not `gallery/`, even though the Firestore collection is called
 * gallery: that collection is keyed by year and this prefix is keyed by uploader,
 * and two different things under one name is a trap for whoever reads it next.
 *
 * The uid is in the path for the reason given on heroPath(): storage rules
 * cannot read Firestore, so they cannot ask whether the uploader is an organizer.
 */
export function archivePath(uid, id) {
  return `archive/${uid}/${id}`;
}

/** A fresh object id. Two organizers uploading at once must not collide. */
export function archivePhotoId() {
  return crypto.randomUUID();
}

/**
 * May the Archive tab delete the object behind this entry?
 *
 * Only what it uploaded itself. An imported photograph is one Storage object on
 * two lists -- config/hero and gallery/{year} -- so dropping it from the album
 * must leave the object alone or the home page hero goes blank. A Dropbox-synced
 * entry has no path at all and is not ours to delete either.
 */
export function ownsObject(path) {
  return String(path ?? "").startsWith("archive/");
}

/** The object id, which is what a hero photograph has instead of a file name. */
const nameFor = (photo) => {
  const tail = String(photo?.path ?? "").split("/").pop();
  return tail || String(photo?.url ?? "");
};

/**
 * The home page photographs that are not already in this album, as album entries.
 *
 * Returns only the new ones, so importing twice adds nothing the second time:
 * an organizer who cannot tell whether the first press worked will press it
 * again, and twenty-four copies of twelve photographs is the wrong answer.
 * Matched on `path`, which is the Storage object -- the url carries a token that
 * can be reissued for the same object.
 *
 * `alt` becomes `caption` because they are the same sentence written for
 * different jobs: behind the hero it is what a screen reader is told, and here it
 * is what everybody reads under the photograph.
 */
export function importedFromHero(heroPhotos, existing) {
  const already = new Set((existing ?? []).map((photo) => photo?.path).filter(Boolean));
  return (heroPhotos ?? [])
    .filter((photo) => photo?.path && !already.has(photo.path))
    .map((photo) => ({
      name: nameFor(photo),
      url: photo.url,
      caption: String(photo.alt ?? ""),
      path: photo.path,
    }));
}

/**
 * Move the photo at `from` to `to`, returning a new list.
 *
 * Both photo lists an organizer edits -- the hero and the albums -- reorder with
 * up/down buttons rather than drag-and-drop: it works with a keyboard without a
 * drag implementation, and neither list is long enough for dragging to be
 * faster.
 */
export function movePhoto(photos, from, to) {
  const list = [...(photos ?? [])];
  if (!Number.isInteger(from) || from < 0 || from >= list.length) return list;
  if (!Number.isInteger(to) || to < 0 || to >= list.length) return list;
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  return list;
}
