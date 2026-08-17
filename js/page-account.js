import { mountLayout, setAuthLink } from "./layout.js";
import { warnIfUnconfigured } from "./firebase.js";
import { checkIsAdmin, refreshVerification, requireUser, sendVerification, signOutNow } from "./auth.js";
import { getProfile, listMyAbstracts, saveProfile } from "./db.js";
import { TOPIC_LABELS } from "./config.mjs";
// Static, not a runtime import(): this page always needs the form, and a
// dynamically imported module is fetched with ordinary HTTP-cache semantics,
// so it survives a hard reload as a stale copy for up to GitHub Pages'
// 10-minute max-age. Static imports are part of the module graph and are
// revalidated with the document.
import { mountAbstractForm } from "./abstract-form.js";
import { confirmChoice } from "./confirm-dialog.js";

mountLayout();

const msg = document.getElementById("msg");
const banner = document.getElementById("verify-banner");
const form = document.getElementById("profile-form");
const nameEl = document.getElementById("displayName");
const affEl = document.getElementById("affiliation");

const say = (text, kind = "ok") => {
  msg.className = `msg ${kind}`;
  msg.textContent = text;
};

if (warnIfUnconfigured(msg)) {
  form.hidden = true;
} else {
  const user = await requireUser();
  const isAdmin = await checkIsAdmin(user.uid);
  setAuthLink({ signedIn: true, isAdmin });

  // Force a token refresh so email_verified is current. Clicking the
  // verification link does not update the token this tab already holds, and a
  // stale token is what makes a first submission fail with PERMISSION_DENIED.
  const verified = await refreshVerification(user);
  if (!verified) {
    banner.hidden = false;
    const explain = document.createElement("p");
    explain.style.margin = "0 0 .5rem";
    explain.textContent =
      "Your email address is not verified yet, so you cannot submit an abstract. "
      + "The message comes from a firebaseapp.com address — check your spam or "
      + "quarantine folder, since some university mail servers hold it there.";

    const again = document.createElement("button");
    again.type = "button";
    again.className = "secondary";
    again.textContent = "Resend the verification email";
    again.addEventListener("click", async () => {
      again.disabled = true;
      try {
        await sendVerification(user);
        say("Verification email sent. Check your spam folder too.", "ok");
      } catch (err) {
        // Surface the code: auth/too-many-requests is common and self-resolving,
        // and the distinction matters when debugging deliverability.
        say(`Could not send the verification email (${err?.code ?? "unknown"}). `
          + "If this keeps happening, ask an organizer.", "err");
        console.error("[pints] sendVerification", err);
      } finally {
        again.disabled = false;
      }
    });
    banner.replaceChildren(explain, again);
  }

  const profile = await getProfile(user.uid);
  nameEl.value = profile?.displayName ?? user.displayName ?? "";
  affEl.value = profile?.affiliation ?? "";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const displayName = nameEl.value.trim();
    if (!displayName) return say("Your full name is required.", "err");
    try {
      await saveProfile(user.uid, {
        email: user.email,
        displayName,
        affiliation: affEl.value,
      });
      say("Saved.", "ok");
    } catch (err) {
      say("Could not save your details. Please try again.", "err");
      console.error("[pints] saveProfile", err);
    }
  });

  document.getElementById("signout").addEventListener("click", async () => {
    await signOutNow();
    location.replace("index.html");
  });

  await mountAbstracts({ user, verified, isAdmin, profile });
}

/**
 * The abstracts area: a list of what this person has already submitted, and a
 * disclosure that is CLOSED by default.
 *
 * Submitting an abstract is optional and most registrations never will, so the
 * form is not on the page until someone asks for it. <details> gives the
 * open/close behaviour, keyboard handling, and screen-reader semantics without
 * any JavaScript of our own.
 *
 * Exactly one editor is open at any moment. That is enforced structurally
 * rather than by asking each row to behave: `editingId` says which abstract is
 * being edited, `render()` reads it and opens that one panel, and every route
 * into editing goes through `requestEdit`. Two editors open at once meant two
 * drafts of the same list competing, and a save from either silently discarding
 * the other.
 */
