import { mountLayout, setAuthLink } from "./layout.js";
import { warnIfUnconfigured } from "./firebase.js";
import { onUser } from "./auth.js";
import { listPublicAbstracts } from "./db.js";
import { authorLineParts, filterAbstracts, sortPublicAbstracts } from "./abstract-utils.mjs";
import { renderAbstractHtml, renderPageHtml } from "./markdown.js";

mountLayout();
onUser(({ user, isAdmin }) => setAuthLink({ signedIn: Boolean(user), isAdmin }));

for (const host of document.querySelectorAll("[data-markdown]")) {
  try {
    const res = await fetch(host.getAttribute("data-markdown"), { cache: "no-cache" });
    if (res.ok) host.innerHTML = renderPageHtml(await res.text());
  } catch (err) {
    console.error("[pints] poster guidelines", err);
  }
}

const listEl = document.getElementById("list");
const countEl = document.getElementById("count");
const msg = document.getElementById("msg");
const queryEl = document.getElementById("q");

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

  article.append(h3, byline, affil, body);
  return article;
}

let all = [];

function draw() {
  const shown = filterAbstracts(all, queryEl.value);
  countEl.textContent = `${shown.length} of ${all.length} shown.`;
  listEl.replaceChildren(...shown.map(card));
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
  } catch (err) {
    msg.className = "msg err";
    msg.textContent = "Could not load the abstract list.";
    console.error("[pints] abstracts", err);
  }
}
