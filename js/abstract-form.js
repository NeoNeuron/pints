import { ABSTRACT_TOPICS, LIMITS, TOPIC_LABELS } from "./config.mjs";
import {
  parseAffiliationIndexes,
  parseAffiliations,
  validateAbstract,
  validateSubmitter,
} from "./abstract-validation-utils.mjs";
import { draftFingerprint } from "./abstract-utils.mjs";
import { validateFigure } from "./figure-utils.mjs";
import { abstractCard } from "./abstract-card.js";
import { deleteAbstract, getSiteConfig, saveAbstract } from "./db.js";
import { deleteFigure, uploadFigure } from "./storage.js";

const TEMPLATE = `
  <p id="window-note" class="muted"></p>
  <div id="abs-notice" class="msg" role="status" aria-live="polite"></div>
  <p id="abs-status"></p>

  <form id="abs-form" novalidate>
    <fieldset id="abs-contact" hidden>
      <legend>Your details</legend>
      <p class="hint" id="abs-contact-note"></p>

      <label for="abs-contact-name">Full name
        <span class="hint">As you want it to appear on the participant list.</span>
      </label>
      <input id="abs-contact-name" type="text" maxlength="80" autocomplete="name">

      <label for="abs-contact-affiliation">Affiliation
        <span class="hint">Lab, institute, or university.</span>
      </label>
      <input id="abs-contact-affiliation" type="text" maxlength="120" autocomplete="organization">

      <label for="abs-contact-email">Email
        <span class="hint">Where the organizers reach you about this abstract.</span>
      </label>
      <input id="abs-contact-email" type="email" autocomplete="email">
    </fieldset>

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

    <label for="abs-figure">Figure
      <span class="hint">Required. PNG, JPEG, or WebP, up to 5 MB. Large images
        are shrunk automatically before upload.</span></label>
    <input id="abs-figure" type="file" accept="image/png,image/jpeg,image/webp">
    <p id="abs-figure-preview" hidden>
      <img id="abs-figure-img" alt="Figure preview" style="max-width:16rem;height:auto">
      <button type="button" id="abs-figure-remove" class="secondary">Remove figure</button>
    </p>

    <label for="abs-figure-caption">Figure caption
      <span class="hint">Required. Plain text, no formatting.
        <span id="abs-caption-count"></span></span>
    </label>
    <textarea id="abs-figure-caption" maxlength="300" rows="2"
      style="min-height:4rem" required></textarea>

    <div class="checkline">
      <input id="abs-no-talk" type="checkbox">
      <label for="abs-no-talk">I do not want this poster to be considered for a talk
        <span class="hint">By default every poster is considered. Tick this only if you
          would rather not be offered a talk slot.</span>
      </label>
    </div>

    <h3>Preview</h3>
    <p class="hint">Exactly what the abstract list will show, figure and caption
      included. It updates as you type.</p>
    <div id="abs-preview"></div>

    <!-- Beside the button, not at the top of the form. Validation errors and save
         results belong where the eye already is when Submit is pressed; a list of
         problems three screens above it reads as nothing happening at all. The
         mount-time context (#abs-notice) stays up top, where it is read before
         anyone starts typing. -->
    <div id="abs-msg" class="msg" role="status" aria-live="polite"></div>

    <div class="actions">
      <button type="submit" id="abs-save">Submit abstract</button>
      <button type="button" id="abs-delete" class="danger" hidden>Delete this abstract</button>
    </div>
  </form>
`;

