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

/**
 * Save the profile and its public projection in a single batch.
 *
 * Firestore rules cannot expose only some fields of users/{uid} — a read is
 * all-or-nothing — so the public name list is a separate collection written
 * here. Registering IS the consent: there is no opt-out any more, so this
 * always writes participants_public/{uid} rather than reconciling a checkbox.
 */
export async function saveProfile(uid, { email, displayName, affiliation }) {
  const batch = writeBatch(db);
  const clean = {
    email,
    displayName: displayName.trim(),
    affiliation: (affiliation ?? "").trim(),
    edition: CURRENT_EDITION,
    updatedAt: serverTimestamp(),
  };
  batch.set(doc(db, "users", uid), clean, { merge: true });
  batch.set(doc(db, "participants_public", uid), {
    displayName: clean.displayName,
    affiliation: clean.affiliation,
    edition: CURRENT_EDITION,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}

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
 * A participant may submit as many abstracts as they like, so the document id
 * is an auto-id and ownership lives in the ownerUid field.
 *
 * The `edition` filter is applied client-side on purpose: `ownerUid` alone is a
 * single-equality query served by the automatic index, and firestore.rules
 * grants `list` only when the query filters on ownerUid.
 */
export async function listMyAbstracts(uid) {
  const q = query(collection(db, "abstracts"), where("ownerUid", "==", uid));
  return (await getDocs(q)).docs
    .map(snapData)
    .filter((a) => a.edition === CURRENT_EDITION);
}

/**
 * Mint the id before the document exists, so a figure can be uploaded to a
 * stable Storage path during a first submission and create/update stay the
 * same single setDoc call.
 */
export const newAbstractId = () => doc(collection(db, "abstracts")).id;

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
 * likewise has to be carried through, or that same typo fix would quietly
 * un-accept an accepted abstract. Both used to be implicit and both were wrong
 * the moment the admin console gained an edit button.
 *
 * When an organizer edits an already-accepted abstract, `republish` carries the
 * public projection's `type` and `posterNumber` so the two are rewritten in one
 * batch. Without it abstracts_public would keep serving the old text, which is
 * exactly the staleness the acceptance freeze exists to prevent.
 */
export async function saveAbstract(
  id,
  ownerUid,
  { title, affiliations, authors, body, topic, talkConsidered, figureUrl, figurePath },
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
    status,
    // Preserved rather than reset: an abstract submitted in September did not
    // become a new submission because somebody fixed its title in November.
    createdAt: createdAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (!republish) {
    await setDoc(doc(db, "abstracts", id), record);
    return;
  }

  const batch = writeBatch(db);
  batch.set(doc(db, "abstracts", id), record);
  batch.set(doc(db, "abstracts_public", id), {
    title: record.title,
    affiliations: record.affiliations ?? [],
    authors: record.authors ?? [],
    body: record.body,
    topic: record.topic ?? null,
    figureUrl: record.figureUrl,
    type: republish.type,
    posterNumber: republish.type === "poster" ? republish.posterNumber : null,
    edition: CURRENT_EDITION,
    acceptedAt: republish.acceptedAt ?? serverTimestamp(),
  });
  await batch.commit();
}

/** One abstract by id, for the admin console's edit form. */
export async function getAbstract(id) {
  const snap = await getDoc(doc(db, "abstracts", id));
  return snap.exists() ? snapData(snap) : null;
}

export const deleteAbstract = (id) => deleteDoc(doc(db, "abstracts", id));

export async function listAbstracts() {
  const q = query(collection(db, "abstracts"), where("edition", "==", CURRENT_EDITION));
  return (await getDocs(q)).docs.map(snapData);
}

export async function listPublicAbstracts() {
  const q = query(collection(db, "abstracts_public"), where("edition", "==", CURRENT_EDITION));
  return (await getDocs(q)).docs.map(snapData);
}

export async function getReview(id) {
  const snap = await getDoc(doc(db, "abstract_reviews", id));
  return snap.exists() ? snap.data() : null;
}

export async function saveReview(id, { note, decidedBy }) {
  await setDoc(doc(db, "abstract_reviews", id), {
    note: note ?? "",
    decidedBy,
    decidedAt: serverTimestamp(),
  }, { merge: true });
}

export const setAbstractStatus = (id, status) =>
  updateDoc(doc(db, "abstracts", id), { status, updatedAt: serverTimestamp() });

/**
 * Accept: flip the private status and write the public projection together.
 *
 * `type` is the organizers' decision, not the submitter's — everything is
 * submitted as a poster and the committee promotes some of them to talks.
 */
export async function publishAbstract(id, abstract, { type, posterNumber }) {
  const batch = writeBatch(db);
  batch.update(doc(db, "abstracts", id), { status: "accepted", updatedAt: serverTimestamp() });
  batch.set(doc(db, "abstracts_public", id), {
    title: abstract.title,
    affiliations: abstract.affiliations ?? [],
    authors: abstract.authors ?? [],
    body: abstract.body,
    topic: abstract.topic ?? null,
    figureUrl: abstract.figureUrl ?? null,
    type,
    posterNumber: type === "poster" ? posterNumber : null,
    edition: CURRENT_EDITION,
    acceptedAt: serverTimestamp(),
  });
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
