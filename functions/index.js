// Admin-only destructive operations.
//
// Everything else on this site is a static page talking straight to Firestore,
// with firestore.rules as the only authorization boundary. Deletion cannot work
// that way, for two reasons:
//
//  1. A Firebase Auth account can only be deleted by its owner from a browser.
//     Removing somebody else's login needs the Admin SDK.
//  2. storage.rules keys figure deletion to the uploader's uid and cannot read
//     Firestore, so there is no isAdmin() to appeal to. Rather than bake a list
//     of admin uids into the rules, figure deletion happens here, where the
//     Admin SDK ignores rules entirely.
//
// Because the Admin SDK ignores rules, EVERY function below must check the
// caller itself. A callable's request.auth is set by the platform from a
// verified ID token and is trustworthy; nothing the client says about itself is.

import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";

initializeApp();

const db = getFirestore();

// Paris, not the us-central1 default: participant names and email addresses
// should not round-trip to Iowa.
const REGION = "europe-west1";

/** Throw unless the caller is signed in and listed in admins/. */
async function requireAdmin(request) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const snap = await db.doc(`admins/${uid}`).get();
  if (!snap.exists) throw new HttpsError("permission-denied", "Organizers only.");
  return uid;
}

/** Delete a Storage object, treating "already gone" as success. */
async function deleteObject(path) {
  if (!path) return;
  try {
    await getStorage().bucket().file(path).delete();
  } catch (err) {
    if (err?.code !== 404) throw err;
  }
}

/**
 * Remove one abstract and everything that points at it.
 *
 * Shared by both callables, so deleting a participant and deleting a single
 * abstract cannot drift apart in what they clean up.
 */
async function purgeAbstract(abstractId) {
  const snap = await db.doc(`abstracts/${abstractId}`).get();
  const data = snap.data();

  const batch = db.batch();
  batch.delete(db.doc(`abstracts/${abstractId}`));
  batch.delete(db.doc(`abstracts_public/${abstractId}`));
  batch.delete(db.doc(`abstract_reviews/${abstractId}`));
  await batch.commit();

  // After the documents, so a Storage failure cannot leave an abstract pointing
  // at a figure that no longer exists. An orphaned object is invisible and
  // costs pennies; a broken image on the public list is not.
  await deleteObject(data?.figurePath);
  return Boolean(snap.exists);
}

export const deleteAbstractCompletely = onCall({ region: REGION }, async (request) => {
  const adminUid = await requireAdmin(request);
  const abstractId = String(request.data?.abstractId ?? "");
  if (!abstractId) throw new HttpsError("invalid-argument", "abstractId is required.");

  const existed = await purgeAbstract(abstractId);
  logger.info("abstract deleted", { abstractId, by: adminUid, existed });
  return { deleted: existed };
});

export const deleteParticipant = onCall({ region: REGION }, async (request) => {
  const adminUid = await requireAdmin(request);
  const uid = String(request.data?.uid ?? "");
  if (!uid) throw new HttpsError("invalid-argument", "uid is required.");

  // An organizer deleting their own account mid-session leaves the console in
  // an undefined state, and is almost always a mis-click.
  if (uid === adminUid) {
    throw new HttpsError("failed-precondition",
      "You cannot delete your own account from the admin console.");
  }

  // One mis-click must not be able to decapitate the organizing committee.
  if ((await db.doc(`admins/${uid}`).get()).exists) {
    throw new HttpsError("failed-precondition",
      "That participant is an organizer. Revoke their admin rights in Settings first.");
  }

  const owned = await db.collection("abstracts").where("ownerUid", "==", uid).get();
  for (const abstract of owned.docs) await purgeAbstract(abstract.id);

  const batch = db.batch();
  batch.delete(db.doc(`users/${uid}`));
  batch.delete(db.doc(`participants_public/${uid}`));
  await batch.commit();

  // Auth last. If this run dies part-way the account still exists, so the
  // participant is still listed in the console and the whole thing can simply
  // be retried. Deleting the login first would leave invisible orphaned data.
  try {
    await getAuth().deleteUser(uid);
  } catch (err) {
    if (err?.code !== "auth/user-not-found") throw err;
  }

  logger.info("participant deleted", { uid, by: adminUid, abstracts: owned.size });
  return { deleted: true, abstracts: owned.size };
});
