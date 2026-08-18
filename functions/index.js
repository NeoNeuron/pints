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
// The archive gallery sync is here for a related but distinct reason: it needs
// a Dropbox credential. A shared folder cannot be listed without one, the site
// is a static page with nowhere safe to keep it, and the last time a token lived
// in the browser the organizers asked for the feature to be removed. So the
// token stays server-side, the result is cached in Firestore, and visitors never
// call this at all.
//
// The test for whether something belongs in this file is narrow — does it need
// to bypass the rules, or hold a secret the browser must not? Ordinary reads and
// writes belong in firestore.rules, or the site stops being a static site.
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
import { defineSecret } from "firebase-functions/params";
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

// --------------------------------------------------------------- the archive

// Set with `firebase functions:secrets:set DROPBOX_APP_KEY` (and the other two).
// A refresh token rather than an access token: Dropbox access tokens expire
// after four hours, which would mean re-pasting one before every sync.
const DROPBOX_APP_KEY = defineSecret("DROPBOX_APP_KEY");
const DROPBOX_APP_SECRET = defineSecret("DROPBOX_APP_SECRET");
const DROPBOX_REFRESH_TOKEN = defineSecret("DROPBOX_REFRESH_TOKEN");

const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif)$/i;

/** Trade the long-lived refresh token for an access token good for this call. */
async function dropboxAccessToken() {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: DROPBOX_REFRESH_TOKEN.value(),
  });
  const auth = Buffer.from(
    `${DROPBOX_APP_KEY.value()}:${DROPBOX_APP_SECRET.value()}`).toString("base64");

  const res = await fetch("https://api.dropbox.com/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) {
    logger.error("dropbox token exchange failed", { status: res.status, body: await res.text() });
    throw new HttpsError("failed-precondition",
      "Dropbox rejected the stored credentials. An organizer needs to re-authorize the app.");
  }
  return (await res.json()).access_token;
}

async function dropbox(endpoint, token, payload) {
  const res = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    logger.error("dropbox call failed", { endpoint, status: res.status, body: text });
    // 409 is Dropbox's "your request was well-formed but wrong" — almost always
    // a link that is not shared, or not a folder. Worth saying out loud.
    if (res.status === 409) {
      throw new HttpsError("failed-precondition",
        "Dropbox could not open that link. Check it is a shared folder link with "
        + "\u201cAnyone with the link\u201d access.");
    }
    throw new HttpsError("internal", "Dropbox refused the request.");
  }
  return res.json();
}

/**
 * A direct-image URL for one file inside a shared folder.
 *
 * `?raw=1` is the difference between an image and Dropbox's HTML preview page:
 * without it an <img> tag loads a web page and shows a broken icon. The metadata
 * call is what turns "a file inside that folder" into its own shared link.
 */
async function directUrl(token, folderUrl, name) {
  const meta = await dropbox("sharing/get_shared_link_metadata", token, {
    url: folderUrl,
    path: `/${name}`,
  });
  const raw = String(meta?.url ?? "");
  if (!raw) return null;
  // Parsed rather than string-spliced: the link may arrive with dl=0, with
  // rlkey and no dl, or with no query at all, and hand-rolled rewriting of all
  // three is exactly the kind of thing that silently produces "...jpg&raw=1".
  const url = new URL(raw);
  url.searchParams.delete("dl");
  url.searchParams.set("raw", "1");
  return url.href;
}

/**
 * Cache a Dropbox folder's photographs into gallery/{year}.
 *
 * Captions are kept by file name across syncs — an organizer who writes twenty
 * captions and then adds one photograph must not lose the twenty.
 */
export const syncDropboxGallery = onCall(
  { region: REGION, secrets: [DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN] },
  async (request) => {
    const adminUid = await requireAdmin(request);
    const year = Number(request.data?.year);
    const folderUrl = String(request.data?.folderUrl ?? "").trim();
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new HttpsError("invalid-argument", "A four-digit year is required.");
    }
    if (!/^https:\/\/(www\.)?dropbox\.com\//.test(folderUrl)) {
      throw new HttpsError("invalid-argument", "That does not look like a Dropbox link.");
    }

    const token = await dropboxAccessToken();

    const names = [];
    let page = await dropbox("sharing/list_shared_link_files", token, { url: folderUrl });
    for (;;) {
      for (const entry of page.entries ?? []) {
        if (entry[".tag"] === "file" && IMAGE_EXTENSIONS.test(entry.name ?? "")) {
          names.push(entry.name);
        }
      }
      if (!page.has_more) break;
      page = await dropbox("sharing/list_shared_link_files/continue", token,
        { cursor: page.cursor });
    }

    // A hard cap, matching firestore.rules. Somebody pointing this at a folder
    // of a thousand photographs should be told, not silently truncated at a
    // number the rules happen to enforce.
    if (names.length > 200) {
      throw new HttpsError("failed-precondition",
        `That folder holds ${names.length} images; the gallery takes at most 200.`);
    }

    names.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

    const existing = (await db.doc(`gallery/${year}`).get()).data() ?? {};
    const captions = new Map(
      (existing.photos ?? []).map((photo) => [photo?.name, photo?.caption ?? ""]));

    const photos = [];
    for (const name of names) {
      const url = await directUrl(token, folderUrl, name);
      if (url) photos.push({ name, url, caption: captions.get(name) ?? "" });
    }

    await db.doc(`gallery/${year}`).set({
      year,
      folderUrl,
      photos,
      syncedAt: new Date(),
      syncedBy: adminUid,
    });

    logger.info("gallery synced", { year, photos: photos.length, by: adminUid });
    return { year, photos: photos.length, skipped: names.length - photos.length };
  },
);

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
    let pageToken;
    do {
      const page = await getAuth().listUsers(1000, pageToken);
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

    if (published) logger.info("participants backfilled", { published });
  },
);
