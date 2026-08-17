# Organizers editing and deleting abstracts and participants

**Status:** approved 2026-08-17

## Why

Organizers can review abstracts — accept, reject, note, number — but they cannot
fix a typo in one, and they cannot remove anything at all. A junk submission, a
duplicate account, or a participant who asks to be forgotten currently needs
somebody in the Firebase console. That is the last day-to-day organizing task
still requiring a console workaround, which `README.md` otherwise claims are
gone.

## Scope

| | Organizers can |
|---|---|
| Abstracts | edit any field of any abstract at any status, and delete one outright |
| Participants | delete one outright — **not** edit |

Editing another person's name or affiliation is deliberately excluded. Those are
the participant's own words about themselves; an organizer who thinks one is
wrong should ask them. Admin power here is destructive-only by design.

## What the rules already allow

`firestore.rules` needs **no changes**. `allow write: if isAdmin()` already
covers `abstracts`, `users`, `abstracts_public` and `abstract_reviews`, and
`participants_public` already grants admin delete. This is load-bearing and
currently untested — see Testing.

`storage.rules` is the one exception: figure deletion is scoped to the uploader
(`request.auth.uid == uid`), and Storage rules cannot read Firestore, so there is
no `isAdmin()` to appeal to. Rather than bake an admin uid allowlist into the
rules, all figure deletion moves server-side where the Admin SDK ignores rules.

## Architecture

Destructive work runs in callable Cloud Functions; editing stays in the browser.

```
browser (admin console)                 functions (europe-west1)
  edit abstract ──────► Firestore
  delete abstract ─────────────────────► deleteAbstractCompletely
  delete participant ──────────────────► deleteParticipant
                                            └─► Auth + Firestore + Storage
```

Splitting deletion — client purges Firestore, function kills the login — was
rejected: it opens a window where the profile is gone but the login is not, and
still orphans figures.

### Client: editing an abstract

The Abstracts tab's card gains **Edit** and **Delete**. Edit mounts
`mountAbstractForm` inline in a `.panel`, reusing the component and the
one-editor-at-a-time arbitration built for `account.html`.

Three changes, each a latent bug the moment an admin edits someone else's work:

1. **Ownership.** `saveAbstract(id, uid, …)` writes `ownerUid: uid`, so an admin
   saving your abstract would take it over. `ownerUid` becomes explicit.
2. **Status.** The same function hardcodes `status: "submitted"`, so fixing a
   typo would un-accept an accepted abstract. Status becomes a parameter,
   defaulting to `"submitted"` to preserve the resubmit-after-rejection
   behaviour the rules permit.
3. **Freeze.** `frozen` becomes `status === "accepted" && !isAdmin`. Saving an
   accepted abstract writes `abstracts_public/{id}` in the same `writeBatch`,
   preserving `type` and `posterNumber`, so the public page cannot go stale.

`createdAt` is currently reset on every save, which is wrong today and more
obviously wrong once an organizer is editing months-old submissions. It is
carried through instead.

**Figures are read-only under admin edit.** Replacing one would need a write to
`abstract_figures/{ownerUid}/…`, which `storage.rules` forbids. The form shows
the figure with a note saying only the submitter can change it.

### Functions

Both verify the caller is in `admins/` server-side — a callable's `auth` context
is trustworthy, the client's claim about itself is not.

```
deleteAbstractCompletely({ abstractId })
  abstracts/{id}, abstracts_public/{id}, abstract_reviews/{id},
  Storage abstract_figures/{ownerUid}/{abstractId}

deleteParticipant({ uid })
  every abstract they own, via the same helper
  users/{uid}, participants_public/{uid}
  the Firebase Auth account
```

`deleteParticipant` refuses two cases:

- **deleting yourself** — an organizer removing their own account mid-session
  leaves the console in an undefined state;
- **deleting another organizer** — revoke their rights in Settings first, so one
  mis-click cannot decapitate the admin list.

Order is Firestore and Storage first, Auth last. If the run dies part-way the
account still exists, so the participant is still visible in the console and the
operation can simply be retried; deleting Auth first would leave invisible
orphaned data.

Region is `europe-west1`, not the `us-central1` default: participant names and
email addresses should not round-trip to Iowa.

### Confirmation

Both deletions go through `confirmChoice`, naming the damage before it happens —
*"Delete Kai Chen? This also deletes their 3 abstracts, 1 of them published, and
their login. This cannot be undone."* The counts come from `deletionPlan()`.

## Testing

- **Rules.** Admin delete on `abstracts`, `users` and `participants_public` is
  what the whole feature rests on and is asserted nowhere in the existing 71
  tests. Added first, so a later rules edit cannot quietly break the console.
- **Pure logic.** `deletionPlan(uid, abstracts, published)` returns what a
  removal touches and the counts the dialog quotes. Unit-tested under Node like
  the other `*-utils.mjs`.
- **Functions.** Exercised against the emulator suite via a new npm script.

## What this costs the project

`docs/design-notes.md` §3.3 states "no build step" and the architecture is
described as serverless. That stops being wholly true: the repo gains
`functions/` with its own `package.json` and Node runtime, `firebase.json` gains
a `functions` block, and there is now a deploy step for anything under
`functions/`. The static site itself is unchanged — it still needs no build, and
every page still works if the functions are never deployed, minus the two delete
buttons. The design notes are amended rather than quietly contradicted.
