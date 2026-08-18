import { mountLayout, setAuthLink } from "./layout.js";
import { warnIfUnconfigured } from "./firebase.js";
import { createSubmitterAccount, friendlyAuthError, onUser, sendReset } from "./auth.js";
import { getMyAbstract, getProfile, saveProfile } from "./db.js";
import { mountAbstractForm } from "./abstract-form.js";
import { withNext } from "./redirect-utils.mjs";

/**
 * Submitting an abstract, with or without an account.
 *
 * There is no way to accept an abstract from nobody: firestore.rules keys the
 * document on the owner's uid and storage.rules keys the figure on the
 * uploader's, so an unauthenticated visitor cannot write either, and opening
 * those up would hand the collection to anyone holding the public API key.
 * So the account is created a moment BEFORE the write rather than after it —
 * invisible from the form, and the rules stay the only authorization boundary.
 *
 * The whole page re-renders on auth state, which is what makes signing in in
 * another tab (the way out of "that address already has an account") pick up
 * here without anybody losing what they typed in this one.
 */
mountLayout();

const msg = document.getElementById("msg");
const host = document.getElementById("form-host");
const intro = document.getElementById("intro");
const welcome = document.getElementById("welcome");

// Set by ensureAccount when this submission also created an account, and read
// once the abstract lands. Two separate things happened and the person needs to
// be told about both — the second one, the email, is the one they have to act on.
let registered = null;

const say = (text, kind = "ok") => {
  msg.className = `msg ${kind}`;
  msg.textContent = text;
};

if (!warnIfUnconfigured(msg)) {
  // Re-entrancy guard: onUser fires again when ensureAccount() signs the guest
  // in, and re-rendering then would tear down the form mid-save.
  let mounted = false;

  onUser(async ({ user, isAdmin }) => {
    setAuthLink({ signedIn: Boolean(user), isAdmin });
    if (mounted) return;
    mounted = true;
    try {
      await mount(user, isAdmin);
    } catch (err) {
      say("Could not open the submission form. Please reload the page.", "err");
      console.error("[pints] submit", err);
    }
  });
}

async function mount(user, isAdmin) {
  const [profile, mine] = user
    ? await Promise.all([getProfile(user.uid), getMyAbstract(user.uid)])
    : [null, null];

  if (mine) {
    intro.textContent = "You have already submitted an abstract — this is it. "
      + "You can edit it until the deadline.";
  } else if (!user) {
    const signIn = document.createElement("a");
    signIn.href = withNext("login.html", "submit.html");
    signIn.textContent = "sign in";
    intro.append(document.createTextNode(" You do not need an account first: "
      + "submitting creates one. Already have one? "), signIn, document.createTextNode("."));
  }

  await mountAbstractForm(host, {
    user,
    isAdmin,
    abstract: mine,
    defaultAuthorName: profile?.displayName ?? "",
    defaultAffiliation: profile?.affiliation ?? "",
    defaultEmail: user?.email ?? "",
    // Offered even to a signed-in submitter, which is what puts the read-only
    // "we will write to you here" line on the form. It is only ever CALLED when
    // there is no user.
    ensureAccount,
    onSaved: () => {
      if (mine) return;
      if (registered) showWelcome();
      else {
        say("Abstract received. You can come back and edit it until the "
          + "deadline.", "ok");
      }
    },
  });
}

/**
 * Turn the contact details into an account, and return the user to write as.
 *
 * Throws with `userFacing` set for the one failure a person can act on — the
 * address already has an account — so the form shows the real reason instead of
 * a generic apology. Signing in from the link then re-renders this page with
 * the draft still in place, because nothing here navigates away.
 */
async function ensureAccount({ displayName, affiliation, email }) {
  let created;
  try {
    created = await createSubmitterAccount(email.trim());
  } catch (err) {
    console.error("[pints] createSubmitterAccount", err);
    const friendly = new Error(err?.code === "auth/email-already-in-use"
      ? "That address already has an account. Open the sign-in link above in a "
        + "new tab, sign in, and come back here — your abstract is still on this "
        + "page. Then press Submit again."
      : friendlyAuthError(err));
    friendly.userFacing = true;
    throw friendly;
  }

  const { user, passwordEmailSent } = created;

  // Best effort, deliberately: the abstract is the thing they came to do, and
  // losing it because a profile write failed would be a poor trade. The account
  // page lets them fill these in, and the admin console shows the uid meanwhile.
  await saveProfile(user.uid, { email: user.email, displayName, affiliation },
    { publish: false })
    .catch((err) => console.error("[pints] saveProfile during auto-registration", err));

  // An interim line only. The full account is reported once the abstract is
  // actually saved — but if the write below fails, this is what tells them the
  // account exists, so they do not try to submit again and hit
  // auth/email-already-in-use.
  registered = { email: user.email, passwordEmailSent };
  say(`Account created for ${user.email}. Saving your abstract…`, "ok");

  return user;
}

/**
 * The one screen a first-time submitter must not miss.
 *
 * Two things just happened — an abstract was received and an account was created
 * — and only one of them is finished. The email is the unfinished half: until
 * they open it they have no password, their address is unproven, and their name
 * is not on the participant list. So it is a panel rather than a status line,
 * it names the sender domain (institutional filters quarantine it — the measured
 * problem in the README), and it carries its own resend button, because the
 * moment somebody notices the mail never arrived is right now, not on a later
 * visit to a page they do not know exists.
 */
function showWelcome() {
  msg.className = "msg";
  msg.textContent = "";
  // "You do not need an account — already have one? sign in" is now wrong twice
  // over, and they have just been handed one.
  intro.textContent = "One abstract per person. You can edit yours until the "
    + "deadline by signing in.";

  const head = document.createElement("div");
  head.className = "panel-head";
  head.textContent = registered.passwordEmailSent
    ? "Abstract received — now check your email"
    : "Abstract received — but we could not email you";

  const body = document.createElement("div");
  body.className = "panel-body";

  const first = document.createElement("p");
  first.textContent = registered.passwordEmailSent
    ? `Your abstract is in, and we have created an account for ${registered.email}. `
      + "We have just emailed you a link — open it to confirm your address and set "
      + "a password."
    : `Your abstract is in, and we have created an account for ${registered.email}. `
      + "The confirmation email could not be sent, though. Try again below.";

  const why = document.createElement("p");
  why.textContent = "Until you do, your name is not on the public participant "
    + "list and you cannot sign back in to edit this abstract.";

  const where = document.createElement("p");
  where.className = "muted";
  where.textContent = "The message comes from a firebaseapp.com address, so check "
    + "your spam or quarantine folder: some university mail servers hold it there.";

  const resend = document.createElement("button");
  resend.type = "button";
  resend.className = "secondary";
  resend.textContent = "Send it again";
  const resendMsg = document.createElement("span");
  resendMsg.className = "muted";
  resend.addEventListener("click", async () => {
    resend.disabled = true;
    resendMsg.textContent = "";
    try {
      await sendReset(registered.email);
      resendMsg.textContent = `Sent again to ${registered.email}.`;
    } catch (err) {
      // The code matters here: auth/too-many-requests is common and clears by
      // itself, and telling somebody to keep clicking would be useless advice.
      resendMsg.textContent =
        `Could not send it (${err?.code ?? "unknown"}). Ask an organizer if this persists.`;
      console.error("[pints] resend set-password email", err);
    } finally {
      resend.disabled = false;
    }
  });

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(resend, resendMsg);

  body.append(first, why, where, actions);
  welcome.replaceChildren(head, body);
  welcome.hidden = false;
  welcome.scrollIntoView({ behavior: "smooth", block: "start" });
}
