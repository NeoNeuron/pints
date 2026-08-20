import { mountLayout, setAuthLink } from "./layout.js";
import { warnIfUnconfigured } from "./firebase.js";
import { checkIsAdmin, refreshVerification, requireUser, sendVerification, signOutNow } from "./auth.js";
import { getProfile, publishParticipant, saveProfile } from "./db.js";

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
      + "participant list and you cannot submit an abstract. Both open up the "
      + "moment you click the link. Check your spam or quarantine folder if it "
      + "has not arrived: some university mail servers hold it there.";

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
    // Measured 2026-08-19: a @cnrs.fr address received nothing at all. Resending
    // cannot fix a gateway that drops the mail, so offer an exit that does not
    // depend on email arriving. See the README.
    const stuck = document.createElement("p");
    stuck.className = "muted";
    stuck.style.margin = ".5rem 0 0";
    stuck.append("Still nothing after a few minutes? ");
    const ask = document.createElement("a");
    ask.href = "contact.html";
    ask.textContent = "Tell the organizers";
    stuck.append(ask, " and we will confirm your address by hand.");

    banner.replaceChildren(explain, again, stuck);
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
}
