// Public Firebase web config. NOT a secret: it identifies the project, it does
// not grant access. Authorization is enforced entirely by firestore.rules.
//
// GitHub's secret scanner flags apiKey as a "Google API Key". Do not try to hide
// it: the browser must receive it to reach Firebase, so it is public in the
// served JavaScript wherever it is stored, and moving it into a build-time
// secret would add a build step for no security gain.
//
// The exposure worth mitigating is quota abuse, not data access — see the
// "web API key" section of README.md for the two free fixes (HTTP referrer
// restrictions on the key, and App Check).

export const firebaseConfig = {
  apiKey: "AIzaSyC1ew1Nzgog929MIcMAPzatWTHJqiR0M9Q",
  authDomain: "pints-conference.firebaseapp.com",
  projectId: "pints-conference",
  storageBucket: "pints-conference.firebasestorage.app",
  messagingSenderId: "616721017872",
  appId: "1:616721017872:web:e0f65bd02332930f2fae95"
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
