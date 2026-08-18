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
// The participant backfill is here for the same reason: it writes on behalf of
// somebody who is signed in nowhere, which only the Admin SDK can do.
//
// The test for whether something belongs in this file is narrow — does it need
// to bypass the rules, or hold a secret the browser must not? Ordinary reads and
// writes belong in firestore.rules, or the site stops being a static site.
//
// NOT here, for now: syncDropboxGallery, the archive photo sync. It is the one
// function that needs the second justification — a Dropbox token — and it
// cannot deploy until DROPBOX_APP_KEY, DROPBOX_APP_SECRET and
// DROPBOX_REFRESH_TOKEN exist in Secret Manager. An undeployable function fails
// the whole `firebase deploy --only functions`, so it was taken out to let the
// rest ship. Restore it with `git revert` of the commit that removed it, once
// the secrets are set; the browser half is untouched and still waiting for it.
//
// Because the Admin SDK ignores rules, EVERY function below must check the
// caller itself. A callable's request.auth is set by the platform from a
// verified ID token and is trustworthy; nothing the client says about itself is.

import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
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

// ------------------------------------------------------ the listing backfill

/**
 * Put verified participants on the public list even if they never load a page.
 *
 * account.html publishes the moment a fresh token says the address is confirmed,
 * and for most people that is instant — the verification link lands there. Two
 * routes miss it entirely:
 *
 *  - opening the link on a phone, or any device where they are not signed in.
 *    The page redirects to sign-in and the write never happens, so their name
 *    appears only after they next log in somewhere.
 *  - submitting an abstract without registering. Those people are sent a
 *    "set your password" mail rather than a verification one, so they never
 *    pass through account.html at all — and completing a password reset is
 *    exactly what marks their address verified.
 *
 * Neither can be fixed in the browser: participants_public may be written only
 * by its owner or an organizer, and the person in question is signed in
 * nowhere. The Admin SDK ignores rules, which is what makes this function the
 * place for it — the same admission test as the deletes above.
 *
 * Every five minutes rather than every minute. The client-side path already
 * covers the common case immediately, so this is a safety net, and a net that
 * sweeps the whole participant list twelve times an hour is a bill for nothing.
 */
export const backfillParticipants = onSchedule(
  { region: REGION, schedule: "every 5 minutes" },
  async () => {
    // The edition is read, not hardcoded: js/config.mjs is the single source of
    // truth for it and this package cannot import from the site. The settings
    // tab writes it here on every save.
    const edition = (await db.doc("config/site").get()).data()?.edition;
    if (!edition) {
      logger.error("config/site has no edition; refusing to guess", {});
      return;
    }

    // One pass over who is already listed, so the common case — nobody new —
    // costs one query and no writes.
    const listed = new Set((await db.collection("participants_public").get()).docs
      .map((doc) => doc.id));

    let published = 0;
    let scanned = 0;
    let pageToken;
    do {
      const page = await getAuth().listUsers(1000, pageToken);
      scanned += page.users.length;
      for (const user of page.users) {
        if (!user.emailVerified || listed.has(user.uid)) continue;

        const profile = (await db.doc(`users/${user.uid}`).get()).data();
        // No profile means they have an account but never gave a name, and a
        // different edition means they registered for a previous year — neither
        // belongs on this year's list.
        if (!profile?.displayName || profile.edition !== edition) continue;

        try {
          // create(), not set(): it fails if the document is already there, so
          // "never overwrite" is enforced by the database rather than by the
          // freshness of the set read above. An organizer may have corrected
          // this person's name, and a race with the client's own publish is
          // entirely possible.
          await db.doc(`participants_public/${user.uid}`).create({
            displayName: profile.displayName,
            affiliation: profile.affiliation ?? "",
            edition,
            updatedAt: FieldValue.serverTimestamp(),
          });
          published += 1;
        } catch (err) {
          // 6 is ALREADY_EXISTS: somebody else won the race, which is the
          // outcome we wanted anyway.
          if (err?.code !== 6) throw err;
        }
      }
      pageToken = page.pageToken;
    } while (pageToken);

    // Debug on every sweep, info only when it did something. A periodic job that
    // is silent while idle is indistinguishable from one that has stopped
    // firing, and "is the backfill alive?" has to be answerable without adding
    // a test participant to see whether they appear.
    logger.debug("participant sweep", { listed: listed.size, scanned, published });
    if (published) logger.info("participants backfilled", { published });
  },
);
