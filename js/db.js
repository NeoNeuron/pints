import {
  addDoc,
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
 * Save the profile and reconcile the public projection in a single batch.
 *
 * Firestore rules cannot expose only some fields of users/{uid} — a read is
 * all-or-nothing — so the public name list is a separate collection written
 * here. The presence of participants_public/{uid} is the consent record.
 */
export async function saveProfile(uid, { email, displayName, affiliation, showPublicly }) {
  const batch = writeBatch(db);
  const clean = {
    email,
    displayName: displayName.trim(),
    affiliation: (affiliation ?? "").trim(),
    showPublicly: Boolean(showPublicly),
    edition: CURRENT_EDITION,
    updatedAt: serverTimestamp(),
  };
  batch.set(doc(db, "users", uid), clean, { merge: true });

  const publicRef = doc(db, "participants_public", uid);
  if (showPublicly) {
    batch.set(publicRef, {
      displayName: clean.displayName,
      affiliation: clean.affiliation,
      edition: CURRENT_EDITION,
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.delete(publicRef);
  }
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

export async function getMyAbstract(uid) {
  const snap = await getDoc(doc(db, "abstracts", uid));
  return snap.exists() ? snapData(snap) : null;
}

/**
 * Create or replace the participant's single abstract.
 *
 * setDoc without merge is deliberate: the rules validate the whole document on
 * every write, so a full replace is simpler than reasoning about partial
 * updates. Resubmitting after a rejection resets status to "submitted", which
 * the rules permit for any status except "accepted".
 */
export async function saveAbstract(uid, { title, affiliations, authors, body, type }) {
  await setDoc(doc(db, "abstracts", uid), {
    ownerUid: uid,
    edition: CURRENT_EDITION,
    title: title.trim(),
    affiliations,
    authors,
    body: body.trim(),
    type,
    status: "submitted",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export const withdrawAbstract = (uid) => deleteDoc(doc(db, "abstracts", uid));

export async function listAbstracts() {
  const q = query(collection(db, "abstracts"), where("edition", "==", CURRENT_EDITION));
  return (await getDocs(q)).docs.map(snapData);
}

export async function listPublicAbstracts() {
  const q = query(collection(db, "abstracts_public"), where("edition", "==", CURRENT_EDITION));
  return (await getDocs(q)).docs.map(snapData);
}

export async function getReview(uid) {
  const snap = await getDoc(doc(db, "abstract_reviews", uid));
  return snap.exists() ? snap.data() : null;
}

export async function saveReview(uid, { note, decidedBy }) {
  await setDoc(doc(db, "abstract_reviews", uid), {
    note: note ?? "",
    decidedBy,
    decidedAt: serverTimestamp(),
  }, { merge: true });
}

export const setAbstractStatus = (uid, status) =>
  updateDoc(doc(db, "abstracts", uid), { status, updatedAt: serverTimestamp() });

/** Accept: flip the private status and write the public projection together. */
export async function publishAbstract(uid, abstract, posterNumber) {
  const batch = writeBatch(db);
  batch.update(doc(db, "abstracts", uid), { status: "accepted", updatedAt: serverTimestamp() });
  batch.set(doc(db, "abstracts_public", uid), {
    title: abstract.title,
    affiliations: abstract.affiliations ?? [],
    authors: abstract.authors ?? [],
    body: abstract.body,
    type: abstract.type,
    posterNumber: abstract.type === "poster" ? posterNumber : null,
    edition: CURRENT_EDITION,
    acceptedAt: serverTimestamp(),
  });
  await batch.commit();
}

/** Withdraw a published abstract: remove the public copy and mark it withdrawn. */
export async function unpublishAbstract(uid) {
  const batch = writeBatch(db);
  batch.update(doc(db, "abstracts", uid), { status: "withdrawn", updatedAt: serverTimestamp() });
  batch.delete(doc(db, "abstracts_public", uid));
  await batch.commit();
}

export async function listUsers() {
  const q = query(collection(db, "users"), where("edition", "==", CURRENT_EDITION));
  return (await getDocs(q)).docs.map(snapData);
}

// ----------------------------------------------------------------- schedule

export async function listSchedule() {
  const q = query(collection(db, "schedule"), where("edition", "==", CURRENT_EDITION));
  return (await getDocs(q)).docs.map(snapData);
}

/** `id` null creates; otherwise replaces. Resolves to the document id. */
export async function saveScheduleItem(id, data) {
  const payload = { ...data, edition: CURRENT_EDITION };
  if (id) {
    await setDoc(doc(db, "schedule", id), payload);
    return id;
  }
  const ref = await addDoc(collection(db, "schedule"), payload);
  return ref.id;
}

export const deleteScheduleItem = (id) => deleteDoc(doc(db, "schedule", id));

// ----------------------------------------------------------------- settings

export const saveSiteConfig = ({ submissionsOpen, submissionDeadline }) =>
  setDoc(doc(db, "config", "site"),
    { submissionsOpen, submissionDeadline, edition: CURRENT_EDITION }, { merge: true });

export const addAdmin = (uid, email, addedBy) =>
  setDoc(doc(db, "admins", uid), { email, addedBy, addedAt: serverTimestamp() });
