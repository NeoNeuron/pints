// The other end of every mail Firebase sends on this site.
//
// Firebase used to handle these links itself, on a Google-hosted page. It cannot
// any more: applying a custom domain so the mail is DKIM-signed as pints.fr
// rewrites the ACTION LINKS to pints.fr too, and pints.fr is GitHub Pages, which
// knows nothing about Firebase's handler. So this page redeems the codes. See
// "Verification emails and institutional mail filters" in the README.
//
// Three things follow from where this page sits in the flow:
//
//  1. It must work SIGNED OUT. The link is opened wherever the mail was read,
//     which is very often a phone nobody is signed in on. Every call in auth.js
//     that this uses takes the code alone, not a session.
//  2. It must handle EVERY mode, not just verifyEmail. sendReset() is live, so
//     password-reset links arrive here from the moment the domain is applied,
//     and a handler that only knew verifyEmail would break them silently.
//  3. A failure is a dead end unless it offers a way out, so every error names
//     the page that can issue a fresh link.

import { mountLayout, setAuthLink } from "./layout.js";
import { warnIfUnconfigured } from "./firebase.js";
import {
  applyCode, applyReset, checkResetCode, friendlyAuthError, inspectCode,
  onUser, refreshVerification,
} from "./auth.js";
import { safeContinueUrl } from "./redirect-utils.mjs";

mountLayout();

const head = document.getElementById("head");
const msg = document.getElementById("msg");
const form = document.getElementById("reset-form");
const passwordEl = document.getElementById("password");
const confirmEl = document.getElementById("confirm");
const saveBtn = document.getElementById("save");
const onward = document.getElementById("onward");

const params = new URLSearchParams(location.search);
const mode = params.get("mode");
const code = params.get("oobCode");

// Where Firebase was asked to send them afterwards. It arrives in a link
// anybody can write, so it is validated rather than followed.
const continueTo = safeContinueUrl(params.get("continueUrl"));

// Kept for the emulator, which needs it on every hop to stay off production.
const carry = (href) =>
  (params.has("emulator") ? `${href}${href.includes("?") ? "&" : "?"}emulator` : href);

function say(text, kind = "ok") {
  msg.className = `msg ${kind}`;
  msg.textContent = text;
}

/** Offer the one or two pages that are useful from here. */
function showOnward(links) {
  onward.replaceChildren(...links.map(({ href, label }, i) => {
    const a = document.createElement("a");
    a.className = i === 0 ? "button" : "button secondary";
    a.href = carry(href);
    a.textContent = label;
    return a;
  }));
  onward.hidden = false;
}

// The signed-in state only drives the header here — nothing on this page waits
// for it, because the code is redeemed whether or not anybody is signed in.
let currentUser = null;
onUser(({ user, isAdmin }) => {
  currentUser = user;
  setAuthLink({ signedIn: Boolean(user), isAdmin });
});

async function handleVerifyEmail() {
  await applyCode(code);

  // If this tab happens to be signed in as the person who just confirmed, its
  // ID token still says email_verified=false and will for up to an hour. Pull a
  // fresh one now so account.html can publish them to the participant list on
  // arrival instead of appearing to ignore the confirmation.
  if (currentUser) {
    try {
      await refreshVerification(currentUser);
    } catch (err) {
      // Cosmetic at worst: the next page load gets a fresh token anyway.
      console.warn("[pints] could not refresh the token after verifying", err);
    }
  }

  head.textContent = "Email confirmed";
  say("Your address is confirmed. Your name goes on the participant list and "
    + "the abstract form is open to you.", "ok");
  showOnward([
    { href: continueTo ?? "account.html", label: "Go to your account" },
    { href: "submit.html", label: "Submit an abstract" },
  ]);
}

async function handleRecoverEmail() {
  // Read it before spending it: once applied, there is nothing left to ask what
  // address the change was about, and that is the one fact worth reporting.
  const info = await inspectCode(code);
  const restored = info?.data?.email ?? "";
  await applyCode(code);

  head.textContent = "Sign-in address restored";
  say(restored
    ? `Your sign-in address has been set back to ${restored}. If you did not ask `
      + "for this, reset your password now — somebody else may know it."
    : "Your sign-in address has been restored. If you did not ask for this, "
      + "reset your password now — somebody else may know it.", "ok");
  showOnward([{ href: "login.html", label: "Sign in" }]);
}

async function handleResetPassword() {
  const email = await checkResetCode(code);

  head.textContent = "Choose a new password";
  say(`Setting a new password for ${email}.`, "ok");
  form.hidden = false;
  passwordEl.focus();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (passwordEl.value.length < 6) {
      say("Passwords must be at least 6 characters.", "err");
      return;
    }
    if (passwordEl.value !== confirmEl.value) {
      say("Those two passwords do not match.", "err");
      return;
    }

    saveBtn.disabled = true;
    try {
      await applyReset(code, passwordEl.value);
      form.hidden = true;
      head.textContent = "Password changed";
      say("Your password is set. Sign in with it.", "ok");
      showOnward([{ href: "login.html", label: "Sign in" }]);
    } catch (err) {
      console.error("[pints] password reset", err);
      say(friendlyAuthError(err), "err");
      showOnward([{ href: "login.html", label: "Ask for a new link" }]);
    } finally {
      saveBtn.disabled = false;
    }
  });
}

const HANDLERS = {
  verifyEmail: handleVerifyEmail,
  resetPassword: handleResetPassword,
  recoverEmail: handleRecoverEmail,
};

// Which page can issue a replacement, per mode. A dead link with no way forward
// is the failure this page exists to avoid.
const RESCUE = {
  verifyEmail: { href: "account.html", label: "Send a new link" },
  resetPassword: { href: "login.html", label: "Ask for a new link" },
  recoverEmail: { href: "login.html", label: "Sign in" },
};

async function run() {
  const handler = HANDLERS[mode];
  if (!handler || !code) {
    // Someone typed the address, or followed a mangled link. Not an error worth
    // a stack trace — just nothing to do here.
    head.textContent = "Nothing to confirm";
    say("This page finishes a confirmation from an email we sent you. Open it "
      + "from the link in that message.", "warn");
    showOnward([{ href: "index.html", label: "Go to the home page" }]);
    return;
  }

  try {
    await handler();
  } catch (err) {
    console.error("[pints] auth action", mode, err);
    head.textContent = "That link did not work";
    say(friendlyAuthError(err), "err");
    showOnward([RESCUE[mode], { href: "index.html", label: "Home" }]);
  }
}

if (!warnIfUnconfigured(msg)) await run();
