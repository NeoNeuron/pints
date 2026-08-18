import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { db } from "./firebase.js";
import { CURRENT_EDITION } from "./config.mjs";

const snapData = (snap) => ({ id: snap.id, ...snap.data() });

export async function getProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snapData(snap) : null;
}

/** The public half of a profile. One place builds it, so the two cannot drift. */
const publicProjection = (displayName, affiliation) => ({
  displayName: String(displayName ?? "").trim(),
  affiliation: String(affiliation ?? "").trim(),
  edition: CURRENT_EDITION,
  updatedAt: serverTimestamp(),
});

/**
 * Save the profile, and — unless told not to — its public projection, in a
 * single batch.
 *
 * Firestore rules cannot expose only some fields of users/{uid} — a read is
 * all-or-nothing — so the public name list is a separate collection written
 * here. Registering IS the consent; there is no opt-out to reconcile. What
 * `publish` gates is not consent but *readiness*: an address nobody has proved
 * they own should not put a name on a public page, so registration passes
 * false and the account page publishes once verification comes back true.
 */
export async function saveProfile(
  uid,
  { email, displayName, affiliation },
  { publish = true } = {},
) {
  const clean = {
    email,
    displayName: displayName.trim(),
    affiliation: (affiliation ?? "").trim(),
    edition: CURRENT_EDITION,
    updatedAt: serverTimestamp(),
  };
  if (!publish) {
    await setDoc(doc(db, "users", uid), clean, { merge: true });
    return;
  }
  const batch = writeBatch(db);
  batch.set(doc(db, "users", uid), clean, { merge: true });
  batch.set(doc(db, "participants_public", uid),
    publicProjection(clean.displayName, clean.affiliation));
  await batch.commit();
}

/**
 * Put someone on the public participant list.
 *
 * Idempotent, and called on every account-page load once the email is verified,
 * so a registration that was interrupted between the two writes heals itself
 * the next time the person opens the page.
 */
export const publishParticipant = (uid, { displayName, affiliation }) =>
  setDoc(doc(db, "participants_public", uid), publicProjection(displayName, affiliation));

export async function listPublicParticipants() {
  const q = query(collection(db, "participants_public"), where("edition", "==", CURRENT_EDITION));
  const snap = await getDocs(q);
  return snap.docs.map(snapData);
}

export async function getSiteConfig() {
  const snap = await getDoc(doc(db, "config", "site"));
  return snap.exists() ? snap.data() : null;
}

// ---------------------------------------------------------------- abstracts

/**
 * One abstract per participant, keyed on their uid — so this is a direct get,
 * not a query. That is deliberate: firestore.rules grants `list` on abstracts to
 * organizers only, and a get needs no index, no edition filter, and no way to
 * see anybody else's submission.
 *
 * Returns null when they have not submitted, and also when the abstract belongs
 * to a previous edition: next year is a one-line change to CURRENT_EDITION, and
 * the old submission must not reappear in this year's form.
 */
export async function getMyAbstract(uid) {
  const snap = await getDoc(doc(db, "abstracts", uid));
  if (!snap.exists()) return null;
  const abstract = snapData(snap);
  return abstract.edition === CURRENT_EDITION ? abstract : null;
}

/**
 * Create or replace one abstract.
 *
 * setDoc without merge is deliberate: the rules validate the whole document on
 * every write, so a full replace is simpler than reasoning about partial
 * updates. Resubmitting after a rejection resets status to "submitted", which
 * the rules permit for any status except "accepted".
 *
 * `ownerUid` is the SUBMITTER, never necessarily the person saving: an organizer
 * fixing a typo in somebody else's abstract must not take it over. `status`
 * likewise has to be carried through, or that same fix would quietly un-accept
 * an accepted abstract.
 *
 * `republish` carries the public projection's type and poster number when an
 * organizer edits an already-accepted abstract, so both copies are rewritten in
 * one batch. Without it abstracts_public would keep serving the old text, which
 * is exactly the staleness the acceptance freeze exists to prevent.
 */
