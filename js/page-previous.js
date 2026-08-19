import { mountLayout, setAuthLink } from "./layout.js";
import { onUser } from "./auth.js";
import { hydrateMarkdownHosts } from "./content-hydrate.js";
import { listGallery } from "./db.js";
import { mountSlideshow } from "./slideshow.js";
import { yearInHeading } from "./album-utils.mjs";

mountLayout();
onUser(({ user, isAdmin }) => setAuthLink({ signedIn: Boolean(user), isAdmin }));

// The page copy first, and on its own: the albums are an addition to this page,
// not the point of it. If the gallery read fails the archive still reads exactly
// as it did before there were any photographs.
await hydrateMarkdownHosts();

/**
 * A place to mount the album for `year`, at the end of the section whose heading
 * names it — or null when no heading does.
 *
 * The anchor is the year in the heading text rather than a marker typed into the
 * page copy because there is nothing stable to type: the markdown sanitizer
 * allows `class` but not `id` (PAGE_ALLOWLIST in js/markdown-render-utils.mjs),
 * and a class name an organizer has to remember is a class name that will one
 * day be misspelt. Rewording "PINTS 2025" to "The 2025 meeting" keeps working;
 * dropping the year altogether sends the album to the foot of the page, which is
 * where it used to live anyway.
 */
function albumHostFor(prose, year) {
  const headings = [...prose.querySelectorAll("h2")];
  const heading = headings.find((h2) => yearInHeading(h2.textContent) === year);
  if (!heading) return null;

  // The end of this edition's section: everything up to the next h2.
  let end = heading.nextElementSibling;
  while (end && end.tagName !== "H2") end = end.nextElementSibling;

  const album = document.createElement("div");
  album.className = "archive-album";
  prose.insertBefore(album, end);
  return album;
}

try {
  const docs = await listGallery();
  const prose = document.querySelector("[data-markdown]");
  const anchored = new Set();

  // One album per edition, under its own heading. mountSlideshow takes gallery
  // documents rather than shaped entries, so each gets its own one-document list
  // — which is also what makes it drop the year picker and show that year alone.
  for (const doc of docs) {
    const year = Number(doc?.year);
    if (!prose || !Number.isFinite(year)) continue;
    const host = albumHostFor(prose, year);
    if (!host) continue;
    const mounted = mountSlideshow(host, [doc], {
      heading: false,
      label: `Photographs from PINTS ${year}`,
    });
    if (mounted) anchored.add(year);
    else host.remove();   // an edition with a document but no usable photographs
  }

  // Whatever found no heading to sit under. Usually nothing, which leaves this
  // section hidden exactly as it is today.
  mountSlideshow(document.getElementById("gallery"),
    docs.filter((doc) => !anchored.has(Number(doc?.year))));
} catch (err) {
  console.error("[pints] gallery", err);
}
