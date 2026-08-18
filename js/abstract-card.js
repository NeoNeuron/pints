import { TOPIC_LABELS } from "./config.mjs";
import { authorLineParts, summaryAuthorLine } from "./abstract-utils.mjs";
import { renderAbstractHtml } from "./markdown.js";

// One abstract, drawn in one place. The public list, the live preview inside the
// submission form, the confirmation after a submission and the shared-link page
// all render through here — "what you see is what gets published" is a promise
// the form cannot keep if a second, simpler renderer lives next door.
//
// `abstract` is either a stored document or a draft straight out of the form, so
// every field is optional and `figureUrl` may be an object: URL that exists only
// in this tab.
//
// The parts below are separate because the list needs them in two groups: what
// goes in a collapsed row, and what waits behind the disclosure.

/** Poster board number or talk pill, then the title. Nodes, not an element. */
function headingParts(abstract) {
  const parts = [];
  if (abstract.type === "poster" && abstract.posterNumber) {
    const number = document.createElement("span");
    number.className = "poster-no";
    number.textContent = `P${abstract.posterNumber} `;
    parts.push(number);
  } else if (abstract.type === "talk") {
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = "talk";
    parts.push(pill, document.createTextNode(" "));
  }
  // textContent for the title: untrusted input.
  parts.push(document.createTextNode(abstract.title ?? ""));
  return parts;
}

/** Every author, with their affiliation superscripts; the presenter in bold. */
function bylineEl(abstract) {
  const byline = document.createElement("p");
  byline.className = "byline";
  authorLineParts(abstract.authors).forEach((part, i) => {
    if (i) byline.append(document.createTextNode(", "));
    const name = document.createElement(part.presenting ? "strong" : "span");
    name.textContent = part.name;
    byline.append(name);
    if (part.marks) {
      const sup = document.createElement("sup");
      sup.textContent = part.marks;
      byline.append(sup);
    }
  });
  return byline;
}

function affiliationsEl(abstract) {
  const affil = document.createElement("p");
  affil.className = "byline";
  affil.textContent = (abstract.affiliations ?? []).map((a, i) => `${i + 1}. ${a}`).join("   ");
  return affil;
}

function bodyEl(abstract) {
  const body = document.createElement("div");
  // The only innerHTML here, and only through the tight untrusted allowlist.
  body.innerHTML = renderAbstractHtml(abstract.body);
  return body;
}

function topicPill(abstract) {
  if (!abstract.topic) return null;
  const pill = document.createElement("span");
  pill.className = "pill";
  pill.textContent = TOPIC_LABELS[abstract.topic] ?? abstract.topic;
  return pill;
}

/** Status, topic and the share link, on one line. */
function metaEl(abstract, { statusLabel, permalink, topic = true }) {
  const meta = document.createElement("p");
  meta.className = "card-meta";
  if (statusLabel) {
    const pill = document.createElement("span");
    pill.className = "pill status";
    pill.textContent = statusLabel;
    meta.append(pill, " ");
  }
  const topicEl = topic ? topicPill(abstract) : null;
  if (topicEl) meta.append(topicEl, " ");
  if (permalink) {
    const link = document.createElement("a");
    link.className = "permalink";
    link.href = permalink;
    link.textContent = "Link to this abstract";
    meta.append(link);
  }
  return meta;
}

/**
 * The figure and its caption.
 *
 * Built with createElement, never through the markdown renderer:
 * ABSTRACT_ALLOWLIST forbids <img> in a submitted body and must keep doing so.
 * The caption is participant input too, so it goes in as text, not markup.
 */
function figureEl(abstract) {
  const figure = document.createElement("figure");
  if (!abstract.figureUrl) return figure;
  const img = document.createElement("img");
  img.src = abstract.figureUrl;
  img.alt = abstract.figureCaption || `Figure for “${abstract.title ?? "this abstract"}”`;
  // Deliberately NOT loading="lazy", which was here and was actively broken. An
  // unloaded image with no width/height collapses to 0x0, and a zero-area target
  // never registers as on-screen, so a figure revealed by opening a disclosure
  // would sit blank until something else forced a layout — and would print
  // blank, which defeats the whole point of the print handler. Every caller now
  // renders exactly one abstract's figure at a time, or has already deferred the
  // work by not building the disclosure body, so there is nothing left to defer.
  img.decoding = "async";
  figure.append(img);
  if (abstract.figureCaption) {
    const caption = document.createElement("figcaption");
    caption.textContent = abstract.figureCaption;
    figure.append(caption);
  }
  return figure;
}

/**
 * The whole abstract, open: heading, meta, authors, body, figure.
 *
 * Options:
 *   statusLabel  a pill above the title ("In review", "Accepted as a talk")
 *   permalink    href for a "Link to this abstract" control
 *   headingLevel "h1" for a page that is one abstract, "h3" inside a list
 */
export function abstractCard(abstract, {
  statusLabel = null,
  permalink = null,
  headingLevel = "h3",
} = {}) {
  const article = document.createElement("article");
  article.className = "card";
  const heading = document.createElement(headingLevel);
  heading.append(...headingParts(abstract));
  article.append(
    heading,
    metaEl(abstract, { statusLabel, permalink }),
    bylineEl(abstract),
    affiliationsEl(abstract),
    bodyEl(abstract),
    figureEl(abstract),
  );
  return article;
}

/**
 * The same abstract as one row of a long list: title and presenting author,
 * everything else behind a disclosure.
 *
 * **The body is built on first open, not now.** That is the entire point of this
 * function. A poster session runs to hundreds of abstracts, and a <details> that
 * already contains its <img> still fetches it — collapsed markup is not a
 * deferred download. Building on `toggle` means the page costs one line per
 * abstract until somebody asks for more.
 */
export function abstractDisclosure(abstract, { permalink = null } = {}) {
  const details = document.createElement("details");
  details.className = "abstract";

  const summary = document.createElement("summary");
  const line = document.createElement("span");
  line.className = "summary-title";
  line.append(...headingParts(abstract));
  summary.append(line);

  const authors = summaryAuthorLine(abstract.authors);
  if (authors) {
    const who = document.createElement("span");
    who.className = "summary-authors";
    who.textContent = authors;
    summary.append(who);
  }
  // No topic pill: the list groups under topic headings, so every row in a group
  // would carry the same one.
  details.append(summary);

  let built = false;
  const build = () => {
    if (built) return;
    built = true;
    const body = document.createElement("div");
    body.className = "abstract-body";
    body.append(
      bylineEl(abstract),
      affiliationsEl(abstract),
      bodyEl(abstract),
      figureEl(abstract),
      // topic:false — the list prints a topic heading above each group, so a
      // pill here would repeat it on every row of that group.
      metaEl(abstract, { statusLabel: null, permalink, topic: false }),
    );
    details.append(body);
  };
  // Setting `open` in script fires toggle too, so expand-all and the
  // before-print handler come through here as well.
  details.addEventListener("toggle", () => {
    if (details.open) build();
  });
  return details;
}

/** Where an accepted abstract lives, for sharing. Relative, like every link here. */
export const abstractPermalink = (id) => `abstracts.html?a=${encodeURIComponent(id)}`;
