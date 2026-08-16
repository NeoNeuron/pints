import { listUsers } from "./db.js";
import { sortParticipants } from "./participant-utils.mjs";
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

export async function mountParticipantsTab(host) {
  host.innerHTML = `
    <div id="p-msg" class="msg" role="status" aria-live="polite"></div>
    <p id="p-summary" class="muted"></p>
    <div class="actions">
      <button id="p-export-all" class="secondary">Export registrations / mailing list (CSV)</button>
    </div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Name</th><th>Affiliation</th><th>Email</th></tr></thead>
        <tbody id="p-rows"></tbody>
      </table>
    </div>`;

  const msg = host.querySelector("#p-msg");
  try {
    const users = sortParticipants(await listUsers());
    host.querySelector("#p-summary").textContent = `${users.length} registered`;

    const rows = host.querySelector("#p-rows");
    for (const user of users) {
      const tr = document.createElement("tr");
      const cells = [user.displayName, user.affiliation, user.email];
      for (const value of cells) {
        const td = document.createElement("td");
        td.textContent = value ?? "";
        tr.append(td);
      }
      rows.append(tr);
    }

    host.querySelector("#p-export-all").addEventListener("click", () =>
      download("pints-registrations.csv", toCsv(users, COLUMNS)));

    if (!users.length) {
      msg.className = "msg warn";
      msg.textContent = "Nobody has registered yet.";
    }
  } catch (err) {
    msg.className = "msg err";
    msg.textContent = "Could not load registrations.";
    console.error("[pints] admin participants", err);
  }
}