export async function saveAbstract(
  id,
  ownerUid,
  {
    title, affiliations, authors, body, topic, talkConsidered,
    figureUrl, figurePath, figureCaption,
  },
  { status = "submitted", createdAt = null, republish = null } = {},
) {
  const record = {
    ownerUid,
    edition: CURRENT_EDITION,
    title: title.trim(),
    affiliations,
    authors,
    body: body.trim(),
    topic,
    talkConsidered: Boolean(talkConsidered),
    figureUrl: figureUrl ?? null,
    figurePath: figurePath ?? null,
    figureCaption: (figureCaption ?? "").trim(),
    status,
    // Preserved rather than reset: revising a rejected abstract in November did
    // not make it a submission from November.
    createdAt: createdAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (!republish) {
    await setDoc(doc(db, "abstracts", id), record);
    return;
  }

  const batch = writeBatch(db);
  batch.set(doc(db, "abstracts", id), record);
  batch.set(doc(db, "abstracts_public", id),
    publicAbstract(record, {
      type: republish.type,
      posterNumber: republish.posterNumber,
      acceptedAt: republish.acceptedAt,
    }));
  await batch.commit();
}

/**
 * The public projection of an abstract. One builder, used by both routes that
 * write abstracts_public, so an organizer's edit and an acceptance cannot
 * disagree about what the public list holds.
 *
 * `status`, `ownerUid`, `figurePath` and `talkConsidered` are deliberately left
 * out: they are review material, not programme material.
 */
const publicAbstract = (abstract, { type, posterNumber, acceptedAt = null }) => ({
  title: abstract.title,
  affiliations: abstract.affiliations ?? [],
  authors: abstract.authors ?? [],
  body: abstract.body,
  topic: abstract.topic ?? null,
  figureUrl: abstract.figureUrl ?? null,
  figureCaption: abstract.figureCaption ?? "",
  type,
  posterNumber: type === "poster" ? posterNumber : null,
  edition: CURRENT_EDITION,
  acceptedAt: acceptedAt ?? serverTimestamp(),
});

export const deleteAbstract = (id) => deleteDoc(doc(db, "abstracts", id));

export async function listAbstracts() {
  const q = query(collection(db, "abstracts"), where("edition", "==", CURRENT_EDITION));
  return (await getDocs(q)).docs.map(snapData);
}

/**
 * One published abstract, for a shared link.
 *
 * A direct get rather than a filter over listPublicAbstracts(): a link that
 * lands on one abstract should cost one read, not the whole collection. Returns
 * null both when the id is unknown and when it belongs to another edition, so a
 * link shared last year does not surface the wrong meeting's poster.
 */
export async function getPublicAbstract(id) {
  const snap = await getDoc(doc(db, "abstracts_public", id));
  if (!snap.exists()) return null;
  const abstract = snapData(snap);
  return abstract.edition === CURRENT_EDITION ? abstract : null;
}

export async function listPublicAbstracts() {
  const q = query(collection(db, "abstracts_public"), where("edition", "==", CURRENT_EDITION));
  return (await getDocs(q)).docs.map(snapData);
}

/**
 * Every review on every abstract, in one read.
 *
 * The console shows the whole committee's scores on every card and exports them
 * as a matrix, so fetching them per abstract would be one round trip per card
 * for data that is always wanted together. Admin-only, per the rules.
 */
export async function listReviews() {
  const snap = await getDocs(collection(db, "abstract_reviews"));
  return new Map(snap.docs.map((d) => [d.id, d.data()]));
}

/**
 * Save one organizer's score and note.
 *
 * A merge into a nested map, NOT a whole-document set: each organizer owns one
 * slot of `reviews`, and two of them reviewing the same abstract at the same
 * time must not overwrite each other. A full set would make the last save win
 * and silently discard the other's opinion.
 */
export const saveMyReview = (abstractId, reviewerUid, { score, note }) =>
  setDoc(doc(db, "abstract_reviews", abstractId), {
    reviews: {
      [reviewerUid]: {
        // null rather than absent, so clearing a score is a real edit the merge
        // will carry through instead of leaving the old one in place.
        score: Number.isInteger(score) ? score : null,
        note: String(note ?? ""),
        at: serverTimestamp(),
      },
    },
  }, { merge: true });

/** Record who accepted or rejected an abstract, without touching anyone's review. */
export const recordDecision = (abstractId, decidedBy) =>
  setDoc(doc(db, "abstract_reviews", abstractId), {
    decidedBy,
    decidedAt: serverTimestamp(),
  }, { merge: true });

export const setAbstractStatus = (id, status) =>
  updateDoc(doc(db, "abstracts", id), { status, updatedAt: serverTimestamp() });

/**
 * Accept: flip the private status and write the public projection together.
 *
 * `type` is the organizers' decision, not the submitter's — everything is
 * submitted as a poster and the committee promotes some of them to talks.
 *
 * `acceptedAt` is carried by the caller when this is a re-publish rather than a
 * first acceptance. Without it the timestamp restamped itself every time an
 * organizer changed a board number, and "when was this accepted" became "when
 * did somebody last touch it".
 */
export async function publishAbstract(id, abstract, { type, posterNumber, acceptedAt = null }) {
  const batch = writeBatch(db);
  batch.update(doc(db, "abstracts", id), { status: "accepted", updatedAt: serverTimestamp() });
  batch.set(doc(db, "abstracts_public", id),
    publicAbstract(abstract, { type, posterNumber, acceptedAt }));
  await batch.commit();
}

/** Withdraw a published abstract: remove the public copy and mark it withdrawn. */
export async function unpublishAbstract(id) {
  const batch = writeBatch(db);
  batch.update(doc(db, "abstracts", id), { status: "withdrawn", updatedAt: serverTimestamp() });
  batch.delete(doc(db, "abstracts_public", id));
  await batch.commit();
}

export async function listUsers() {
  const q = query(collection(db, "users"), where("edition", "==", CURRENT_EDITION));
  return (await getDocs(q)).docs.map(snapData);
}

// -------------------------------------------------------------------- pages

/**
 * Editable page copy. Not edition-scoped: the venue and about text carry from
 * one year to the next, and an organizer who edits a page means to edit the
 * page, not this year's copy of it.
 */
export async function getPage(slug) {
  const snap = await getDoc(doc(db, "pages", slug));
  return snap.exists() ? snap.data() : null;
}

export const savePage = (slug, markdown, adminUid) =>
  setDoc(doc(db, "pages", slug), {
    markdown,
    updatedAt: serverTimestamp(),
    updatedBy: adminUid,
  });

// ----------------------------------------------------------------- schedule

export async function listSchedule() {
  const q = query(collection(db, "schedule"), where("edition", "==", CURRENT_EDITION));
  return (await getDocs(q)).docs.map(snapData);
}

/** `id` null creates; otherwise replaces. Resolves to the document id. */
export async function saveScheduleItem(id, data) {
  const payload = { ...data, edition: CURRENT_EDITION };
  const ref = doc(db, "schedule", id ?? doc(collection(db, "schedule")).id);
  await setDoc(ref, payload);
  return ref.id;
}

export const deleteScheduleItem = (id) => deleteDoc(doc(db, "schedule", id));

// ----------------------------------------------------------------- settings

/**
 * Partial update of config/site. Undefined keys are stripped, because the
 * settings tab saves the meeting date and the submission window independently
 * and Firestore rejects an undefined field value outright.
 */
export function saveSiteConfig(patch) {
  const clean = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined));
  return setDoc(doc(db, "config", "site"),
    { ...clean, edition: CURRENT_EDITION }, { merge: true });
}

