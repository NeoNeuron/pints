import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { firebaseConfig, isConfigured } from "./firebase-config.js";

export { isConfigured };

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

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
