import { mountLayout, setAuthLink } from "./layout.js";
import { warnIfUnconfigured } from "./firebase.js";
import { onUser } from "./auth.js";
import { listPublicAbstracts } from "./db.js";
import { authorLineParts, filterAbstracts, sortPublicAbstracts } from "./abstract-utils.mjs";
import { ABSTRACT_TOPICS, TOPIC_LABELS } from "./config.mjs";
import { renderAbstractHtml } from "./markdown.js";
import { hydrateMarkdownHosts } from "./content-hydrate.js";

mountLayout();
onUser(({ user, isAdmin }) => setAuthLink({ signedIn: Boolean(user), isAdmin }));

await hydrateMarkdownHosts();

const listEl = document.getElementById("list");
const countEl = document.getElementById("count");
const msg = document.getElementById("msg");
const queryEl = document.getElementById("q");
const topicEl = document.getElementById("topic");

function card(abstract) {
  const article = document.createElement("article");
  article.className = "card";

  const h3 = document.createElement("h3");
  if (abstract.type === "poster" && abstract.posterNumber) {
    const number = document.createElement("span");
    number.className = "poster-no";
    number.textContent = `P${abstract.posterNumber} `;
    h3.append(number);
  } else if (abstract.type === "talk") {
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = "talk";
    h3.append(pill, " ");
  }
  // textContent for the title: untrusted input.
  h3.append(document.createTextNode(abstract.title ?? ""));

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
  if (abstract.topic) {
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = TOPIC_LABELS[abstract.topic] ?? abstract.topic;
    meta.append(pill);
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

  article.append(h3, meta, byline, affil, body, figure);
  return article;
}

let all = [];

function draw() {
  const byTopic = topicEl.value ? all.filter((a) => a.topic === topicEl.value) : all;
  const shown = filterAbstracts(byTopic, queryEl.value);
  countEl.textContent = `${shown.length} of ${all.length} shown.`;
  listEl.replaceChildren(...shown.map(card));
}

const anyTopic = document.createElement("option");
anyTopic.value = "";
anyTopic.textContent = "All topics";
topicEl.append(anyTopic);
for (const topic of ABSTRACT_TOPICS) {
  const option = document.createElement("option");
  option.value = topic;
  option.textContent = TOPIC_LABELS[topic] ?? topic;
  topicEl.append(option);
}

if (!warnIfUnconfigured(msg)) {
  try {
    all = sortPublicAbstracts(await listPublicAbstracts());
    if (!all.length) {
      msg.className = "msg warn";
      msg.textContent = "No abstracts have been accepted yet.";
    }
    draw();
    queryEl.addEventListener("input", draw);
    topicEl.addEventListener("change", draw);
  } catch (err) {
    msg.className = "msg err";
    msg.textContent = "Could not load the abstract list.";
    console.error("[pints] abstracts", err);
  }
}
