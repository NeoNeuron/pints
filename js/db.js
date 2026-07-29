import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
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
