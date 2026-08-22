import {
  listAbstracts, listAdminUids, listPublicAbstracts, listUsers, saveProfile,
} from "./db.js";
import { sortParticipants } from "./participant-utils.mjs";
import { describeParticipantDeletion, participantDeletionPlan } from "./deletion-utils.mjs";
import { confirmChoice } from "./confirm-dialog.js";
import { deleteParticipant, listUnverifiedParticipants, verifyParticipantEmail } from "./functions.js";
import { toCsv } from "./csv-utils.mjs";
import { download } from "./download.js";

// Everyone who registers is on the public list, so there is no consent column
// to export and no separate "consented only" mailing list any more.
const COLUMNS = [
  { key: "displayName", label: "Name" },
  { key: "affiliation", label: "Affiliation" },
  { key: "email", label: "Email" },
];

/**
 * The registration list, with edit and delete per row.
 *
 * Editing writes users/{uid} and participants_public/{uid} together through the
 * same saveProfile() the participant's own account page uses, so the public list
 * cannot drift from the private record. The email is shown but not editable: it
 * belongs to the Firebase Auth login, and changing only the Firestore copy would
 * leave the two disagreeing about who this is.
 */
export async function mountParticipantsTab(host, { adminUid } = {}) {
  host.innerHTML = `
    <div id="p-msg" class="msg" role="status" aria-live="polite"></div>
    <p id="p-summary" class="muted"></p>
    <div class="actions">
      <button id="p-export-all" class="secondary">Export registrations / mailing list (CSV)</button>
    </div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Name</th><th>Affiliation</th><th>Email</th><th></th></tr></thead>
        <tbody id="p-rows"></tbody>
      </table>
    </div>`;

  const msg = host.querySelector("#p-msg");
  const say = (text, kind = "ok") => {
    msg.className = `msg ${kind}`;
    msg.textContent = text;
  };

  // Which row is being edited, if any. One at a time.
  let editingUid = null;

  // These Firestore reads have no built-in timeout: on a bad connection the
  // initial load can hang indefinitely with no feedback. Race it against a
  // timer so a stall surfaces as an error instead of a silent blank tab.
  const LOAD_TIMEOUT_MS = 10_000;
  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), ms)),
    ]);
  }

  async function render() {
    // Abstracts are loaded so the confirmation can say what else goes with the
    // participant. The list is small and this tab is opened rarely.
    const [users, abstracts, published, adminUids] = await Promise.all([
      listUsers(), listAbstracts(), listPublicAbstracts(), listAdminUids(),
    ]);

    // Best-effort and separate from the Promise.all above: users/{uid} has no
    // verified flag to read, so this is the one piece of this render that can
    // only come from a callable. If it is not deployed yet, the tab still
    // loads — "Confirm email" just does not appear on anybody, same as the
    // delete buttons degrading rather than the whole tab failing when
    // functions/ is missing (see the README).
    let unverified = new Set();
    try {
      unverified = new Set((await listUnverifiedParticipants()).uids);
    } catch (err) {
      console.error("[pints] listUnverifiedParticipants", err);
    }

    const sorted = sortParticipants(users);
    host.querySelector("#p-summary").textContent = `${sorted.length} registered`;

    const rows = host.querySelector("#p-rows");
    rows.replaceChildren();
    for (const user of sorted) {
      rows.append(editingUid === user.id
        ? editRow(user)
        : readRow(user, abstracts, published, adminUids, unverified));
    }

    host.querySelector("#p-export-all").onclick = () =>
      download("pints-registrations.csv", toCsv(sorted, COLUMNS));

    if (!sorted.length) say("Nobody has registered yet.", "warn");
  }

  function readRow(user, abstracts, published, adminUids, unverified) {
    const tr = document.createElement("tr");
    for (const value of [user.displayName, user.affiliation, user.email]) {
      const td = document.createElement("td");
      td.textContent = value ?? "";
      tr.append(td);
    }
    tr.append(actionCell(user, abstracts, published, adminUids, unverified));
    return tr;
  }

  /**
   * The same row with the two editable fields swapped for inputs.
   *
   * Only one row is ever in this state, so there is never a second half-typed
   * correction waiting to be lost.
   */
  function editRow(user) {
    const tr = document.createElement("tr");

    const name = document.createElement("input");
    name.type = "text";
    name.maxLength = 80;
    name.value = user.displayName ?? "";
    name.setAttribute("aria-label", "Full name");

    const affiliation = document.createElement("input");
    affiliation.type = "text";
    affiliation.maxLength = 120;
    affiliation.value = user.affiliation ?? "";
    affiliation.setAttribute("aria-label", "Affiliation");

    for (const field of [name, affiliation]) {
      const td = document.createElement("td");
      td.append(field);
      tr.append(td);
    }

    const emailCell = document.createElement("td");
    emailCell.className = "muted";
    emailCell.textContent = user.email ?? "";
    emailCell.title = "The email address belongs to the login and cannot be changed here.";
    tr.append(emailCell);

    const actions = document.createElement("div");
    actions.className = "actions";
    actions.style.marginTop = "0";

    const save = document.createElement("button");
    save.textContent = "Save";
    save.addEventListener("click", async () => {
      if (!name.value.trim()) return say("A name is required.", "err");
      save.disabled = true;
      try {
        await saveProfile(user.id, {
          email: user.email,
          displayName: name.value,
          affiliation: affiliation.value,
        });
        editingUid = null;
        say(`Saved ${name.value.trim()}.`, "ok");
        await render();
      } catch (err) {
        say("Could not save that participant.", "err");
        console.error("[pints] admin saveProfile", err);
        save.disabled = false;
      }
    });

    const cancel = document.createElement("button");
    cancel.className = "secondary";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", async () => { editingUid = null; await render(); });

    actions.append(save, cancel);
    const td = document.createElement("td");
    td.append(actions);
    tr.append(td);

    name.focus();
    return tr;
  }

  function actionCell(user, abstracts, published, adminUids, unverified) {
    const td = document.createElement("td");
    // Buttons go straight into the cell rather than a flex .actions div: that
    // wraps under this column's width and doubles the row's height, the same
    // problem admin-schedule.js's td.tools (css/styles.css) exists to avoid —
    // white-space: nowrap only holds inline siblings on one line, not flex
    // children, so this row follows that pattern instead of .actions.
    td.className = "tools";

    // Organizers are not deletable from here, and neither are you. Both are
    // refused server-side as well; this is about not offering an action that is
    // going to be rejected, and about making one mis-click unable to decapitate
    // the committee. To remove an organizer, revoke their rights in Settings
    // first — which is a second, deliberate step.
    const label = user.id === adminUid ? "you"
      : adminUids.has(user.id) ? "organizer"
      : null;

    const edit = document.createElement("button");
    edit.className = "secondary";
    edit.textContent = "Edit";
    edit.addEventListener("click", async () => { editingUid = user.id; await render(); });
    td.append(edit);

    // Only for someone Firebase Auth still has unconfirmed — the one case
    // "send it again" cannot fix, when a mail gateway drops the confirmation
    // outright rather than quarantining it. contact.html's verify-gate sends
    // that participant here. Gone from the row the moment it succeeds, since
    // render() re-reads who is still unverified.
    if (unverified.has(user.id)) {
      const verify = document.createElement("button");
      verify.className = "secondary";
      verify.textContent = "Confirm email";
      verify.title = "This participant has not confirmed their email. Confirm it by hand.";
      verify.addEventListener("click", async () => {
        verify.disabled = true;
        try {
          await verifyParticipantEmail(user.id);
          say(`Confirmed ${user.displayName ?? "that participant"}’s email.`, "ok");
          await render();
        } catch (err) {
          say(err?.userFacing ? err.message : "Could not confirm that address.", "err");
          verify.disabled = false;
        }
      });
      td.append(" ", verify);
    }

    // Editing an organizer is fine; deleting one is not. Both refusals are
    // enforced server-side as well — this is about not offering an action that
    // is going to be rejected, and about making one mis-click unable to
    // decapitate the committee.
    if (label) {
      const note = document.createElement("span");
      note.className = "muted";
      note.textContent = label;
      note.title = label === "you"
        ? "You cannot delete your own account from the admin console."
        : "Revoke their organizer rights in Settings before deleting them.";
      td.append(" ", note);
      return td;
    }

    const button = document.createElement("button");
    button.className = "danger";
    button.textContent = "Delete";
    button.addEventListener("click", async () => {
      const plan = participantDeletionPlan(user.id, abstracts, published);
      const choice = await confirmChoice({
        title: "Delete participant",
        message: describeParticipantDeletion(user.displayName, plan),
        choices: [
          { value: "delete", label: "Delete permanently", className: "danger" },
          { value: "cancel", label: "Cancel", className: "secondary" },
        ],
      });
      if (choice !== "delete") return;

      button.disabled = true;
      try {
        const { abstracts: removed } = await deleteParticipant(user.id);
        say(`Deleted ${user.displayName ?? "the participant"}`
          + (removed ? ` and ${removed} abstract${removed === 1 ? "" : "s"}` : "") + ".", "warn");
        await render();
      } catch (err) {
        say(err?.userFacing ? err.message : "Could not delete the participant.", "err");
        button.disabled = false;
      }
    });

    td.append(" ", button);
    return td;
  }

  const LOADING_TEXT = "Loading registrations…";
  say(LOADING_TEXT, "");
  try {
    await withTimeout(render(), LOAD_TIMEOUT_MS);
    // render() overwrites this itself when the list is empty; otherwise clear it.
    if (msg.textContent === LOADING_TEXT) say("", "");
  } catch (err) {
    say(err.message === "timed out"
      ? "This is taking too long. Check your connection and reload the page."
      : "Could not load registrations.", "err");
    console.error("[pints] admin participants", err);
  }
}