function authorRow({ name = "", marks = "", presenting = false } = {}, onChange = () => {}) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="text" class="a-name" maxlength="120"></td>
    <td><input type="text" class="a-marks" size="6" inputmode="numeric"></td>
    <td><input type="radio" name="presenting" class="a-presenting"></td>
    <td><button type="button" class="secondary a-remove">Remove</button></td>`;
  tr.querySelector(".a-name").value = name;
  tr.querySelector(".a-marks").value = marks;
  tr.querySelector(".a-presenting").checked = presenting;
  // Removing a row fires no input event, so the preview has to be told.
  tr.querySelector(".a-remove").addEventListener("click", () => {
    tr.remove();
    onChange();
  });
  return tr;
}

/**
 * Mount the editor for ONE abstract.
 *
 * `abstract` null means a new submission; otherwise the document to edit.
 * `onSaved` is called after a successful save or delete so the caller can
 * re-render. `defaultAuthorName`, `defaultAffiliation` and `defaultEmail` seed
 * the first author row, the affiliations box and the contact block — Firebase
 * Auth carries only the last of the three, the profile carries the others.
 * `onCancel`, when given, adds a Cancel button to the action row, and `onDelete`
 * overrides what the delete button does — a participant deleting their own
 * abstract is a document write their credentials permit, while an organizer
 * deleting somebody else's has to go through the Cloud Function.
 *
 * `republish` is what unlocks an ACCEPTED abstract. It carries the public
 * projection's type and poster number, and supplying it is a promise that the
 * save will rewrite abstracts_public too.
 *
 * `ensureAccount` is how somebody submits without signing in first. Given it and
 * a null `user`, the form collects a name, an affiliation and an email, and
 * calls it on save to turn those into an account — because there is no way to
 * accept an abstract from nobody: firestore.rules keys the document on the
 * owner's uid and storage.rules keys the figure on the uploader's, so an
 * unauthenticated visitor cannot write either. Registering therefore happens a
 * moment before the write rather than after it, which is invisible to the person
 * filling the form and is what keeps the rules the only authorization boundary.
 *
 * Returns a handle so the caller can arbitrate between several editors:
 * `isDirty()` reports unsaved work and `save()` commits it without firing
 * `onSaved`, leaving the caller in charge of re-rendering.
 */
export async function mountAbstractForm(
  host,
  {
    user = null,
    isAdmin = false,
    abstract = null,
    defaultAuthorName = "",
    defaultAffiliation = "",
    defaultEmail = "",
    republish = null,
    ensureAccount = null,
    onCancel = null,
    onDelete = null,
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
  const captionEl = $("#abs-figure-caption");
  const contactEl = $("#abs-contact");
  const contactName = $("#abs-contact-name");
  const contactAffiliation = $("#abs-contact-affiliation");
  const contactEmail = $("#abs-contact-email");
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

  // Two lines, addressed at different moments. `notice` is the state of play when
  // the form mounts — closed window, frozen abstract, an earlier rejection — and
  // is read before typing starts. `say` is the answer to something the person
  // just did, and lives beside the button they just pressed.
  const notice = (text, kind = "warn") => {
    const el = $("#abs-notice");
    el.className = `msg ${kind}`;
    el.textContent = text;
  };

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

  // The src the preview draws: an object: URL for a pending file, the stored
  // URL otherwise, null once removed. Kept beside figurePreview.hidden rather
  // than read back off the <img>, which holds a stale src while hidden.
  let figureSrc = figureUrl;

  const showFigure = (src) => {
    figureSrc = src;
    figurePreview.hidden = !src;
    if (src) figureImg.src = src;
  };

  // `signedIn` is mutable because a guest submission creates the account midway
  // through saving, and everything keyed on a uid has to wait for that.
  let signedIn = user;
  const guest = !signedIn && Boolean(ensureAccount);

  // Whose abstract this is, as opposed to who is saving it. They differ exactly
  // when an organizer edits somebody else's submission, and conflating them
  // would hand them ownership of it.
  //
  // One abstract per participant, and its document id IS the owner's uid — so
  // there is no id to mint and no way to end up with two. Keyed on ownerUid, not
  // the saver's uid: an organizer saving somebody else's edit must write their
  // document, not create one of their own.
  const ownerUidOf = (saver) => abstract?.ownerUid ?? saver.uid;
  const editingSomeoneElse = Boolean(signedIn) && ownerUidOf(signedIn) !== signedIn.uid;

  if (abstract) {
    titleEl.value = abstract.title ?? "";
    topicEl.value = abstract.topic ?? "";
    affEl.value = (abstract.affiliations ?? []).join("\n");
    bodyEl.value = abstract.body ?? "";
    captionEl.value = abstract.figureCaption ?? "";
    noTalkEl.checked = abstract.talkConsidered === false;
    for (const author of abstract.authors ?? []) {
      authorsEl.append(authorRow({
        name: author.name,
        marks: (author.affiliationIndexes ?? []).map((i) => i + 1).join(","),
        presenting: author.presenting,
      }, () => refreshPreview()));
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
    authorsEl.append(authorRow(
      { name: defaultAuthorName, marks: "1", presenting: true }, () => refreshPreview()));
  }

  // Only an accepted abstract is locked, matching the rules: its public copy
  // would otherwise go stale. A rejected one stays editable so the participant
  // can revise and resubmit before the deadline.
  //
  // The exemption is keyed on `republish`, NOT on isAdmin. An accepted abstract
  // is editable exactly when the caller has wired up the public-copy rewrite,
  // which is the only thing that makes the edit safe. Keying it on isAdmin
  // instead would unlock an organizer's own accepted abstract on account.html,
  // where nothing rewrites abstracts_public — publishing one text and showing
  // another. A missing republish therefore fails closed, to read-only.
  const frozen = abstract?.status === "accepted" && !republish;

  // Organizers are exempt from the submission window, because firestore.rules
  // already grants them `allow write: if isAdmin()`. Gating them in the UI alone
  // would be theatre.
  //
  // Submitting no longer requires a verified email address. It used to, and the
  // gate was the wrong shape twice over: it locked people out whose institution
  // quarantined the verification mail (a documented, measured problem — see the
  // README), and it made "submit without an account" impossible, since a
  // just-created account is never verified. What the address still gates is the
  // PUBLIC participant listing, which is where an unproven address would
  // actually do harm.
  const editable = (isAdmin || windowOpen) && !frozen;

  if (frozen) notice("This abstract has been accepted. Contact the organizers to change it.");
  else if (isAdmin && !windowOpen) {
    notice("You are an organizer, so you can submit even though submissions are closed.");
  } else if (!windowOpen) {
    notice("Submissions are closed. You can still read your abstract.");
  } else if (abstract?.status === "rejected") {
    notice("This abstract was not accepted. You can revise and resubmit it before the deadline.");
  }

  // The contact block appears whenever the caller offered `ensureAccount` — for a
  // guest because we need these details to make them an account, and for a
  // signed-in submitter because "which address will they write to" is a fair
  // question and the answer is not otherwise on the page. Theirs is read-only:
  // the address belongs to the login, and changing only this copy would leave
  // the two disagreeing about who they are.
  if (ensureAccount && !abstract) {
    contactEl.hidden = false;
    contactEmail.value = signedIn?.email ?? defaultEmail;
    if (guest) {
      contactName.value = defaultAuthorName;
      contactAffiliation.value = defaultAffiliation;
      $("#abs-contact-note").textContent =
        "You do not need an account first. Submitting creates one for you and "
        + "emails you a link to set a password.";
    } else {
      lockContact();
    }
  }

  /**
   * Once there is an account, the name, affiliation and address belong to it.
   *
   * The address goes read-only rather than disappearing, because "which address
   * will they write to" is a fair question and this is the only place on the
   * page that answers it. The other two do disappear: they duplicate the profile,
   * and the account page is where they are edited.
   *
   * Labels are SIBLINGS of their inputs here, not ancestors — closest("label")
   * finds nothing and hiding the input alone would leave an orphaned caption.
   */
  function lockContact() {
    contactEmail.readOnly = true;
    contactEmail.title = "This is the address you signed in with.";
    for (const field of [contactName, contactAffiliation]) {
      field.hidden = true;
      host.querySelector(`label[for="${field.id}"]`).hidden = true;
    }
    $("#abs-contact-note").textContent =
      "The organizers will write to you here. Change it on your account page.";
  }

  if (!editable) {
    for (const field of form.querySelectorAll("input, textarea, select, button")) {
      field.disabled = true;
    }
  }
  deleteBtn.hidden = !(abstract && editable);

  // storage.rules keys uploads to the uploader's uid and cannot read Firestore
  // to learn who is an organizer, so an admin simply cannot write to another
  // person's figure path. Rather than pretend otherwise and fail on save, the
  // controls are disabled and the reason is stated.
  if (editable && editingSomeoneElse) {
    figureEl.disabled = true;
    figureRemove.disabled = true;
    const note = document.createElement("span");
    note.className = "hint";
    note.textContent = "Only the submitter can change the figure.";
    figureEl.insertAdjacentElement("afterend", note);
  }

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

  // `hasFigure` reduces the two ways a figure can be present — a File waiting to
  // upload, or an object already in Storage — to the one fact the pure validator
  // needs, so "a figure is required" is enforced in a tested function rather than
  // in the DOM.
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
    figureCaption: captionEl.value,
    hasFigure: Boolean(pendingFile) || Boolean(figureUrl && !figureCleared),
  });

  // The preview is the published card, drawn by the same function the abstract
  // list uses — a second, simpler renderer here would quietly turn "this is what
  // will be published" into a guess. The type and poster number are left off:
  // they are the committee's to assign, and showing them would promise a
  // decision that has not been taken.
  const refreshPreview = () => {
    $("#abs-preview").replaceChildren(
      abstractCard({ ...collect(), figureUrl: figureSrc }));
    $("#abs-count").textContent = `${bodyEl.value.length} / ${LIMITS.body}`;
    $("#abs-caption-count").textContent =
      `${captionEl.value.length} / ${LIMITS.figureCaption}`;
  };
  // On the form rather than on each field: author rows come and go, and a
  // listener per input would miss every row added after mount.
  form.addEventListener("input", refreshPreview);
  form.addEventListener("change", refreshPreview);
  refreshPreview();

  $("#abs-add-author").addEventListener("click", () => {
    authorsEl.append(authorRow({}, refreshPreview));
    refreshPreview();
  });

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
    refreshPreview();
    say("Figure ready. It is uploaded when you submit the form.", "ok");
  });

  figureRemove.addEventListener("click", () => {
    pendingFile = null;
    figureEl.value = "";
    figureCleared = Boolean(figurePath);
    showFigure(null);
    refreshPreview();
    // Removing it is allowed; saving without one is not. Say so now rather than
    // letting them fill the rest of the form and hit the error at the end.
    say("Figure removed. Choose another before saving — a figure is required.", "warn");
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
  const contactDetails = () => ({
    displayName: contactName.value,
    affiliation: contactAffiliation.value,
    email: contactEmail.value,
  });

  async function submitForm({ notify = true } = {}) {
    const draft = collect();
    const errors = [
      ...validateAbstract(draft, { submissionsOpen, deadline }).errors,
      // Only a guest is asked for these; a signed-in submitter already has them
      // on their profile and sees the block read-only.
      ...(guest ? validateSubmitter(contactDetails()).errors : []),
    ];
    if (errors.length) {
      sayErrors(errors);
      return false;
    }

    saveBtn.disabled = true;
    try {
      // The account first, and only once the whole form is valid: it is the one
      // step that cannot be undone by pressing Cancel, so nothing that a second
      // attempt would fix should happen before it.
      if (!signedIn) {
        say("Setting up your account…", "ok");
        signedIn = await ensureAccount(contactDetails());
      }
      const ownerUid = ownerUidOf(signedIn);
      const abstractId = abstract?.id ?? ownerUid;

      // Upload before the document write: if Storage fails the abstract is not
      // saved pointing at a figure that does not exist.
      if (pendingFile) {
        say("Uploading the figure…", "ok");
        ({ url: figureUrl, path: figurePath } =
          await uploadFigure(signedIn.uid, abstractId, pendingFile));
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
        {
          // An organizer's edit leaves the status alone; a participant's save is
          // a (re)submission, which is what the rules expect.
          status: editingSomeoneElse ? (abstract?.status ?? "submitted") : "submitted",
          createdAt: abstract?.createdAt ?? null,
          republish: abstract?.status === "accepted" ? republish : null,
        },
      );
      say(editingSomeoneElse
        ? "Abstract saved." + (abstract?.status === "accepted"
          ? " The public list has been updated too." : "")
        : "Abstract saved. You can edit it until the deadline.", "ok");
      deleteBtn.hidden = false;
      saveBtn.textContent = "Save changes";
      figureEl.value = "";
      // The account exists now, so the details that created it are the login's
      // and no longer editable here.
      if (guest && !contactEl.hidden) lockContact();
      // What is on screen is now what is stored, so a second switch away must
      // not prompt again.
      pristine = draftFingerprint(collect());
      if (notify) await onSaved();
      return true;
    } catch (err) {
      // A refusal written for a human — "that address already has an account" —
      // is worth far more than a generic apology, so it is shown as-is.
      say(err?.userFacing ? err.message : "Could not save your abstract. Please try again.", "err");
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
    if (onDelete) return onDelete();
    if (!confirm(`Delete “${abstract?.title ?? "this abstract"}”? This cannot be undone.`)) return;
    deleteBtn.disabled = true;
    try {
      await deleteAbstract(abstract.id);
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
    id: abstract?.id ?? null,
    editable,
    isDirty,
    save: () => submitForm({ notify: false }),
  };
}
