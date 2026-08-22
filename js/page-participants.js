import { mountLayout, setAuthLink } from "./layout.js";
import { warnIfUnconfigured } from "./firebase.js";
import { onUser } from "./auth.js";
import { listPublicParticipants } from "./db.js";
import { sortParticipants } from "./participant-utils.mjs";

mountLayout();
onUser(({ user, isAdmin }) => setAuthLink({ signedIn: Boolean(user), isAdmin }));

const rows = document.getElementById("rows");
const count = document.getElementById("count");
const msg = document.getElementById("msg");

// Firestore's getDocs() has no built-in timeout: on a bad connection it can
// hang indefinitely with no feedback, which is what made this page look
// broken rather than slow. Race it against a timer so a stall surfaces as an
// error instead of a silent blank table.
const LOAD_TIMEOUT_MS = 10_000;
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), ms)),
  ]);
}

if (!warnIfUnconfigured(msg)) {
  msg.className = "msg";
  msg.textContent = "Loading participants…";

  try {
    const people = sortParticipants(await withTimeout(listPublicParticipants(), LOAD_TIMEOUT_MS));
    msg.textContent = "";
    count.textContent = people.length === 1
      ? "1 participant listed."
      : `${people.length} participants listed.`;

    for (const person of people) {
      const tr = document.createElement("tr");
      const name = document.createElement("td");
      // textContent, never innerHTML: these are user-supplied strings.
      name.textContent = person.displayName ?? "";
      const aff = document.createElement("td");
      aff.textContent = person.affiliation ?? "";
      tr.append(name, aff);
      rows.append(tr);
    }

    if (!people.length) {
      msg.className = "msg warn";
      msg.textContent = "Nobody has registered yet.";
    }
  } catch (err) {
    msg.className = "msg err";
    msg.textContent = err.message === "timed out"
      ? "This is taking too long. Check your connection and reload the page."
      : "Could not load the participant list.";
    console.error("[pints] participants", err);
  }
}
