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

if (!warnIfUnconfigured(msg)) {
  try {
    const people = sortParticipants(await listPublicParticipants());
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
      msg.textContent = "No one has opted in to the public list yet.";
    }
  } catch (err) {
    msg.className = "msg err";
    msg.textContent = "Could not load the participant list.";
    console.error("[pints] participants", err);
  }
}
