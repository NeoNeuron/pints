import { mountLayout, setAuthLink } from "./layout.js";
import { warnIfUnconfigured } from "./firebase.js";
import { checkIsAdmin, refreshVerification, requireUser, sendVerification, signOutNow } from "./auth.js";
import { getMyAbstract, getProfile, publishParticipant, saveProfile } from "./db.js";
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
      "Your email address is not confirmed yet, so your name is not on the "
      + "participant list. It goes on automatically the moment you click the "
      + "link — you can submit an abstract either way. The message comes from a "
      + "firebaseapp.com address, so check your spam or quarantine folder: some "
      + "university mail servers hold it there.";

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

  // Confirming the address is what puts you on the participant list — there is
  // no button, and there never was an opt-in. Registration writes users/{uid}
  // only; this is the other half, and it runs here because the verification
  // link lands on this page (see returnToAccount() in auth.js). It is idempotent
  // on purpose: a registration interrupted between the two writes heals itself
  // the next time the person opens their account.
  if (verified && profile?.displayName) {
    publishParticipant(user.uid, profile)
      .catch((err) => console.error("[pints] publishParticipant", err));
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const displayName = nameEl.value.trim();
    if (!displayName) return say("Your full name is required.", "err");
    try {
      await saveProfile(user.uid, {
        email: user.email,
        displayName,
        affiliation: affEl.value,
      }, { publish: verified });
      say(verified
        ? "Saved. The participant list has been updated."
        : "Saved. Your name goes on the participant list once you confirm your "
          + "email address.", "ok");
    } catch (err) {
      say("Could not save your details. Please try again.", "err");
      console.error("[pints] saveProfile", err);
    }
  });

  document.getElementById("signout").addEventListener("click", async () => {
    await signOutNow();
    location.replace("index.html");
  });

  await mountAbstracts({ user, isAdmin, profile });
}

/**
 * The abstract area: one submission per participant, so there is no list.
 *
 * Either they have an abstract and the editor is mounted for it, or they do not
 * and the blank form waits behind a closed <details>. The disclosure stays for
 * the second case because submitting is optional and most registrations never
 * will — no reason to make everyone pay for the form or its config read — and
 * because it is what `account.html#abstract` opens when somebody arrives from
 * the "Submit an abstract" button on the home page.
 *
 * Everything that used to arbitrate between several open editors is gone with
 * the second abstract that made it necessary.
 */
async function mountAbstracts({ user, isAdmin, profile }) {
  const host = document.getElementById("abstract-section");
  host.hidden = false;
  host.innerHTML = `
    <h2>Abstract</h2>
    <p class="muted">You may submit one abstract. It is presented as a poster, and
      every poster is considered for a talk unless you opt out.</p>
    <div id="abs-msg" class="msg" role="status" aria-live="polite"></div>
    <div id="abs-host"></div>
    <details id="abs-new" hidden>
      <summary>I would like to submit an abstract</summary>
      <div id="abs-new-host"></div>
    </details>`;

  const listMsg = host.querySelector("#abs-msg");
  const editHost = host.querySelector("#abs-host");
  const details = host.querySelector("#abs-new");
  const formHost = host.querySelector("#abs-new-host");

  const defaults = {
    user,
    isAdmin,
    defaultAuthorName: profile?.displayName ?? "",
    defaultAffiliation: profile?.affiliation ?? "",
  };

  /** Mount the blank form. Deferred until the disclosure is first opened. */
  const openNewForm = async () => {
    if (formHost.firstChild) return;   // a half-typed draft is still a draft
    await mountAbstractForm(formHost, { ...defaults, onSaved: render });
  };

  details.addEventListener("toggle", () => {
    if (details.open) openNewForm().catch((err) => fail(err));
  });

  const fail = (err) => {
    listMsg.className = "msg err";
    listMsg.textContent = "Could not load your abstract.";
    console.error("[pints] abstract", err);
  };

  const say = (text, kind = "ok") => {
    listMsg.className = `msg ${kind}`;
    listMsg.textContent = text;
  };

  // Which abstract the editor currently holds. The form calls back on every
  // save as well as on delete, and re-mounting after an ordinary save would
  // throw away the "Abstract saved" line the person is reading. So a render
  // only rebuilds when the abstract has appeared or disappeared.
  let mountedId = null;

  async function render() {
    try {
      const mine = await getMyAbstract(user.uid);
      if (mine && mine.id === mountedId) return;

      if (!mine) {
        mountedId = null;
        editHost.replaceChildren();
        // A deleted abstract leaves a stale draft behind; clear it so reopening
        // the disclosure mounts a blank form.
        formHost.replaceChildren();
        details.hidden = false;
        listMsg.className = "msg";
        listMsg.textContent = "";
        // Arriving from "Submit an abstract" on the home page: open the form
        // rather than leaving a closed disclosure they have to find and click.
        if (location.hash === "#abstract") details.open = true;
        if (details.open) await openNewForm();
        return;
      }

      const first = mountedId === null && Boolean(formHost.firstChild);
      mountedId = mine.id;
      details.hidden = true;
      details.open = false;
      formHost.replaceChildren();
      await mountAbstractForm(editHost, { ...defaults, abstract: mine, onSaved: render });
      if (first) say("Abstract submitted. You can edit it until the deadline.", "ok");
      else { listMsg.className = "msg"; listMsg.textContent = ""; }
    } catch (err) {
      fail(err);
    }
  }

  await render();

  if (location.hash === "#abstract") {
    host.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}
