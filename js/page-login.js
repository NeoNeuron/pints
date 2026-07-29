import { mountLayout, setAuthLink } from "./layout.js";
import { warnIfUnconfigured } from "./firebase.js";
import { friendlyAuthError, onUser, sendReset, signIn, signUp } from "./auth.js";

mountLayout();

const form = document.getElementById("auth-form");
const msg = document.getElementById("msg");
const emailEl = document.getElementById("email");
const passwordEl = document.getElementById("password");
const rememberEl = document.getElementById("remember");
const buttons = [...document.querySelectorAll("#auth-form button")];

function say(text, kind = "ok") {
  msg.className = `msg ${kind}`;
  msg.textContent = text;
}

const busy = (state) => { for (const b of buttons) b.disabled = state; };

async function run(fn) {
  busy(true);
  try {
    await fn();
  } catch (err) {
    say(friendlyAuthError(err), "err");
    console.error("[pints] auth", err);
  } finally {
    busy(false);
  }
}

// Nothing below works until the Firebase project exists. Say so plainly rather
// than letting the SDK throw something cryptic on first click.
if (warnIfUnconfigured(msg)) {
  form.hidden = true;
} else {
  // Signing up changes auth state, which would immediately redirect and discard
  // the "check your inbox" message. Hold the user here until they move on.
  let justSignedUp = false;

  onUser(({ user, isAdmin }) => {
    setAuthLink({ signedIn: Boolean(user), isAdmin });
    if (user && !justSignedUp) location.replace(isAdmin ? "admin.html" : "account.html");
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    run(() => signIn(emailEl.value.trim(), passwordEl.value, rememberEl.checked));
  });

  document.getElementById("signup").addEventListener("click", () =>
    run(async () => {
      justSignedUp = true;
      await signUp(emailEl.value.trim(), passwordEl.value, rememberEl.checked);
      msg.className = "msg ok";
      const link = document.createElement("a");
      link.href = "account.html";
      link.textContent = "complete your registration";
      msg.replaceChildren(
        document.createTextNode("Account created. Check your inbox for a verification link, then "),
        link,
        document.createTextNode("."),
      );
    }));

  document.getElementById("reset").addEventListener("click", () =>
    run(async () => {
      const email = emailEl.value.trim();
      if (!email) return say("Enter your email address first.", "warn");
      await sendReset(email);
      say("If that address has an account, a reset link is on its way.", "ok");
    }));
}
