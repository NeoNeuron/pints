import {
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db, isConfigured } from "./firebase.js";

const persistenceFor = (remember) =>
  setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);

export async function signUp(email, password, remember) {
  await persistenceFor(remember);
  const { user } = await createUserWithEmailAndPassword(auth, email, password);
  await sendEmailVerification(user);
  return user;
}

export async function signIn(email, password, remember) {
  await persistenceFor(remember);
  const { user } = await signInWithEmailAndPassword(auth, email, password);
  return user;
}

export const signOutNow = () => signOut(auth);
export const sendReset = (email) => sendPasswordResetEmail(auth, email);
export const sendVerification = (user) => sendEmailVerification(user);

/**
 * Pull a fresh ID token so request.auth.token.email_verified reflects reality.
 *
 * Clicking the verification link does NOT update the token already held by this
 * tab: it stays false for up to an hour. Without this, someone who verifies and
 * immediately submits gets a PERMISSION_DENIED that "fixes itself" later.
 */
export async function refreshVerification(user) {
  if (!user) return false;
  await user.reload();
  await user.getIdToken(true);
  return user.emailVerified;
}

export async function checkIsAdmin(uid) {
  if (!uid) return false;
  try {
    const snap = await getDoc(doc(db, "admins", uid));
    return snap.exists();
  } catch {
    // Rules allow reading only your own admins document, so a denial here just
    // means "not an admin". Never treat it as an error worth surfacing.
    return false;
  }
}

/** Subscribe to auth state, resolving admin status before each callback. */
export function onUser(callback) {
  if (!isConfigured) {
    callback({ user: null, isAdmin: false });
    return () => {};
  }
  return onAuthStateChanged(auth, async (user) => {
    callback({ user, isAdmin: user ? await checkIsAdmin(user.uid) : false });
  });
}

/** Resolve with the signed-in user, or redirect to the sign-in page. */
export function requireUser() {
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, (user) => {
      stop();
      if (user) resolve(user);
      else location.replace("login.html");
    });
  });
}

const MESSAGES = {
  "auth/email-already-in-use": "That email already has an account. Try signing in instead.",
  "auth/invalid-email": "That does not look like a valid email address.",
  "auth/missing-password": "Enter a password.",
  "auth/weak-password": "Passwords must be at least 6 characters.",
  "auth/invalid-credential": "Wrong email or password.",
  "auth/wrong-password": "Wrong email or password.",
  "auth/user-not-found": "Wrong email or password.",
  "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
  "auth/unauthorized-domain":
    "This site is not an authorized domain for the Firebase project. An organizer " +
    "needs to add it under Authentication → Settings → Authorized domains.",
  "auth/network-request-failed": "Network error. Check your connection and try again.",
  "auth/operation-not-allowed":
    "Email/password sign-in is not enabled for this Firebase project yet.",
};

export const friendlyAuthError = (err) =>
  MESSAGES[err?.code] ?? `Something went wrong (${err?.code ?? "unknown"}).`;
