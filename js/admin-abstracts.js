import { authorLineParts, nextPosterNumber } from "./abstract-utils.mjs";
import { renderAbstractHtml } from "./markdown.js";
import {
  getReview,
  listAbstracts,
  listPublicAbstracts,
  publishAbstract,
  saveReview,
  setAbstractStatus,
  unpublishAbstract,
} from "./db.js";

/** Author names with superscript affiliation marks, presenting author in bold. */
function authorsLine(abstract) {
  const span = document.createElement("span");
  authorLineParts(abstract.authors).forEach((part, i) => {
    if (i) span.append(document.createTextNode(", "));
    // textContent on a fresh element: author names are untrusted input.
    const name = document.createElement(part.presenting ? "strong" : "span");
    name.textContent = part.name;
    span.append(name);
    if (part.marks) {
      const sup = document.createElement("sup");
      sup.textContent = part.marks;
      span.append(sup);
    }
  });
  return span;
}

export async function mountAbstractsTab(host, { adminUid }) {
  host.innerHTML = `
    <div id="adm-msg" class="msg" role="status" aria-live="polite"></div>
    <p id="adm-summary" class="muted"></p>
    <div id="adm-list"></div>`;

  const msg = host.querySelector("#adm-msg");
  const listEl = host.querySelector("#adm-list");
  const summary = host.querySelector("#adm-summary");

  const say = (text, kind = "ok") => {
    msg.className = `msg ${kind}`;
    msg.textContent = text;
  };

  function card(abstract, published, refresh) {
    const article = document.createElement("article");
    article.className = "card";

    const h3 = document.createElement("h3");
    h3.textContent = abstract.title ?? "(untitled)";

    const byline = document.createElement("p");
    byline.className = "byline";
    byline.append(authorsLine(abstract));

    const affil = document.createElement("p");
    affil.className = "byline";
    affil.textContent = (abstract.affiliations ?? [])
      .map((a, i) => `${i + 1}. ${a}`).join("   ");

    const meta = document.createElement("p");
    for (const label of [abstract.type, abstract.status]) {
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = label;
      meta.append(pill, " ");
    }

    const body = document.createElement("div");
    // The one innerHTML on this page, through the unit-tested tight allowlist.
    body.innerHTML = renderAbstractHtml(abstract.body);

    const noteLabel = document.createElement("label");
    noteLabel.textContent = "Reviewer note (never visible to the submitter)";
    const note = document.createElement("textarea");
    note.rows = 2;
    note.style.minHeight = "4rem";

    const actions = document.createElement("div");
    actions.className = "actions";

    const posterInput = document.createElement("input");
    posterInput.type = "number";
    posterInput.min = "1";
    posterInput.style.maxWidth = "6rem";
    posterInput.title = "Poster board number";
    posterInput.value = String(
      published.find((p) => p.id === abstract.id)?.posterNumber ?? nextPosterNumber(published));
    if (abstract.type !== "poster") posterInput.hidden = true;

    const guarded = (label, className, fn) => {
      const button = document.createElement("button");
      button.textContent = label;
      if (className) button.className = className;
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await fn();
          await refresh();
        } catch (err) {
          say(`Could not ${label.toLowerCase()}.`, "err");
          console.error("[pints] admin abstracts", err);
          button.disabled = false;
        }
      });
      return button;
    };

    const accept = guarded(
      abstract.status === "accepted" ? "Re-publish" : "Accept & publish", "",
      async () => {
        await saveReview(abstract.id, { note: note.value, decidedBy: adminUid });
        await publishAbstract(abstract.id, abstract, Number(posterInput.value));
        say(`Published “${abstract.title}”.`, "ok");
      });

    const reject = guarded("Reject", "secondary", async () => {
      await saveReview(abstract.id, { note: note.value, decidedBy: adminUid });
      await setAbstractStatus(abstract.id, "rejected");
      say(`Rejected “${abstract.title}”. The submitter can revise and resubmit.`, "warn");
    });

    const saveNote = document.createElement("button");
    saveNote.className = "secondary";
    saveNote.textContent = "Save note";
    saveNote.addEventListener("click", async () => {
      try {
        await saveReview(abstract.id, { note: note.value, decidedBy: adminUid });
        say("Note saved.", "ok");
      } catch (err) {
        say("Could not save the note.", "err");
        console.error("[pints] saveReview", err);
      }
    });

    const pull = guarded("Withdraw from the public list", "danger", async () => {
      await unpublishAbstract(abstract.id);
      say(`Withdrew “${abstract.title}”.`, "warn");
    });
    pull.hidden = abstract.status !== "accepted";

    actions.append(posterInput, accept, reject, saveNote, pull);
    article.append(h3, byline, affil, meta, body, noteLabel, note, actions);

    // Reviewer notes live in a separate collection because rules cannot hide a
    // field from a document's owner. Fetched after render so one failure does
    // not block the whole list.
    getReview(abstract.id)
      .then((review) => { note.value = review?.note ?? ""; })
      .catch((err) => console.error("[pints] getReview", err));

    return article;
  }

  async function render() {
    const [abstracts, published] = await Promise.all([listAbstracts(), listPublicAbstracts()]);

    const counts = {};
    for (const a of abstracts) counts[a.status] = (counts[a.status] ?? 0) + 1;
    summary.textContent =
      `${abstracts.length} submitted · ${counts.accepted ?? 0} accepted · ` +
      `${counts.rejected ?? 0} rejected · ${counts.withdrawn ?? 0} withdrawn`;

    listEl.replaceChildren(...abstracts.map((a) => card(a, published, render)));
    if (!abstracts.length) say("No abstracts have been submitted yet.", "warn");
  }

  try {
    await render();
  } catch (err) {
    say("Could not load abstracts.", "err");
    console.error("[pints] admin abstracts", err);
  }
}