async function mountAbstracts({ user, verified, isAdmin, profile }) {
  const host = document.getElementById("abstract-section");
  host.hidden = false;
  host.innerHTML = `
    <h2>Abstracts</h2>
    <p class="muted">You may submit as many abstracts as you like. Each one is
      a poster, and every poster is considered for a talk unless you opt out.</p>
    <div id="abs-list-msg" class="msg" role="status" aria-live="polite"></div>
    <div id="abs-list"></div>
    <details id="abs-new">
      <summary>I would like to submit an abstract</summary>
      <div id="abs-new-host"></div>
    </details>`;

  const listMsg = host.querySelector("#abs-list-msg");
  const listEl = host.querySelector("#abs-list");
  const details = host.querySelector("#abs-new");
  const formHost = host.querySelector("#abs-new-host");

  // Guards the toggle listener below: opening or closing the disclosure
  // programmatically fires `toggle`, which would otherwise re-enter the
  // arbitration we are already in the middle of.
  let mounting = false;

  // `editor` is the handle on whichever form is currently mounted — a row's
  // editor or the new-submission form — because "one panel at a time" has to
  // cover both. `editingId` names the row, and is null when the open form is the
  // new-submission one. It survives a re-render; `editor` does not, because the
  // row form it points at is destroyed whenever the list is rebuilt.
  let editingId = null;
  let editor = null;
  let editorLabel = "";

  const summaryEl = details.querySelector("summary");

  // One place decides the disclosure's label, so deleting your last abstract
  // cannot leave it reading "Submit another abstract".
  const setSummary = (count) => {
    summaryEl.textContent = count
      ? "Submit another abstract"
      : "I would like to submit an abstract";
  };

  /**
   * Clear the way for another panel, asking first if there is unsaved work.
   *
   * Returns false if the person backed out, in which case the caller must leave
   * everything exactly as it was. A failed save also returns false: the form has
   * already shown why on its own message line, and moving on regardless would
   * throw the work away behind a message nobody read.
   */
  async function releaseEditor(what) {
    if (!editor || !editor.editable || !editor.isDirty()) return true;

    const choice = await confirmChoice({
      title: "Unsaved changes",
      message: `You are still editing ${editorLabel}. Save your changes before ${what}?`,
      choices: [
        { value: "save", label: "Save and continue" },
        { value: "discard", label: "Discard changes", className: "danger" },
        { value: "cancel", label: "Cancel", className: "secondary" },
      ],
    });

    if (choice === "save") return editor.save();
    return choice === "discard";
  }

  /** Collapse the disclosure without going back through the toggle handler. */
  function collapseNewForm() {
    mounting = true;
    details.open = false;
    mounting = false;
  }

  /** Collapse the new-submission disclosure and throw its draft away. */
  function closeNewForm() {
    collapseNewForm();
    formHost.replaceChildren();
  }

  /** The single entry point into editing, from a row's Edit/View button. */
  async function requestEdit(abstract) {
    if (editingId === abstract.id) return;
    if (!(await releaseEditor(`opening “${abstract.title ?? "another abstract"}”`))) return;
    // The disclosure counts as a panel, so it closes too — otherwise a half-typed
    // new submission sits open below the row you just started editing.
    closeNewForm();
    editor = null;
    editingId = abstract.id;
    await render();
  }

  /** Mount the blank "new abstract" form in the disclosure at the bottom. */
  const openNewForm = async () => {
    mounting = true;
    details.open = true;
    editor = await mountAbstractForm(formHost, {
      user,
      verified,
      isAdmin,
      defaultAuthorName: profile?.displayName ?? "",
      defaultAffiliation: profile?.affiliation ?? "",
      onSaved: async () => {
        editor = null;
        closeNewForm();
        await render();
      },
    });
    editorLabel = "your new abstract";
    mounting = false;
  };

  /**
   * Editing happens in place.
   *
   * The editor is mounted into the row it belongs to and the summary card is
   * hidden while it is open, so the form is never far from the abstract it is
   * editing and the same abstract is never on screen twice. Sending edits to
   * the disclosure at the bottom of the list meant scrolling past every other
   * submission to reach them.
   */
  function row(abstract) {
    const wrapper = document.createElement("div");
    const summary = card(abstract, () => requestEdit(abstract));
    const frozen = abstract.status === "accepted";

    // Same chrome as the "submit an abstract" disclosure, because it is the same
    // form. The head also names what is being edited, which the disclosure gets
    // from its summary.
    const editHost = document.createElement("div");
    editHost.className = "panel";
    editHost.hidden = true;
    const head = document.createElement("div");
    head.className = "panel-head";
    head.textContent = `${frozen ? "Viewing" : "Editing"} “${abstract.title ?? "(untitled)"}”`;
    const body = document.createElement("div");
    body.className = "panel-body";
    editHost.append(head, body);

    wrapper.append(summary, editHost);

    const stopEditing = () => {
      editingId = null;
      editor = null;
      body.replaceChildren();
      editHost.hidden = true;
      summary.hidden = false;
    };

    async function startEditing() {
      summary.hidden = true;
      editHost.hidden = false;

      editor = await mountAbstractForm(body, {
        user,
        verified,
        isAdmin,
        abstract,
        defaultAuthorName: profile?.displayName ?? "",
        onCancel: stopEditing,
        onSaved: async () => {
          editingId = null;
          await render();
        },
      });
      editorLabel = `“${abstract.title ?? "(untitled)"}”`;
    }

    return { wrapper, startEditing };
  }

  function card(abstract, onEdit) {
    const article = document.createElement("article");
    article.className = "card";

    const h3 = document.createElement("h3");
    h3.textContent = abstract.title ?? "(untitled)";

    const meta = document.createElement("p");
    for (const label of [TOPIC_LABELS[abstract.topic] ?? abstract.topic, abstract.status]) {
      if (!label) continue;
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = label;
      meta.append(pill, " ");
    }
    if (abstract.talkConsidered === false) {
      const note = document.createElement("span");
      note.className = "muted";
      note.textContent = "not to be considered for a talk";
      meta.append(note);
    }

    const actions = document.createElement("div");
    actions.className = "actions";
    const edit = document.createElement("button");
    edit.className = "secondary";
    edit.textContent = abstract.status === "accepted" ? "View" : "Edit";
    edit.addEventListener("click", onEdit);
    actions.append(edit);

    article.append(h3, meta, actions);
    return article;
  }

  async function render() {
    try {
      const mine = await listMyAbstracts(user.uid);
      // A row's form is gone the moment the list is replaced, so drop the handle
      // before anything can call save() on a detached DOM tree. The
      // new-submission form lives outside the list and survives.
      if (editingId !== null) editor = null;
      const rows = mine.map((abstract) => ({ abstract, ...row(abstract) }));
      listEl.replaceChildren(...rows.map((r) => r.wrapper));
      listMsg.className = "msg";
      listMsg.textContent = "";
      setSummary(mine.length);

      const open = rows.find((r) => r.abstract.id === editingId);
      if (open) {
        await open.startEditing();
        open.wrapper.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } else {
        // The abstract being edited was deleted, or this is the first render.
        editingId = null;
      }
    } catch (err) {
      listMsg.className = "msg err";
      listMsg.textContent = "Could not load your abstracts.";
      console.error("[pints] listMyAbstracts", err);
    }
  }

  // Mount the blank form only when the disclosure is first opened, so a visitor
  // who never submits does not pay for the form or its config read. Opening it
  // is also a route out of an editor, so it goes through the same arbitration.
  details.addEventListener("toggle", async () => {
    if (!details.open || mounting) return;
    // Reopening the disclosure over its own half-typed draft is not a switch —
    // it is the same panel — so it must not prompt about itself.
    if (editingId === null && formHost.firstChild) return;
    if (!(await releaseEditor("starting a new one"))) {
      collapseNewForm();
      return;
    }
    if (editingId !== null) {
      editingId = null;
      editor = null;
      await render();
    }
    // A draft left in a collapsed disclosure is still a draft: reopening shows
    // it again rather than mounting a blank form over it.
    if (!formHost.firstChild) await openNewForm();
  });

  await render();
}
