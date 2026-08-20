import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";
import { app } from "./firebase.js";

// Must match the region the callables are deployed to (functions/index.js).
// getFunctions() defaults to us-central1, and a mismatch fails as a CORS error
// rather than anything that names the real problem.
const REGION = "europe-west1";

export const functions = getFunctions(app, REGION);

// Local development against `firebase emulators:start`. Guarded on hostname so
// the deployed site can never be pointed at a developer's laptop.
if (["localhost", "127.0.0.1"].includes(location.hostname)
  && new URLSearchParams(location.search).has("emulator")) {
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  console.info("[pints] using the local functions emulator");
}

/**
 * Turn a callable's failure into something an organizer can act on.
 *
 * The server throws HttpsError with a message written for a human — "revoke
 * their admin rights first" — and that message is worth far more than a generic
 * apology. Anything else is a bug or a network problem, so it gets the generic
 * one and the details go to the console.
 */
function explain(err, fallback) {
  const code = err?.code ?? "";
  if (code.endsWith("permission-denied")) return "Organizers only.";
  if (code.endsWith("unauthenticated")) return "Your session has expired. Sign in again.";
  if (code.endsWith("failed-precondition") || code.endsWith("invalid-argument")) {
    return err.message;
  }
  if (code.endsWith("internal") || code.endsWith("unavailable")) {
    return `${fallback} The service may not be deployed yet — see “Deploying the `
      + `callables” in the README.`;
  }
  return fallback;
}

async function call(name, payload, fallback) {
  try {
    return (await httpsCallable(functions, name)(payload)).data;
  } catch (err) {
    console.error(`[pints] ${name}`, err);
    const friendly = new Error(explain(err, fallback));
    friendly.userFacing = true;
    throw friendly;
  }
}

/** Delete an abstract, its published copy, its reviewer note and its figure. */
export const deleteAbstractCompletely = (abstractId) =>
  call("deleteAbstractCompletely", { abstractId }, "Could not delete the abstract.");

/** Delete a participant: their abstracts, their profile, and their login. */
export const deleteParticipant = (uid) =>
  call("deleteParticipant", { uid }, "Could not delete the participant.");

/** Uids of registered participants Firebase Auth has not marked email-confirmed. */
export const listUnverifiedParticipants = () =>
  call("listUnverifiedParticipants", {}, "Could not check confirmation status.");

/** Mark a participant's email confirmed, for an address that never verified. */
export const verifyParticipantEmail = (uid) =>
  call("verifyParticipantEmail", { uid }, "Could not confirm that address.");

/**
 * Re-read a Dropbox folder and cache its photographs in gallery/{year}.
 *
 * A shared folder cannot be listed from a browser: every Dropbox listing
 * endpoint needs an Authorization header, and a static site has nowhere safe to
 * keep one. The token lives in the callable, and the result lands in Firestore
 * so the public archive page reads a document rather than calling this.
 */
export const syncDropboxGallery = (year, folderUrl) =>
  call("syncDropboxGallery", { year, folderUrl }, "Could not sync the photos from Dropbox.");
