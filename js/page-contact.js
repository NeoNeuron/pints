import { mountLayout, setAuthLink } from "./layout.js";
import { warnIfUnconfigured } from "./firebase.js";
import { onUser } from "./auth.js";
import { getProfile, sendContactMessage } from "./db.js";
import { validateContact } from "./contact-utils.mjs";
import { CONTACT_TOPICS, CONTACT_TOPIC_LABELS } from "./config.mjs";

mountLayout();

const form = document.getElementById("contact-form");
const msg = document.getElementById("msg");
const nameEl = document.getElementById("name");
const emailEl = document.getElementById("email");
const topicEl = document.getElementById("topic");
const messageEl = document.getElementById("message");
const sendBtn = document.getElementById("send");

// Built here rather than typed into the HTML so CONTACT_TOPICS stays the single
// source of truth: the validator, the rules and this list must agree, and two
// of the three already read the constant.
const placeholder = new Option("Choose one…", "");
placeholder.disabled = true;
placeholder.selected = true;
topicEl.append(placeholder,
  ...CONTACT_TOPICS.map((id) => new Option(CONTACT_TOPIC_LABELS[id], id)));

const say = (text, kind = "err") => {
  msg.className = `msg ${kind}`;
  msg.textContent = text;
};

// The uid of a signed-in sender, recorded on the message. Never required:
// somebody who cannot register — or cannot receive the confirmation mail — is
// exactly who needs this page most.
let authorUid = null;

if (warnIfUnconfigured(msg)) {
  form.hidden = true;
} else {
  onUser(async ({ user, isAdmin }) => {
    setAuthLink({ signedIn: Boolean(user), isAdmin });
    authorUid = user?.uid ?? null;
    if (!user) return;

    // Prefill, but never overwrite what somebody has already started typing:
    // this callback fires after Firebase resolves, which can be well after the
    // form is usable.
    if (!emailEl.value) emailEl.value = user.email ?? "";
    if (!nameEl.value) {
      // A failure here is not worth a message. The profile is a convenience,
      // and the field is one they can fill in themselves.
      const profile = await getProfile(user.uid).catch(() => null);
      if (!nameEl.value) nameEl.value = profile?.displayName ?? "";
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const input = {
      name: nameEl.value,
      email: emailEl.value,
      topic: topicEl.value,
      message: messageEl.value,
    };
    const { valid, errors } = validateContact(input);
    if (!valid) return say(errors.join(" "));

    sendBtn.disabled = true;
    try {
      await sendContactMessage({ ...input, authorUid });
    } catch (err) {
      sendBtn.disabled = false;
      console.error("[pints] sendContactMessage", err);
      // No "email us instead" fallback to offer: the committee's addresses are
      // deliberately not on this site (see the About page, which links to their
      // pages rather than listing addresses).
      return say("Your message could not be sent. Check your connection and try "
        + "again in a moment.");
    }

    // The form goes, so a second click cannot send the same message twice, and
    // the confirmation is the only thing left on screen.
    form.hidden = true;
    say(`Thank you — your message is on its way to the organizers. A reply will `
      + `come to ${input.email.trim()}.`, "ok");
  });
}
