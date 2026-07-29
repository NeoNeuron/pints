import { ABSTRACT_TYPES } from "./config.mjs";
import {
  parseAffiliationIndexes,
  parseAffiliations,
  validateAbstract,
} from "./abstract-validation-utils.mjs";
import { renderAbstractHtml } from "./markdown.js";
import { getMyAbstract, getSiteConfig, saveAbstract, withdrawAbstract } from "./db.js";

const TEMPLATE = `
  <h2>Poster / talk abstract</h2>
  <p id="window-note" class="muted"></p>
  <div id="abs-msg" class="msg" role="status" aria-live="polite"></div>
  <p id="abs-status"></p>

  <form id="abs-form" novalidate>
    <label for="abs-title">Title</label>
    <input id="abs-title" type="text" maxlength="200" required>

    <label for="abs-affiliations">Affiliations
      <span class="hint">One per line. The author numbers below refer to these, starting at 1.</span>
    </label>
    <textarea id="abs-affiliations" rows="3" style="min-height:5rem"></textarea>

    <label>Authors
      <span class="hint">Affiliation numbers are comma-separated, e.g. <code>1,2</code>.
        Mark exactly one presenting author.</span>
    </label>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Name</th><th>Affiliations</th><th>Presenting</th><th></th></tr></thead>
        <tbody id="abs-authors"></tbody>
      </table>
    </div>
    <p><button type="button" id="abs-add-author" class="secondary">Add author</button></p>

    <label for="abs-type">Presentation type</label>
    <select id="abs-type"></select>

    <label for="abs-body">Abstract
      <span class="hint">Plain text with <code>*italic*</code> and <code>**bold**</code>.
        Maximum 2500 characters. <span id="abs-count"></span></span>
    </label>
    <textarea id="abs-body" maxlength="2500" required></textarea>

    <h3>Preview</h3>
    <div id="abs-preview" class="card"></div>

    <div class="actions">
      <button type="submit" id="abs-save">Submit abstract</button>
      <button type="button" id="abs-withdraw" class="danger" hidden>Withdraw</button>
    </div>
  </form>
`;

