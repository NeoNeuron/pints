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
      say("Saved. Your details are on the public participant list.", "ok");
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

  // Guards the toggle listener below: openForm() opens the disclosure itself
  // when Edit is clicked, and that fires `toggle`, which would otherwise mount
  // a second, blank form on top of the one being opened.
  let mounting = false;

  const summaryEl = details.querySelector("summary");

  // One place decides the disclosure's label, so deleting your last abstract
  // cannot leave it reading "Submit another abstract".
  const setSummary = (count) => {
    summaryEl.textContent = count
      ? "Submit another abstract"
      : "I would like to submit an abstract";
  };

  const openForm = async (abstract) => {
    mounting = true;
    details.open = true;
    if (abstract) summaryEl.textContent = `Editing: ${abstract.title ?? "untitled abstract"}`;
    await mountAbstractForm(formHost, {
      user,
      verified,
      isAdmin,
      abstract,
      defaultAuthorName: profile?.displayName ?? "",
      onSaved: async () => {
        details.open = false;
        formHost.replaceChildren();
        await render();
      },
    });
    mounting = false;
  };

  function card(abstract) {
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
    edit.addEventListener("click", () => openForm(abstract));
    actions.append(edit);

    article.append(h3, meta, actions);
    return article;
  }

  async function render() {
    try {
      const mine = await listMyAbstracts(user.uid);
      listEl.replaceChildren(...mine.map(card));
      listMsg.className = "msg";
      listMsg.textContent = "";
      setSummary(mine.length);
    } catch (err) {
      listMsg.className = "msg err";
      listMsg.textContent = "Could not load your abstracts.";
      console.error("[pints] listMyAbstracts", err);
    }
  }

  // Mount the blank form only when the disclosure is first opened, so a visitor
  // who never submits does not pay for the form or its config read.
  details.addEventListener("toggle", async () => {
    if (details.open && !mounting && !formHost.firstChild) await openForm(null);
  });

  await render();
}
