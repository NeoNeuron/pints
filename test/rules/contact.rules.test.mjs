import test, { after, before, beforeEach } from "node:test";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc,
} from "firebase/firestore";
import { asAnon, asUser, makeTestEnv, seed, seedAdmin } from "./helpers.mjs";

let env;
before(async () => { env = await makeTestEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const message = (over = {}) => ({
  name: "Alice Dupont",
  email: "alice@ens.psl.eu",
  topic: "registration",
  message: "Is there a student rate?",
  createdAt: serverTimestamp(),
  ...over,
});

const send = (fs, over) => addDoc(collection(fs, "contact_messages"), message(over));

test("an anonymous visitor can send a message", async () => {
  await assertSucceeds(send(asAnon(env)));
});

test("every topic the form offers is accepted", async () => {
  const fs = asAnon(env);
  for (const topic of ["registration", "abstracts", "program", "venue", "website", "other"]) {
    await assertSucceeds(send(fs, { topic }));
  }
});

test("an unknown topic is refused", async () => {
  await assertFails(send(asAnon(env), { topic: "sponsorship" }));
});

test("empty and over-long fields are refused", async () => {
  const fs = asAnon(env);
  await assertFails(send(fs, { name: "" }));
  await assertFails(send(fs, { email: "" }));
  await assertFails(send(fs, { message: "" }));
  await assertFails(send(fs, { name: "x".repeat(81) }));
  await assertFails(send(fs, { email: `${"a".repeat(201)}` }));
  await assertFails(send(fs, { message: "y".repeat(4001) }));
});

test("a message at exactly the limits is still accepted", async () => {
  await assertSucceeds(send(asAnon(env), {
    name: "x".repeat(80),
    email: "a".repeat(200),
    message: "y".repeat(4000),
  }));
});

test("a field of the wrong type is refused", async () => {
  const fs = asAnon(env);
  await assertFails(send(fs, { name: 42 }));
  await assertFails(send(fs, { message: ["hello"] }));
});

test("an unknown field is refused", async () => {
  await assertFails(send(asAnon(env), { deliveredAt: new Date() }));
});

test("a required field cannot simply be left out", async () => {
  await assertFails(addDoc(collection(asAnon(env), "contact_messages"), {
    name: "Alice", email: "alice@ens.psl.eu", topic: "other", createdAt: serverTimestamp(),
  }));
});

test("createdAt must be the server's clock, not the client's", async () => {
  // Backdating is what would let a flood slip past the trigger's hourly cap.
  await assertFails(send(asAnon(env), { createdAt: new Date("2020-01-01") }));
  await assertFails(send(asAnon(env), { createdAt: new Date(Date.now() + 864e5) }));
});

test("authorUid may only ever be the sender's own uid", async () => {
  await assertSucceeds(send(asUser(env, "alice"), { authorUid: "alice" }));
  await assertFails(send(asUser(env, "alice"), { authorUid: "bob" }));
  // Signed out there is no uid to claim, so the field cannot be present at all.
  await assertFails(send(asAnon(env), { authorUid: "alice" }));
});

test("nobody but an organizer can read the messages", async () => {
  const id = (await send(asAnon(env))).id;
  await assertFails(getDoc(doc(asAnon(env), "contact_messages", id)));
  await assertFails(getDoc(doc(asUser(env, "alice"), "contact_messages", id)));
  await assertFails(getDocs(collection(asUser(env, "alice"), "contact_messages")));

  await seedAdmin(env, "boss");
  await assertSucceeds(getDoc(doc(asUser(env, "boss"), "contact_messages", id)));
  await assertSucceeds(getDocs(collection(asUser(env, "boss"), "contact_messages")));
});

test("a sender cannot rewrite or withdraw what they sent; an organizer can", async () => {
  await seed(env, (fs) => setDoc(doc(fs, "contact_messages", "m1"), {
    ...message(), createdAt: new Date(), authorUid: "alice",
  }));

  await assertFails(updateDoc(doc(asUser(env, "alice"), "contact_messages", "m1"),
    { message: "Actually, never mind." }));
  await assertFails(deleteDoc(doc(asUser(env, "alice"), "contact_messages", "m1")));
  await assertFails(deleteDoc(doc(asAnon(env), "contact_messages", "m1")));

  await seedAdmin(env, "boss");
  // The trigger stamps delivery back onto the document with the Admin SDK,
  // which ignores rules; an organizer doing it by hand goes through this.
  await assertSucceeds(updateDoc(doc(asUser(env, "boss"), "contact_messages", "m1"),
    { deliveredAt: new Date() }));
  await assertSucceeds(deleteDoc(doc(asUser(env, "boss"), "contact_messages", "m1")));
});
