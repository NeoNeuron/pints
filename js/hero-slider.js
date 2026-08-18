import { HERO } from "./config.mjs";
import { neighbourIndexes, stepIndex } from "./slideshow-utils.mjs";

/**
 * Photographs of the meeting, sliding along behind the home page hero.
 *
 * Decoration, not content. The band is `--accent-soft` with or without this;
 * the photographs sit at a quarter strength on top of it (`--hero-photo-opacity`
 * in css/styles.css) so the hero reads as textured brand colour rather than as a
 * photo banner, and the logo and buttons keep the contrast they have today
 * without any hero-specific colours.
 *
 * That posture is why nothing here throws and nothing here is required: an
 * empty list, a Firestore outage or a browser without background-image support
 * all end at the same place, which is the flat band the site had before.
 *
 * The wrapping index arithmetic comes from js/slideshow-utils.mjs, shared with
 * the archive slideshow -- an off-by-one in a carousel is invisible until it
 * lands on a blank slide, and that module is already tested for it.
 */
export function mountHeroSlider(host, photos) {
  if (!host || !photos?.length) return false;

  host.replaceChildren();

  // Built detached and appended in one go. An element that is not yet in the
  // document does not transition, which is how the first photograph arrives
  // already in place instead of sliding in from the right on page load.
  const slides = photos.map((photo, i) => {
    const slide = document.createElement("div");
    slide.className = i === 0 ? "hero-slide current" : "hero-slide";
    return slide;
  });
  host.append(...slides);

  let index = 0;
  let timer = null;

  /**
   * Set a slide's image, once.
   *
   * Only the slides that are on screen or about to be get a background-image,
   * so arriving at the home page costs one photograph rather than twelve. The
   * guard makes this safe to call on every advance.
   */
  function paint(at) {
    const slide = slides[at];
    if (!slide || slide.dataset.painted) return;
    slide.dataset.painted = "1";
    slide.style.backgroundImage = `url("${photos[at].url}")`;
  }

  function warm(at) {
    paint(at);
    for (const nearby of neighbourIndexes(at, slides.length)) paint(nearby);
  }

  function advance() {
    const from = index;
    index = stepIndex(index, 1, slides.length);
    warm(index);
    // The outgoing slide leaves to the left; the incoming one is already
    // waiting off the right edge, which is where .hero-slide puts every slide
    // that is neither current nor leaving.
    slides[from].classList.replace("current", "leaving");
    slides[index].classList.add("current");
    // Anything that is neither of those goes back to the right edge. It has no
    // transition in that state, so it jumps rather than flying back across the
    // band in front of the reader.
    for (const [at, slide] of slides.entries()) {
      if (at !== from && at !== index) slide.classList.remove("leaving", "current");
    }
  }

  const start = () => { timer ??= setInterval(advance, HERO.intervalMs); };
  const stop = () => { clearInterval(timer); timer = null; };

  warm(0);

  // One photograph is not a slideshow, and somebody who has asked for less
  // motion should not have a timer running behind a frozen image either. In
  // both cases the first photograph is painted and nothing ever moves.
  const still = slides.length < 2
    || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (still) return true;

  // A backgrounded tab would otherwise churn through the whole set, so that
  // coming back to the page lands on an arbitrary slide mid-transition.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop(); else start();
  });
  start();
  return true;
}
