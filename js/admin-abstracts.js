import { ABSTRACT_TOPICS, ABSTRACT_TYPES, TOPIC_LABELS } from "./config.mjs";
import { authorLineParts, groupByTopic, nextPosterNumber } from "./abstract-utils.mjs";
import { abstractDeletionPlan, describeAbstractDeletion } from "./deletion-utils.mjs";
import { renderAbstractHtml } from "./markdown.js";
import { mountAbstractForm } from "./abstract-form.js";
import { confirmChoice } from "./confirm-dialog.js";
import { deleteAbstractCompletely } from "./functions.js";
import {
  getReview,
  listAbstracts,
  listPublicAbstracts,
  listUsers,
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

export async function mountAbstractsTab(host, { adminUid, user }) {
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

  // Which abstract is open in the editor. Exactly one at a time: two editors on
  // the same review screen means two drafts of the same pile, and a save from
  // either silently discarding the other.
  let editingId = null;

  function card(abstract, published, submitters, refresh) {
    const article = document.createElement("article");
    article.className = "card";

    const h3 = document.createElement("h3");
    h3.textContent = abstract.title ?? "(untitled)";

    const byline = document.createElement("p");
    byline.className = "byline";
    byline.append(authorsLine(abstract));

    // With many abstracts per person the document id no longer says who
    // submitted it, so the owner is spelled out.
    const submitter = submitters.get(abstract.ownerUid);
    const from = document.createElement("p");
    from.className = "muted";
    from.textContent = submitter
      ? `Submitted by ${submitter.displayName ?? "unknown"} (${submitter.email ?? "no email"})`
      : `Submitted by uid ${abstract.ownerUid}`;

    const affil = document.createElement("p");
    affil.className = "byline";
    affil.textContent = (abstract.affiliations ?? [])
      .map((a, i) => `${i + 1}. ${a}`).join("   ");

    const meta = document.createElement("p");
    for (const label of [TOPIC_LABELS[abstract.topic] ?? abstract.topic, abstract.status]) {
      if (!label) continue;
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = label;
      meta.append(pill, " ");
    }
    if (abstract.talkConsidered === false) {
      const optOut = document.createElement("span");
      optOut.className = "muted";
      optOut.textContent = "the submitter asked not to be considered for a talk";
      meta.append(optOut);
    }

    const body = document.createElement("div");
    // The one innerHTML on this page, through the unit-tested tight allowlist.
    body.innerHTML = renderAbstractHtml(abstract.body);

    // createElement, not markdown: ABSTRACT_ALLOWLIST forbids <img> in the body
    // and must keep doing so. The figure is a separate, validated field.
    const figure = document.createElement("p");
    if (abstract.figureUrl) {
      const link = document.createElement("a");
      link.href = abstract.figureUrl;
      link.target = "_blank";
      link.rel = "noopener";
      const img = document.createElement("img");
      img.src = abstract.figureUrl;
      img.alt = "Submitted figure";
      img.loading = "lazy";
      img.style.maxWidth = "20rem";
      img.style.height = "auto";
      link.append(img);
      figure.append(link);
    }

    const noteLabel = document.createElement("label");
    noteLabel.textContent = "Reviewer note (never visible to the submitter)";
    const note = document.createElement("textarea");
    note.rows = 2;
    note.style.minHeight = "4rem";

    const actions = document.createElement("div");
    actions.className = "actions";

    // Poster vs talk is the committee's call, not the submitter's: everything
    // arrives as a poster and some are promoted here.
    const alreadyPublished = published.find((p) => p.id === abstract.id);
    const typeSelect = document.createElement("select");
    typeSelect.title = "Present as";
    typeSelect.style.maxWidth = "6.5rem";
    for (const type of ABSTRACT_TYPES) {
      const option = document.createElement("option");
      option.value = type;
      option.textContent = type === "poster" ? "Poster" : "Talk";
      typeSelect.append(option);
    }
    typeSelect.value = alreadyPublished?.type ?? "poster";
    if (abstract.talkConsidered === false) {
      typeSelect.title = "The submitter asked not to be considered for a talk";
    }

    const posterInput = document.createElement("input");
    posterInput.type = "number";
    posterInput.min = "1";
    // Three digits is plenty: PINTS is one day and one poster hall.
    posterInput.max = "999";
    posterInput.style.maxWidth = "4.5rem";
    posterInput.title = "Poster board number";
    posterInput.value = String(alreadyPublished?.posterNumber ?? nextPosterNumber(published));
    const syncPosterInput = () => { posterInput.hidden = typeSelect.value !== "poster"; };
    typeSelect.addEventListener("change", syncPosterInput);
    syncPosterInput();

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
          // The Cloud Function's refusals are written for a human — "revoke
          // their admin rights first" — and are worth far more than a generic
          // apology, so they are shown as-is.
          say(err?.userFacing ? err.message : `Could not ${label.toLowerCase()}.`, "err");
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
        await publishAbstract(abstract.id, abstract,
          { type: typeSelect.value, posterNumber: Number(posterInput.value) });
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

    const pull = guarded("Withdraw", "danger", async () => {
      await unpublishAbstract(abstract.id);
      say(`Withdrew “${abstract.title}”.`, "warn");
    });
    pull.title = "Remove this abstract from the public list";
    pull.hidden = abstract.status !== "accepted";

    const edit = document.createElement("button");
    edit.className = "secondary";
    edit.textContent = editingId === abstract.id ? "Close editor" : "Edit";
    edit.addEventListener("click", () => {
      editingId = editingId === abstract.id ? null : abstract.id;
      refresh();
    });

    const remove = guarded("Delete", "danger", async () => {
      if (!(await confirmDelete(abstract, published))) return;
      await deleteAbstractCompletely(abstract.id);
      editingId = editingId === abstract.id ? null : editingId;
      say(`Deleted “${abstract.title}”.`, "warn");
    });

    actions.append(typeSelect, posterInput, accept, reject, saveNote, edit, pull, remove);

    // The editor is mounted into the card it belongs to, in the same panel the
    // account page uses, so the form is never far from the abstract it edits.
    const editHost = document.createElement("div");
    editHost.className = "panel";
    editHost.hidden = true;

    article.append(h3, byline, from, affil, meta, body, figure, noteLabel, note, actions, editHost);
    if (editingId === abstract.id) {
      mountEditor(abstract, published, refresh, editHost).catch((err) => {
        say("Could not open the editor.", "err");
        console.error("[pints] admin edit", err);
      });
    }

    // Reviewer notes live in a separate collection because rules cannot hide a
    // field from a document's owner. Fetched after render so one failure does
    // not block the whole list.
    getReview(abstract.id)
      .then((review) => { note.value = review?.note ?? ""; })
      .catch((err) => console.error("[pints] getReview", err));

    return article;
  }

  async function confirmDelete(abstract, published) {
    const choice = await confirmChoice({
      title: "Delete abstract",
      message: describeAbstractDeletion(abstract.title, abstractDeletionPlan(abstract, published)),
      choices: [
        { value: "delete", label: "Delete permanently", className: "danger" },
        { value: "cancel", label: "Cancel", className: "secondary" },
      ],
    });
    return choice === "delete";
  }

  async function mountEditor(abstract, published, refresh, editHost) {
    editHost.hidden = false;

    const head = document.createElement("div");
    head.className = "panel-head";
    head.textContent = `Editing “${abstract.title ?? "(untitled)"}”`;
    const slot = document.createElement("div");
    slot.className = "panel-body";
    editHost.replaceChildren(head, slot);

    // An accepted abstract's public copy is rewritten in the same batch as the
    // private one, so its type and board number have to survive the edit. This
    // is also what unlocks the form: without it an accepted abstract stays
    // read-only, which is the right way to fail.
    const live = published.find((p) => p.id === abstract.id);

    await mountAbstractForm(slot, {
      user,
      verified: true,
      isAdmin: true,
      abstract,
      republish: live
        ? { type: live.type, posterNumber: live.posterNumber, acceptedAt: live.acceptedAt }
        : null,
      onCancel: () => { editingId = null; refresh(); },
      onDelete: async () => {
        if (!(await confirmDelete(abstract, published))) return;
        try {
          await deleteAbstractCompletely(abstract.id);
          editingId = null;
          say(`Deleted “${abstract.title}”.`, "warn");
          await refresh();
        } catch (err) {
          say(err?.userFacing ? err.message : "Could not delete the abstract.", "err");
        }
      },
      onSaved: async () => { editingId = null; await refresh(); },
    });
  }

  async function render() {
    // One listUsers() for the whole page, joined on ownerUid — far cheaper than
    // a getProfile() per card.
    const [abstracts, published, users] = await Promise.all([
      listAbstracts(), listPublicAbstracts(), listUsers(),
    ]);
    const submitters = new Map(users.map((u) => [u.id, u]));

    const counts = {};
    for (const a of abstracts) counts[a.status] = (counts[a.status] ?? 0) + 1;
    summary.textContent =
      `${abstracts.length} submitted · ${counts.accepted ?? 0} accepted · ` +
      `${counts.rejected ?? 0} rejected · ${counts.withdrawn ?? 0} withdrawn`;

    // Grouped by topic: the committee reviews a topic at a time, and comparing
    // submissions within a topic is the whole job.
    listEl.replaceChildren();
    for (const { topic, items } of groupByTopic(abstracts, ABSTRACT_TOPICS)) {
      const heading = document.createElement("h3");
      heading.textContent =
        `${topic ? TOPIC_LABELS[topic] ?? topic : "Other"} (${items.length})`;
      listEl.append(heading);
      for (const a of items) listEl.append(card(a, published, submitters, render));
    }
    if (!abstracts.length) say("No abstracts have been submitted yet.", "warn");
  }

  try {
    await render();
  } catch (err) {
    say("Could not load abstracts.", "err");
    console.error("[pints] admin abstracts", err);
  }
}
