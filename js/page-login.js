import { mountLayout, setAuthLink } from "./layout.js";
import { warnIfUnconfigured } from "./firebase.js";
import { friendlyAuthError, onUser, sendReset, signIn } from "./auth.js";
import { destinationAfterAuth, withNext } from "./redirect-utils.mjs";

mountLayout();

const form = document.getElementById("auth-form");
const msg = document.getElementById("msg");
const emailEl = document.getElementById("email");
const passwordEl = document.getElementById("password");
const rememberEl = document.getElementById("remember");
const buttons = [...document.querySelectorAll("#auth-form button")];

// Whatever page sent us here has to survive the detour through registering, so
// both routes onwards carry it.
const next = new URLSearchParams(location.search).get("next");
for (const id of ["to-register", "register-link"]) {
  const link = document.getElementById(id);
  if (link) link.href = withNext("register.html", next);
}

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
  onUser(({ user, isAdmin }) => {
    setAuthLink({ signedIn: Boolean(user), isAdmin });
    if (user) location.replace(destinationAfterAuth(next, { isAdmin }));
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    run(() => signIn(emailEl.value.trim(), passwordEl.value, rememberEl.checked));
  });

  document.getElementById("reset").addEventListener("click", () =>
    run(async () => {
      const email = emailEl.value.trim();
      if (!email) return say("Enter your email address first.", "warn");
      await sendReset(email);
      say("If that address has an account, a reset link is on its way.", "ok");
    }));
}
