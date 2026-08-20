import { getPublicAbstract } from "./db.js";
import { submissionStatusLabel } from "./abstract-utils.mjs";
import { abstractCard, abstractPermalink } from "./abstract-card.js";

/**
 * A participant's own abstract, shown back to them as the organizers will read
 * it, with where it stands and a way into the editor.
 *
 * Two pages need this and used to disagree: `submit.html` showed the card while
 * `account.html` dropped straight into the form. Two answers to "what is my
 * submission" is how a site starts contradicting itself, so there is one.
 *
 * Showing the filled-in form after a save answers "did it work?" with the same
 * screen that was already there — the green line is the only difference and it
 * is easy to miss. The record is the better answer.
 *
 * `onEdit` is called when the button is pressed; the caller owns swapping in
 * `mountAbstractForm`, because the two pages mount it into different hosts with
 * different options.
 *
 * `onDelete`, if given, adds a "Delete this abstract" button beside Edit. It is
 * optional rather than always-on: abstracts.html has nowhere else for a
 * deletion to happen, so it wires this up, while submit.html already offers
 * delete from inside the editor and does not need it twice.
 */
export async function mountSubmissionCard(host, abstract, { onEdit, onDelete = null }) {
  // The poster/talk decision and the board number live only on the public copy,
  // so a decided abstract costs one extra read and an undecided one costs none.
  const published = abstract.status === "accepted"
    ? await getPublicAbstract(abstract.id).catch((err) => {
      console.error("[pints] getPublicAbstract", err);
      return null;
    })
    : null;

  const card = abstractCard(abstract, {
    statusLabel: submissionStatusLabel(abstract.status, published),
    // Only once it is public. A link to an abstract still in review resolves for
    // its author and for nobody else, which is a worse thing to hand somebody
    // than no link at all.
    permalink: published ? abstractPermalink(abstract.id) : null,
    headingLevel: "h2",
  });

  const actions = document.createElement("div");
  actions.className = "actions";
  // Keyed on the status, not on the public copy: a half-finished acceptance —
  // status set, abstracts_public not yet written — must lock too, which is
  // exactly how `frozen` decides it in the form behind this button. Offering an
  // editor that then refuses to save anything is worse than not offering one.
  const frozen = abstract.status === "accepted";

  const edit = document.createElement("button");
  edit.type = "button";
  edit.textContent = "Edit submission";
  edit.disabled = frozen;
  edit.addEventListener("click", () => onEdit());
  actions.append(edit);

  if (onDelete) {
    // Frozen exactly when Edit is: firestore.rules refuses to delete an
    // accepted abstract for the same reason it refuses to edit one.
    const del = document.createElement("button");
    del.type = "button";
    del.className = "danger";
    del.textContent = "Delete this abstract";
    del.disabled = frozen;
    del.addEventListener("click", () => onDelete());
    actions.append(del);
  }

  if (frozen) {
    const note = document.createElement("span");
    note.className = "muted";
    note.textContent = "Accepted abstracts are frozen — ask an organizer to change one.";
    actions.append(note);
  }

  card.append(actions);
  host.replaceChildren(card);
  return card;
}
