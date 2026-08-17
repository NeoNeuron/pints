import { galleryYears, neighbourIndexes, slideLabel, stepIndex } from "./slideshow-utils.mjs";

/**
 * The archive slideshow: one photograph at a time, one edition at a time.
 *
 * A grid of thumbnails was the obvious alternative and is worse here — these
 * are photographs of a meeting, and the caption ("the poster session", "the
 * keynote") is half of what makes one worth looking at. A grid either hides the
 * captions or drowns in them.
 *
 * Mounts nothing at all when there is nothing to show, so the Archive page is
 * exactly what it was before if the gallery is empty or Firestore is unreachable.
 */
export function mountSlideshow(host, docs) {
  const years = galleryYears(docs);
  if (!years.length) return false;

  host.hidden = false;
  host.replaceChildren();

  let year = years[0];
  let index = 0;

  const heading = document.createElement("h2");
  heading.textContent = "Photographs";

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

  stage.append(figure, controls);

  // A year picker only when there is more than one edition to pick between.
  if (years.length > 1) {
    const label = document.createElement("label");
    label.className = "filter";
    label.textContent = "Edition";
    const select = document.createElement("select");
    for (const entry of years) {
      const option = document.createElement("option");
      option.value = String(entry.year);
      option.textContent = String(entry.year);
      select.append(option);
    }
    select.addEventListener("change", () => {
      year = years.find((entry) => String(entry.year) === select.value) ?? years[0];
      index = 0;
      draw();
    });
    label.append(select);
    picker.append(label);
    host.append(heading, picker, stage);
  } else {
    heading.textContent = `Photographs from ${years[0].year}`;
    host.append(heading, stage);
  }

  /**
   * Keyboard arrows, but only while the slideshow has focus.
   *
   * A document-level listener would hijack left and right for anyone reading
   * the page copy above with the keyboard.
   */
  stage.tabIndex = 0;
  stage.setAttribute("role", "group");
  stage.setAttribute("aria-label", "Photographs from previous editions");
  stage.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") { event.preventDefault(); go(-1); }
    if (event.key === "ArrowRight") { event.preventDefault(); go(1); }
  });

  function go(delta) {
    index = stepIndex(index, delta, year.photos.length);
    draw();
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

    preload();
  }

  /** Fetch the slides on either side now, so the next click does not wait. */
  function preload() {
    for (const nearby of neighbourIndexes(index, year.photos.length)) {
      const warm = new Image();
      warm.src = year.photos[nearby].url;
    }
  }

  draw();
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
