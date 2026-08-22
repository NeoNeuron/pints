import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { connectAuthEmulator, getAuth } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { connectFirestoreEmulator, getFirestore } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { connectStorageEmulator, getStorage } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";
import { firebaseConfig, isConfigured } from "./firebase-config.js";

export { isConfigured };

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

/**
 * A second Firestore client, deliberately never paired with getAuth().
 *
 * Firestore's first request on `db` waits for Auth to resolve its initial
 * state, even for a query firestore.rules grants to `if true` — because the
 * SDK does not know in advance whether a request needs a token. For anyone
 * with a persisted session that adds a full identitytoolkit round trip in
 * front of every public read, every page load. Since `publicApp` never calls
 * getAuth(), Firestore on it has no credentials provider to wait on and fires
 * immediately. Use it in db.js only for reads firestore.rules marks
 * `allow read: if true` — anything requiring request.auth must stay on `db`.
 */
export const publicApp = initializeApp(firebaseConfig, "public");
export const publicDb = getFirestore(publicApp);

/**
 * Point the whole SDK at `firebase emulators:start` when asked.
 *
 * Some flows cannot be rehearsed against production without leaving real
 * accounts and real abstracts behind — signing up, submitting, deleting — so
 * there has to be somewhere to rehearse them. Guarded exactly like the one in
 * js/functions.js: localhost AND an explicit `?emulator`, so the deployed site
 * can never be pointed at a laptop, and an ordinary local page load still talks
 * to the real project.
 *
 * Ports match firebase.json. Run `npm run emulators`, then open
 * http://127.0.0.1:4173/submit.html?emulator
 */
export const usingEmulators = ["localhost", "127.0.0.1"].includes(location.hostname)
  && new URLSearchParams(location.search).has("emulator");

if (usingEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFirestoreEmulator(publicDb, "127.0.0.1", 8080);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
  console.info("[pints] using the local Firebase emulators");
}

/**
 * Render a "not configured yet" notice into `host` and return true, when the
 * Firebase project has not been set up. Callers bail out on a true return.
 */
export function warnIfUnconfigured(host) {
  if (isConfigured) return false;
  if (host) {
    host.className = "msg warn";
    host.textContent =
      "Accounts are not switched on yet. The Firebase project for this site " +
      "still needs to be created and its config added to js/firebase-config.js.";
  }
  console.warn("[pints] Firebase is not configured; see js/firebase-config.js");
  return true;
}
