import { listAbstracts, listPublicAbstracts, listUsers } from "./db.js";
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
 * The registration list, with a delete button per row.
 *
 * Organizers can remove a participant but deliberately cannot edit one: a name
 * and an affiliation are what somebody said about themselves, and an organizer
 * who believes one is wrong should ask them rather than overwrite it. The only
 * admin power here is destructive, and it is guarded accordingly.
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

  async function render() {
    // Abstracts are loaded so the confirmation can say what else goes with the
    // participant. The list is small and this tab is opened rarely.
    const [users, abstracts, published] = await Promise.all([
      listUsers(), listAbstracts(), listPublicAbstracts(),
    ]);
    const sorted = sortParticipants(users);
    host.querySelector("#p-summary").textContent = `${sorted.length} registered`;

    const rows = host.querySelector("#p-rows");
    rows.replaceChildren();
    for (const user of sorted) {
      const tr = document.createElement("tr");
      for (const value of [user.displayName, user.affiliation, user.email]) {
        const td = document.createElement("td");
        td.textContent = value ?? "";
        tr.append(td);
      }
      tr.append(actionCell(user, abstracts, published));
      rows.append(tr);
    }

    host.querySelector("#p-export-all").onclick = () =>
      download("pints-registrations.csv", toCsv(sorted, COLUMNS));

    if (!sorted.length) say("Nobody has registered yet.", "warn");
  }

  function actionCell(user, abstracts, published) {
    const td = document.createElement("td");

    // Deleting yourself would sign you out of the console you are standing in.
    // The server refuses it too; this is just not offering it.
    if (user.id === adminUid) {
      const you = document.createElement("span");
      you.className = "muted";
      you.textContent = "you";
      td.append(you);
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

    td.append(button);
    return td;
  }

  try {
    await render();
  } catch (err) {
    say("Could not load registrations.", "err");
    console.error("[pints] admin participants", err);
  }
}
