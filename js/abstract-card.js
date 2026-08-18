import { TOPIC_LABELS } from "./config.mjs";
import { authorLineParts } from "./abstract-utils.mjs";
import { renderAbstractHtml } from "./markdown.js";

/**
 * One abstract, rendered as a card. The only renderer for an abstract anywhere.
 *
 * Three callers need the same thing and used to disagree about it: the public
 * list, the live preview in the submission form, and the confirmation shown
 * after a submission. Sharing one function is what makes the preview honest —
 * "what you see is what gets published" is a promise the form cannot keep if the
 * preview is a second, simpler renderer that happens to be nearby.
 *
 * `abstract` is either a stored document or a draft straight out of the form, so
 * every field is optional and `figureUrl` may be an object: URL that exists only
 * in this tab.
 *
 * Options:
 *   statusLabel  a line above the title ("In review", "Accepted as a talk")
 *   permalink    href for a "Link to this abstract" control
 *   headingLevel "h2" for a page that shows one abstract, "h3" inside a list
 */
export function abstractCard(abstract, {
  statusLabel = null,
  permalink = null,
  headingLevel = "h3",
} = {}) {
  const article = document.createElement("article");
  article.className = "card";

  const heading = document.createElement(headingLevel);
  if (abstract.type === "poster" && abstract.posterNumber) {
    const number = document.createElement("span");
    number.className = "poster-no";
    number.textContent = `P${abstract.posterNumber} `;
    heading.append(number);
  } else if (abstract.type === "talk") {
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = "talk";
    heading.append(pill, " ");
  }
  // textContent for the title: untrusted input.
  heading.append(document.createTextNode(abstract.title ?? ""));

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

  const affil = document.createElement("p");
  affil.className = "byline";
  affil.textContent = (abstract.affiliations ?? []).map((a, i) => `${i + 1}. ${a}`).join("   ");

  const body = document.createElement("div");
  // The only innerHTML here, and only through the tight untrusted allowlist.
  body.innerHTML = renderAbstractHtml(abstract.body);

  const meta = document.createElement("p");
  meta.className = "card-meta";
  if (statusLabel) {
    const pill = document.createElement("span");
    pill.className = "pill status";
    pill.textContent = statusLabel;
    meta.append(pill, " ");
  }
  if (abstract.topic) {
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = TOPIC_LABELS[abstract.topic] ?? abstract.topic;
    meta.append(pill, " ");
  }
  if (permalink) {
    const link = document.createElement("a");
    link.className = "permalink";
    link.href = permalink;
    link.textContent = "Link to this abstract";
    meta.append(link);
  }

  // Built with createElement, never through the markdown renderer:
  // ABSTRACT_ALLOWLIST forbids <img> in a submitted body and must keep doing so.
  // The caption is participant input too, so it goes in as text, not markup.
  const figure = document.createElement("figure");
  if (abstract.figureUrl) {
    const img = document.createElement("img");
    img.src = abstract.figureUrl;
    img.alt = abstract.figureCaption
      || `Figure for “${abstract.title ?? "this abstract"}”`;
    img.loading = "lazy";
    figure.append(img);
    if (abstract.figureCaption) {
      const caption = document.createElement("figcaption");
      caption.textContent = abstract.figureCaption;
      figure.append(caption);
    }
  }

  article.append(heading, meta, byline, affil, body, figure);
  return article;
}

/** Where an accepted abstract lives, for sharing. Relative, like every link here. */
export const abstractPermalink = (id) => `abstracts.html?a=${encodeURIComponent(id)}`;