function authorRow({ name = "", marks = "", presenting = false } = {}) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="text" class="a-name" maxlength="120"></td>
    <td><input type="text" class="a-marks" size="6" inputmode="numeric"></td>
    <td><input type="radio" name="presenting" class="a-presenting"></td>
    <td><button type="button" class="secondary a-remove">Remove</button></td>`;
  tr.querySelector(".a-name").value = name;
  tr.querySelector(".a-marks").value = marks;
  tr.querySelector(".a-presenting").checked = presenting;
  tr.querySelector(".a-remove").addEventListener("click", () => tr.remove());
  return tr;
}

export async function mountAbstractForm(host, { user, verified }) {
  host.hidden = false;
  host.innerHTML = TEMPLATE;

  const $ = (sel) => host.querySelector(sel);
  const msg = $("#abs-msg");
  const form = $("#abs-form");
  const titleEl = $("#abs-title");
  const affEl = $("#abs-affiliations");
  const authorsEl = $("#abs-authors");
  const typeEl = $("#abs-type");
  const bodyEl = $("#abs-body");
  const saveBtn = $("#abs-save");
  const withdrawBtn = $("#abs-withdraw");

  for (const type of ABSTRACT_TYPES) {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = type === "poster" ? "Poster" : "Contributed talk";
    typeEl.append(option);
  }

  const say = (text, kind = "ok") => {
    msg.className = `msg ${kind}`;
    msg.replaceChildren(document.createTextNode(text));
  };

  const sayErrors = (errors) => {
    msg.className = "msg err";
    const ul = document.createElement("ul");
    for (const e of errors) {
      const li = document.createElement("li");
      li.textContent = e;
      ul.append(li);
    }
    msg.replaceChildren(document.createTextNode("Please fix the following:"), ul);
  };

  const config = await getSiteConfig();
  const deadline = config?.submissionDeadline?.toDate?.() ?? null;
  const submissionsOpen = Boolean(config?.submissionsOpen);
  const windowOpen = submissionsOpen && (!deadline || new Date() < deadline);

  $("#window-note").textContent = windowOpen
    ? `Submissions are open${deadline ? ` until ${deadline.toLocaleString("en-GB")}` : ""}.`
    : "Submissions are closed.";

  const existing = await getMyAbstract(user.uid);
  if (existing) {
    titleEl.value = existing.title ?? "";
    affEl.value = (existing.affiliations ?? []).join("\n");
    bodyEl.value = existing.body ?? "";
    typeEl.value = existing.type ?? "poster";
    for (const author of existing.authors ?? []) {
      authorsEl.append(authorRow({
        name: author.name,
        marks: (author.affiliationIndexes ?? []).map((i) => i + 1).join(","),
        presenting: author.presenting,
      }));
    }
    saveBtn.textContent = "Save changes";

    const status = document.createElement("span");
    status.className = "pill";
    status.textContent = existing.status;
    $("#abs-status").replaceChildren(document.createTextNode("Status: "), status);
  } else {
    authorsEl.append(authorRow({ name: "", marks: "1", presenting: true }));
  }

  // Only an accepted abstract is locked, matching the rules: its public copy
  // would otherwise go stale. Rejected and withdrawn stay editable so the
  // participant can revise and resubmit before the deadline.
  const frozen = existing?.status === "accepted";
  const editable = verified && windowOpen && !frozen;

  if (!verified) say("Verify your email address before submitting.", "warn");
  else if (frozen) say("This abstract has been accepted. Contact the organizers to change it.", "warn");
  else if (!windowOpen) say("Submissions are closed. You can still read your abstract.", "warn");
  else if (existing?.status === "rejected") {
    say("This abstract was not accepted. You can revise and resubmit it before the deadline.", "warn");
  } else if (existing?.status === "withdrawn") {
    say("This abstract was withdrawn by the organizers. You can revise and resubmit it before the deadline.", "warn");
  }

  if (!editable) {
    for (const field of form.querySelectorAll("input, textarea, select, button")) {
      field.disabled = true;
    }
  }
  withdrawBtn.hidden = !(existing && editable);

  const refreshPreview = () => {
    $("#abs-preview").innerHTML = renderAbstractHtml(bodyEl.value);
    $("#abs-count").textContent = `${bodyEl.value.length} / 2500`;
  };
  bodyEl.addEventListener("input", refreshPreview);
  refreshPreview();

  $("#abs-add-author").addEventListener("click", () => authorsEl.append(authorRow()));

  const collect = () => ({
    title: titleEl.value,
    affiliations: parseAffiliations(affEl.value),
    authors: [...authorsEl.querySelectorAll("tr")].map((tr) => ({
      name: tr.querySelector(".a-name").value.trim(),
      affiliationIndexes: parseAffiliationIndexes(tr.querySelector(".a-marks").value),
      presenting: tr.querySelector(".a-presenting").checked,
    })),
    body: bodyEl.value,
    type: typeEl.value,
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const draft = collect();
    const { valid, errors } = validateAbstract(draft, { submissionsOpen, deadline });
    if (!valid) return sayErrors(errors);

    saveBtn.disabled = true;
    try {
      await saveAbstract(user.uid, draft);
      say("Abstract saved. You can edit it until the deadline.", "ok");
      withdrawBtn.hidden = false;
      saveBtn.textContent = "Save changes";
    } catch (err) {
      say("Could not save your abstract. Please try again.", "err");
      console.error("[pints] saveAbstract", err);
    } finally {
      saveBtn.disabled = false;
    }
  });

  withdrawBtn.addEventListener("click", async () => {
    if (!confirm("Withdraw your abstract? This cannot be undone.")) return;
    try {
      await withdrawAbstract(user.uid);
      location.reload();
    } catch (err) {
      say("Could not withdraw the abstract.", "err");
      console.error("[pints] withdrawAbstract", err);
    }
  });
}
