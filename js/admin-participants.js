import {
  listAbstracts, listAdminUids, listPublicAbstracts, listUsers, saveProfile,
} from "./db.js";
import { sortParticipants } from "./participant-utils.mjs";
import { describeParticipantDeletion, participantDeletionPlan } from "./deletion-utils.mjs";
import { confirmChoice } from "./confirm-dialog.js";
import { deleteParticipant } from "./functions.js";
import { toCsv } from "./csv-utils.mjs";

// Everyone who registers is on the public list, so there is no consent column
// to export and no separate "consented only" mailing list any more.
const COLUMNS = [
  { key: "displayName", label: "Name" },
  { key: "affiliation", label: "Affiliation" },
  { key: "email", label: "Email" },
];

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

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

  async function render() {
    // Abstracts are loaded so the confirmation can say what else goes with the
    // participant. The list is small and this tab is opened rarely.
    const [users, abstracts, published, adminUids] = await Promise.all([
      listUsers(), listAbstracts(), listPublicAbstracts(), listAdminUids(),
    ]);
    const sorted = sortParticipants(users);
    host.querySelector("#p-summary").textContent = `${sorted.length} registered`;

    const rows = host.querySelector("#p-rows");
    rows.replaceChildren();
    for (const user of sorted) {
      rows.append(editingUid === user.id
        ? editRow(user)
        : readRow(user, abstracts, published, adminUids));
    }

    host.querySelector("#p-export-all").onclick = () =>
      download("pints-registrations.csv", toCsv(sorted, COLUMNS));

    if (!sorted.length) say("Nobody has registered yet.", "warn");
  }

  function readRow(user, abstracts, published, adminUids) {
    const tr = document.createElement("tr");
    for (const value of [user.displayName, user.affiliation, user.email]) {
      const td = document.createElement("td");
      td.textContent = value ?? "";
      tr.append(td);
    }
    tr.append(actionCell(user, abstracts, published, adminUids));
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

  function actionCell(user, abstracts, published, adminUids) {
    const td = document.createElement("td");

    // Organizers are not deletable from here, and neither are you. Both are
    // refused server-side as well; this is about not offering an action that is
    // going to be rejected, and about making one mis-click unable to decapitate
    // the committee. To remove an organizer, revoke their rights in Settings
    // first — which is a second, deliberate step.
    const label = user.id === adminUid ? "you"
      : adminUids.has(user.id) ? "organizer"
      : null;
    const actions = document.createElement("div");
    actions.className = "actions";
    actions.style.marginTop = "0";
    td.append(actions);

    const edit = document.createElement("button");
    edit.className = "secondary";
    edit.textContent = "Edit";
    edit.addEventListener("click", async () => { editingUid = user.id; await render(); });
    actions.append(edit);

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
      actions.append(note);
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

    actions.append(button);
    return td;
  }

  try {
    await render();
  } catch (err) {
    say("Could not load registrations.", "err");
    console.error("[pints] admin participants", err);
  }
}
