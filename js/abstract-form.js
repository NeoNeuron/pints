import { ABSTRACT_TOPICS, TOPIC_LABELS } from "./config.mjs";
import {
  parseAffiliationIndexes,
  parseAffiliations,
  validateAbstract,
} from "./abstract-validation-utils.mjs";
import { draftFingerprint } from "./abstract-utils.mjs";
import { validateFigure } from "./figure-utils.mjs";
import { renderAbstractHtml } from "./markdown.js";
import { deleteAbstract, getSiteConfig, newAbstractId, saveAbstract } from "./db.js";
import { deleteFigure, uploadFigure } from "./storage.js";

const TEMPLATE = `
  <p id="window-note" class="muted"></p>
  <div id="abs-msg" class="msg" role="status" aria-live="polite"></div>
  <p id="abs-status"></p>

  <form id="abs-form" novalidate>
    <label for="abs-title">Title</label>
    <input id="abs-title" type="text" maxlength="200" required>

    <label for="abs-topic">Topic</label>
    <select id="abs-topic" required></select>

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

    <label for="abs-body">Abstract
      <span class="hint">Plain text with <code>*italic*</code> and <code>**bold**</code>.
        Maximum 2500 characters. <span id="abs-count"></span></span>
    </label>
    <textarea id="abs-body" maxlength="2500" required></textarea>

    <label for="abs-figure">Figure <span class="hint">Optional. PNG, JPEG, or WebP,
      up to 5 MB. Large images are shrunk automatically before upload.</span></label>
    <input id="abs-figure" type="file" accept="image/png,image/jpeg,image/webp">
    <p id="abs-figure-preview" hidden>
      <img id="abs-figure-img" alt="Figure preview" style="max-width:16rem;height:auto">
      <button type="button" id="abs-figure-remove" class="secondary">Remove figure</button>
    </p>

    <div class="checkline">
      <input id="abs-no-talk" type="checkbox">
      <label for="abs-no-talk">I do not want this poster to be considered for a talk
        <span class="hint">By default every poster is considered. Tick this only if you
          would rather not be offered a talk slot.</span>
      </label>
    </div>

    <h3>Preview</h3>
    <div id="abs-preview" class="card"></div>

    <div class="actions">
      <button type="submit" id="abs-save">Submit abstract</button>
      <button type="button" id="abs-delete" class="danger" hidden>Delete this abstract</button>
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

/**
 * Mount the editor for ONE abstract.
 *
 * `abstract` null means a new submission; otherwise the document to edit. The
 * form no longer looks up the participant's submission itself, because there
 * may be several — page-account.js owns the list and decides what to open.
 * `onSaved` is called after a successful save or delete so the caller can
 * refresh that list. `defaultAuthorName` and `defaultAffiliation` seed the first
 * author row and the affiliations box of a new submission — Firebase Auth
 * carries neither, the profile does. `onCancel`, when given, adds a Cancel
 * button to the action row.
 *
 * Returns a handle so the caller can arbitrate between several editors:
 * `isDirty()` reports unsaved work and `save()` commits it without firing
 * `onSaved`, leaving the caller in charge of re-rendering.
 */
export async function mountAbstractForm(
  host,
  {
    user,
    verified,
    isAdmin = false,
    abstract = null,
    defaultAuthorName = "",
    defaultAffiliation = "",
    onCancel = null,
    onSaved = () => {},
  },
) {
  host.hidden = false;
  host.innerHTML = TEMPLATE;

  const $ = (sel) => host.querySelector(sel);
  const msg = $("#abs-msg");
  const form = $("#abs-form");
  const titleEl = $("#abs-title");
  const topicEl = $("#abs-topic");
  const affEl = $("#abs-affiliations");
  const authorsEl = $("#abs-authors");
  const bodyEl = $("#abs-body");
  const figureEl = $("#abs-figure");
  const figurePreview = $("#abs-figure-preview");
  const figureImg = $("#abs-figure-img");
  const figureRemove = $("#abs-figure-remove");
  const noTalkEl = $("#abs-no-talk");
  const saveBtn = $("#abs-save");
  const deleteBtn = $("#abs-delete");

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose a topic…";
  topicEl.append(placeholder);
  for (const topic of ABSTRACT_TOPICS) {
    const option = document.createElement("option");
    option.value = topic;
    option.textContent = TOPIC_LABELS[topic] ?? topic;
    topicEl.append(option);
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

  // Figure state, tracked separately from the form fields: `pendingFile` is a
  // chosen-but-not-yet-uploaded File, and figureUrl/figurePath are what is
  // already in Storage. Uploading on submit rather than on pick means an
  // abandoned form leaves no orphan object in the bucket.
  let pendingFile = null;
  let figureUrl = abstract?.figureUrl ?? null;
  let figurePath = abstract?.figurePath ?? null;
  let figureCleared = false;

  const showFigure = (src) => {
    figurePreview.hidden = !src;
    if (src) figureImg.src = src;
  };

  const abstractId = abstract?.id ?? newAbstractId();

  // The submitter, who is always the person at the keyboard here — the admin
  // console has no content editor. Passed explicitly all the same, so a save can
  // never silently reassign ownership.
  const ownerUid = abstract?.ownerUid ?? user.uid;

  if (abstract) {
    titleEl.value = abstract.title ?? "";
    topicEl.value = abstract.topic ?? "";
    affEl.value = (abstract.affiliations ?? []).join("\n");
    bodyEl.value = abstract.body ?? "";
    noTalkEl.checked = abstract.talkConsidered === false;
    for (const author of abstract.authors ?? []) {
      authorsEl.append(authorRow({
        name: author.name,
        marks: (author.affiliationIndexes ?? []).map((i) => i + 1).join(","),
        presenting: author.presenting,
      }));
    }
    showFigure(figureUrl);
    saveBtn.textContent = "Save changes";

    const status = document.createElement("span");
    status.className = "pill";
    status.textContent = abstract.status;
    $("#abs-status").replaceChildren(document.createTextNode("Status: "), status);
  } else {
    // The author row below defaults to affiliation "1", so seeding the box from
    // the profile is what makes that mark point at something.
    affEl.value = defaultAffiliation;
    authorsEl.append(authorRow({ name: defaultAuthorName, marks: "1", presenting: true }));
  }

  // Only an accepted abstract is locked, matching the rules: its public copy
  // would otherwise go stale. Rejected and withdrawn stay editable so the
  // participant can revise and resubmit before the deadline.
  //
  // This holds for organizers too, even though firestore.rules would let them
  // through. The admin console deliberately has no content editor: accept,
  // reject and the reviewer note are the whole of an organizer's power over
  // somebody else's words.
  const frozen = abstract?.status === "accepted";

  // Organizers are exempt from the verification gate and the submission window,
  // because firestore.rules already grants them `allow write: if isAdmin()`.
  // Gating them in the UI alone would be theatre, and it locks an organizer out
  // of their own submission whenever verification mail is undeliverable.
  const editable = (isAdmin || (verified && windowOpen)) && !frozen;

  if (frozen) say("This abstract has been accepted. Contact the organizers to change it.", "warn");
  else if (isAdmin && (!verified || !windowOpen)) {
    say("You are an organizer, so you can submit even though "
      + (!verified ? "your email is unverified" : "submissions are closed") + ".", "warn");
  } else if (!verified) say("Verify your email address before submitting.", "warn");
  else if (!windowOpen) say("Submissions are closed. You can still read your abstract.", "warn");
  else if (abstract?.status === "rejected") {
    say("This abstract was not accepted. You can revise and resubmit it before the deadline.", "warn");
  } else if (abstract?.status === "withdrawn") {
    say("This abstract was withdrawn by the organizers. You can revise and resubmit it before the deadline.", "warn");
  }

  if (!editable) {
    for (const field of form.querySelectorAll("input, textarea, select, button")) {
      field.disabled = true;
    }
  }
  deleteBtn.hidden = !(abstract && editable);

  // Appended AFTER the disable loop on purpose: on a frozen (accepted) abstract
  // every other control is disabled, and Cancel is the only way back out of the
  // read-only view.
  if (onCancel) {
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => onCancel());
    $(".actions").append(cancelBtn);
  }

  const refreshPreview = () => {
    $("#abs-preview").innerHTML = renderAbstractHtml(bodyEl.value);
    $("#abs-count").textContent = `${bodyEl.value.length} / 2500`;
  };
  bodyEl.addEventListener("input", refreshPreview);
  refreshPreview();

  $("#abs-add-author").addEventListener("click", () => authorsEl.append(authorRow()));

  figureEl.addEventListener("change", () => {
    const file = figureEl.files?.[0] ?? null;
    if (!file) return;
    const { valid, errors } = validateFigure({ type: file.type, size: file.size });
    if (!valid) {
      figureEl.value = "";
      return sayErrors(errors);
    }
    pendingFile = file;
    figureCleared = false;
    showFigure(URL.createObjectURL(file));
    say("Figure ready. It is uploaded when you submit the form.", "ok");
  });

  figureRemove.addEventListener("click", () => {
    pendingFile = null;
    figureEl.value = "";
    figureCleared = Boolean(figurePath);
    showFigure(null);
  });

  const collect = () => ({
    title: titleEl.value,
    topic: topicEl.value,
    affiliations: parseAffiliations(affEl.value),
    authors: [...authorsEl.querySelectorAll("tr")].map((tr) => ({
      name: tr.querySelector(".a-name").value.trim(),
      affiliationIndexes: parseAffiliationIndexes(tr.querySelector(".a-marks").value),
      presenting: tr.querySelector(".a-presenting").checked,
    })),
    body: bodyEl.value,
    talkConsidered: !noTalkEl.checked,
  });

  // Taken once the fields are populated, so "dirty" means changed by the person
  // at the keyboard rather than changed by the mount.
  let pristine = draftFingerprint(collect());
  const isDirty = () =>
    draftFingerprint(collect()) !== pristine || pendingFile !== null || figureCleared;

  /**
   * Save the form. Returns true only if the abstract reached Firestore.
   *
   * `notify` is false when the caller drove the save itself — it is about to
   * re-render the list anyway, and firing `onSaved` here would tear this form
   * down underneath the caller mid-flow.
   */
  async function submitForm({ notify = true } = {}) {
    const draft = collect();
    const { valid, errors } = validateAbstract(draft, { submissionsOpen, deadline });
    if (!valid) {
      sayErrors(errors);
      return false;
    }

    saveBtn.disabled = true;
    try {
      // Upload before the document write: if Storage fails the abstract is not
      // saved pointing at a figure that does not exist.
      if (pendingFile) {
        say("Uploading the figure…", "ok");
        ({ url: figureUrl, path: figurePath } = await uploadFigure(user.uid, abstractId, pendingFile));
        pendingFile = null;
      } else if (figureCleared) {
        await deleteFigure(figurePath);
        figureUrl = null;
        figurePath = null;
        figureCleared = false;
      }

      await saveAbstract(
        abstractId,
        ownerUid,
        { ...draft, figureUrl, figurePath },
        { createdAt: abstract?.createdAt ?? null },
      );
      say("Abstract saved. You can edit it until the deadline.", "ok");
      deleteBtn.hidden = false;
      saveBtn.textContent = "Save changes";
      figureEl.value = "";
      // What is on screen is now what is stored, so a second switch away must
      // not prompt again.
      pristine = draftFingerprint(collect());
      if (notify) await onSaved();
      return true;
    } catch (err) {
      say("Could not save your abstract. Please try again.", "err");
      console.error("[pints] saveAbstract", err);
      return false;
    } finally {
      saveBtn.disabled = false;
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    submitForm();
  });

  deleteBtn.addEventListener("click", async () => {
    if (!confirm(`Delete “${abstract?.title ?? "this abstract"}”? This cannot be undone.`)) return;
    deleteBtn.disabled = true;
    try {
      await deleteAbstract(abstractId);
      // Best-effort: an orphaned figure is invisible and costs nothing, whereas
      // failing the delete over it would leave the abstract in place.
      await deleteFigure(figurePath).catch((err) => console.error("[pints] deleteFigure", err));
      await onSaved();
    } catch (err) {
      say("Could not delete the abstract.", "err");
      console.error("[pints] deleteAbstract", err);
      deleteBtn.disabled = false;
    }
  });

  return {
    id: abstractId,
    editable,
    isDirty,
    save: () => submitForm({ notify: false }),
  };
}
