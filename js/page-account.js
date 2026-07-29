import { mountLayout, setAuthLink } from "./layout.js";
import { warnIfUnconfigured } from "./firebase.js";
import { checkIsAdmin, refreshVerification, requireUser, sendVerification, signOutNow } from "./auth.js";
import { getProfile, saveProfile } from "./db.js";

mountLayout();

const msg = document.getElementById("msg");
const banner = document.getElementById("verify-banner");
const form = document.getElementById("profile-form");
const nameEl = document.getElementById("displayName");
const affEl = document.getElementById("affiliation");
const showEl = document.getElementById("showPublicly");

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
  showEl.checked = Boolean(profile?.showPublicly);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const displayName = nameEl.value.trim();
    if (!displayName) return say("Your full name is required.", "err");
    try {
      await saveProfile(user.uid, {
        email: user.email,
        displayName,
        affiliation: affEl.value,
        showPublicly: showEl.checked,
      });
      say(showEl.checked
        ? "Saved. Your name is now on the public participant list."
        : "Saved. Your name is not shown publicly.", "ok");
    } catch (err) {
      say("Could not save your details. Please try again.", "err");
      console.error("[pints] saveProfile", err);
    }
  });

  document.getElementById("signout").addEventListener("click", async () => {
    await signOutNow();
    location.replace("index.html");
  });

  const { mountAbstractForm } = await import("./abstract-form.js");
  await mountAbstractForm(document.getElementById("abstract-section"),
    { user, verified, isAdmin });
}
