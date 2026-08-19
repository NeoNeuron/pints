import { galleryYears, neighbourIndexes, slideLabel, stepIndex } from "./slideshow-utils.mjs";
import { ARCHIVE } from "./config.mjs";

/**
 * The archive slideshow: one photograph at a time, one edition at a time.
 *
 * A grid of thumbnails was the obvious alternative and is worse here — these
 * are photographs of a meeting, and the caption ("the poster session", "the
 * keynote") is half of what makes one worth looking at. A grid either hides the
 * captions or drowns in them. The strip below the stage is the compromise: the
 * whole set at a glance, one caption at a time.
 *
 * Mounts nothing at all when there is nothing to show, so the Archive page is
 * exactly what it was before if the gallery is empty or Firestore is unreachable.
 *
 * Options:
 *  - `heading`  false for an album mounted under the `<h2>` that already names
 *               its edition, where a second heading would only repeat it.
 *  - `label`    the stage's accessible name. Several albums can be on one page,
 *               so "Photographs from previous editions" no longer identifies one.
 */
export function mountSlideshow(host, docs, { heading = true, label } = {}) {
  const years = galleryYears(docs);
  if (!host || !years.length) return false;

  host.hidden = false;
  host.replaceChildren();

  let year = years[0];
  let index = 0;
  let timer = null;
  let taken = false;

  const title = document.createElement("h2");

  const picker = document.createElement("div");
  picker.className = "filters";

  const stage = document.createElement("div");
  stage.className = "slideshow";

  const figure = document.createElement("figure");
  const image = document.createElement("img");
  image.decoding = "async";
  const caption = document.createElement("figcaption");
  figure.append(image, caption);

  const controls = document.createElement("div");
  controls.className = "slide-nav";

  const previous = navButton("‹", "Previous photo", () => go(-1));
  const next = navButton("›", "Next photo", () => go(1));
  const counter = document.createElement("span");
  counter.className = "muted";
  controls.append(previous, counter, next);

  // The strip is rebuilt whenever the edition changes, so it is created empty
  // here and filled by thumbnails().
  const strip = document.createElement("div");
  strip.className = "album-thumbs";
  let thumbs = [];

  stage.append(figure, controls, strip);

  const parts = [];
  if (heading) {
    title.textContent = years.length > 1
      ? "Photographs"
      : `Photographs from ${years[0].year}`;
    parts.push(title);
  }

  // A year picker only when there is more than one edition to pick between.
  if (years.length > 1) {
    parts.push(picker);
    const pick = document.createElement("label");
    pick.className = "filter";
    pick.textContent = "Edition";
    const select = document.createElement("select");
    for (const entry of years) {
      const option = document.createElement("option");
      option.value = String(entry.year);
      option.textContent = String(entry.year);
      select.append(option);
    }
    select.addEventListener("change", () => {
      takeOver();
      year = years.find((entry) => String(entry.year) === select.value) ?? years[0];
      index = 0;
      thumbnails();
      draw();
    });
    pick.append(select);
    picker.append(pick);
  }
  host.append(...parts, stage);

  /**
   * Keyboard arrows, but only while the slideshow has focus.
   *
   * A document-level listener would hijack left and right for anyone reading
   * the page copy above with the keyboard — and with an album under every
   * edition there would now be several listeners fighting over the same keys.
   */
  stage.tabIndex = 0;
  stage.setAttribute("role", "group");
  stage.setAttribute("aria-label", label || (years.length > 1
    ? "Photographs from previous editions"
    : `Photographs from PINTS ${years[0].year}`));
  stage.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") { event.preventDefault(); go(-1); }
    if (event.key === "ArrowRight") { event.preventDefault(); go(1); }
  });

  function show(delta) {
    index = stepIndex(index, delta, year.photos.length);
    draw();
  }

  /**
   * The same move, made by the reader — which ends the automatic one for good.
   *
   * Not a reset of the timer: somebody who has started paging through an album
   * is looking at a particular photograph, and having it slide away seven
   * seconds later is the carousel arguing with them. Taking control is also the
   * mechanism WCAG 2.2.2 asks for, since the arrows and the thumbnails are on
   * screen the whole time and pressing any of them stops the movement.
   */
  function go(delta) {
    takeOver();
    show(delta);
  }

  /**
   * One button per photograph, jumping straight to it.
   *
   * These point at the full-size objects: there is one size of each photograph
   * in Storage, so a twelve-photo album is a few megabytes if every thumbnail
   * loads. `loading="lazy"` and the album sitting below the fold keep that off
   * the critical path; a much larger album would want a second, smaller object
   * generated at upload time.
   */
  function thumbnails() {
    strip.replaceChildren();
    thumbs = [];
    // One photograph is not a slideshow, and a strip of one is not a chooser.
    strip.hidden = year.photos.length < 2;
    if (strip.hidden) return;

    for (const [at, photo] of year.photos.entries()) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "album-thumb";
      button.setAttribute("aria-label",
        photo.caption || `Photo ${at + 1} of ${year.photos.length}`);
      button.title = photo.caption || `Photo ${at + 1}`;

      const thumb = document.createElement("img");
      thumb.src = photo.url;
      thumb.alt = "";
      thumb.loading = "lazy";
      thumb.decoding = "async";

      button.append(thumb);
      button.addEventListener("click", () => { takeOver(); index = at; draw(); });
      strip.append(button);
      thumbs.push(button);
    }
  }

  /**
   * Scroll the strip, and only the strip, far enough to show the active thumb.
   *
   * Not scrollIntoView(): that scrolls every scrollable ancestor, so advancing a
   * slide would yank the page down to the album while somebody was reading the
   * copy above it.
   */
  function revealThumb(button) {
    if (!button) return;
    const left = button.offsetLeft;
    const right = left + button.offsetWidth;
    if (left < strip.scrollLeft) strip.scrollLeft = left;
    else if (right > strip.scrollLeft + strip.clientWidth) {
      strip.scrollLeft = right - strip.clientWidth;
    }
  }

  function draw() {
    const photo = year.photos[index];
    image.src = photo.url;
    // The caption doubles as the alt text: it is what somebody who cannot see
    // the photograph would have been told about it anyway.
    image.alt = photo.caption || `Photograph from PINTS ${year.year}`;
    caption.textContent = photo.caption;
    caption.hidden = !photo.caption;
    counter.textContent = slideLabel(index, year.photos.length);

    // One photograph is not a slideshow. Leave it on screen without controls
    // that do nothing.
    const many = year.photos.length > 1;
    previous.hidden = !many;
    next.hidden = !many;
    counter.hidden = !many;

    for (const [at, button] of thumbs.entries()) {
      if (at === index) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    }
    revealThumb(thumbs[index]);

    preload();
  }

  function start() {
    if (!taken && !document.hidden) timer ??= setInterval(() => show(1), ARCHIVE.intervalMs);
  }

  function stop() {
    clearInterval(timer);
    timer = null;
  }

  /** The reader has the wheel now. Nothing restarts the timer after this. */
  function takeOver() {
    taken = true;
    stop();
  }

  /** Fetch the slides on either side now, so the next click does not wait. */
  function preload() {
    for (const nearby of neighbourIndexes(index, year.photos.length)) {
      const warm = new Image();
      warm.src = year.photos[nearby].url;
    }
  }

  thumbnails();
  draw();

  // A single photograph is not a slideshow, and somebody who has asked for less
  // motion should not have a timer running behind a still image either. The
  // hero takes the same two exits for the same reasons (js/hero-slider.js).
  const still = year.photos.length < 2
    || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!still) {
    // Paused while the pointer is over the album or the keyboard is inside it:
    // reading a caption should not be interrupted by the photograph above it
    // changing. Not a takeover — moving away resumes.
    stage.addEventListener("mouseenter", stop);
    stage.addEventListener("mouseleave", start);
    stage.addEventListener("focusin", stop);
    stage.addEventListener("focusout", start);
    // A backgrounded tab would otherwise churn through the whole album, so that
    // coming back lands on an arbitrary photograph.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop(); else start();
    });
    start();
  }
  return true;
}

function navButton(glyph, label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary";
  button.textContent = glyph;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.addEventListener("click", onClick);
  return button;
}
