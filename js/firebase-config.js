// Public Firebase web config. NOT a secret: it identifies the project, it does
// not grant access. Authorization is enforced entirely by firestore.rules.
//
// TO FILL IN: Firebase console -> Project settings -> General -> Your apps ->
// Web app, then copy the firebaseConfig object over the placeholders below.
// See README.md for the full setup checklist, including the authorized-domains
// step that sign-in fails without.

export const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME.firebaseapp.com",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME.firebasestorage.app",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME",
};

/**
 * False until the placeholders above are replaced.
 *
 * Every page that talks to Firebase checks this first and shows a plain
 * "not configured yet" notice instead of failing with an opaque SDK error.
 * That is what lets the accounts work be deployed before the Firebase project
 * exists, without breaking the live site.
 */
export const isConfigured = !Object.values(firebaseConfig)
  .some((value) => String(value).includes("REPLACE_ME"));