export const addAdmin = (uid, email, addedBy) =>
  setDoc(doc(db, "admins", uid), { email, addedBy, addedAt: serverTimestamp() });

/**
 * The uids of every organizer. Admin-only, per the rules.
 *
 * The participants tab needs it to refuse to offer a delete button for an
 * organizer. deleteParticipant refuses server-side too — this is so the console
 * does not present an action that is going to be rejected.
 */
export async function listAdminUids() {
  const snap = await getDocs(collection(db, "admins"));
  return new Set(snap.docs.map((d) => d.id));
}

/** Every organizer, with the email recorded when they were added. Admin-only. */
export async function listAdmins() {
  const snap = await getDocs(collection(db, "admins"));
  return snap.docs.map(snapData);
}

// ------------------------------------------------------------------ gallery

/**
 * Photographs of previous editions, one document per edition.
 *
 * Not edition-scoped in the CURRENT_EDITION sense: the whole point is the years
 * that are not this one. The `year` field carries which is which.
 */
export async function listGallery() {
  const snap = await getDocs(collection(db, "gallery"));
  return snap.docs.map(snapData);
}

export async function getGalleryYear(year) {
  const snap = await getDoc(doc(db, "gallery", String(year)));
  return snap.exists() ? snapData(snap) : null;
}

/**
 * Save the captions an organizer typed, leaving everything the sync wrote alone.
 *
 * A merge would not do: `photos` is an array, and a merged array is replaced
 * wholesale anyway, so the caller passes the full list it just edited.
 */
export const saveGalleryPhotos = (year, folderUrl, photos, adminUid) =>
  setDoc(doc(db, "gallery", String(year)), {
    year: Number(year),
    folderUrl: folderUrl ?? "",
    photos,
    syncedAt: serverTimestamp(),
    syncedBy: adminUid,
  });

export const deleteGalleryYear = (year) => deleteDoc(doc(db, "gallery", String(year)));
