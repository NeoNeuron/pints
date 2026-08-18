# PINTS website — design notes and hard-won lessons

Written 2026-07-30, at the end of the initial build.

**Who this is for:** whoever maintains this site next year, and anyone building a
similar conference site. The [spec](superpowers/specs/2026-07-29-pints-website-design.md)
records what was decided; the [plan](superpowers/plans/2026-07-29-pints-website.md)
records the task breakdown. This document records *why*, and the mistakes that
cost real time — which is the part you cannot recover from reading the code.

---

## 1. What was built

A conference site with participant accounts, abstract submission and review, an
editable programme, a public poster list, and organizer-editable static pages —
on free hosting with no server and no build step.

| Requirement | Where it lives |
|---|---|
| Login, participant vs. organizer rights | `js/auth.js`, `admins/{uid}` + `firestore.rules` |
| Abstract submission | `js/abstract-form.js`, `abstracts/{uid}` |
| Names of registered people | `participants_public/{uid}`, `participants.html` |
| Editable schedule | `js/admin-schedule.js`, `schedule/{id}`, `program.html` |
| Poster list with abstracts | `abstracts_public/{uid}`, `abstracts.html` |
| Markdown standalone pages | `content/*.md` + `js/page-content.js` |
| Mailing list (bonus) | CSV export only — sending needs a paid plan |
| Photographs of past editions | `gallery/{year}`, `js/slideshow.js`, `previous.html` (§7.4) |

Roughly 132 unit tests and 88 security-rules tests.

## 2. The stack, and why

**Plain HTML/CSS/JS ES modules, no build step, GitHub Pages, Firebase Auth +
Firestore.**

The decision came from two reference sites in the same community —
[compneuroparis](https://github.com/jmourabarbosa/compneuroparis) and
[gnt20](https://gnt20.github.io) — which had independently converged on it. That
convergence mattered more than any abstract comparison: it meant academics
actually maintain sites built this way.

Consequences worth understanding before changing anything:

- **No bundler.** Third-party code (`marked`, `DOMPurify`) is *vendored* into
  `vendor/` by `npm run vendor`, a file copy. The browser imports local files, so
  there is no CDN dependency at runtime and still no build.
- **Multi-page, not a single-page app.** GitHub Pages has no rewrites, real URLs
  are better for a conference people find by search, and an organizer can edit
  one page without understanding the rest. `gnt20` does this; `compneuroparis`
  went SPA. For this use case multi-page reads better.
- **`npm` is dev-only tooling.** The deployed site is the repository contents,
  verbatim.

## 3. Four constraints that shaped everything

Understanding these explains most of the design. Fighting them wastes days.

### 3.1 Firestore rules cannot filter fields

A read is all-or-nothing per document. There is no way to expose some fields
publicly and hide others.

Three requirements collided with this: the public name list (must not leak
emails), public abstracts (must not leak unaccepted submissions), and organizer
review notes (must not leak to the author). The answer is **separate public
projection collections** written alongside the private original —
`participants_public`, `abstracts_public`, `abstract_reviews`.

This is the single most load-bearing idea in the codebase. Field-level read rules
do not exist; do not attempt them.

### 3.2 Cloud Storage costs money, and we now pay it

As of February 2026, Cloud Storage requires the Blaze plan and a credit card.
Firestore, Auth, and Auth's emails remain free on Spark.

The site ran on Spark until figure uploads were added to abstract submission.
That one feature is what moved the project to Blaze — there is no way to host a
participant's image on Firebase without it. In practice the bill is nil: the
free allowance is 5 GB stored and 1 GB/day downloaded, and a conference's worth
of figures is a few hundred megabytes at most.

Two things follow, and both matter:

- **Storage is the only paid service in use.** Cloud Functions are still not
  enabled and should not be. Every other constraint in this document (no server,
  rules as the sole authorization boundary) is unchanged.
- **Uploads are downscaled in the browser first** (`js/storage.js`), to a
  1600px longest edge. Not to save the bucket — to save the visitors, since
  every accepted figure is fetched by everyone who opens `abstracts.html`.

Set a budget alert on the project. The failure mode worth guarding against is
someone using the bucket as free hosting, which `storage.rules` limits by
capping size and content type and keying every object on the uploader's uid.

### 3.2b Page copy lives in Firestore only — the GitHub write-back was removed

The Pages tab briefly had an "Update in the repo" button that committed page
copy back to `content/*.md`, plus a paired "Revert to the version in the repo".
With no server there was no safe place to hold a GitHub credential, so the
organizer supplied a fine-grained token scoped to one repository and it lived in
`sessionStorage` for the life of the tab.

**It was built, shipped, and then taken out at the organizers' request.** The
feature worked; the trade-off was not worth it to the people who had to run it.
A token in the browser is a real credential in a place nobody wanted to reason
about, and the payoff — a tidy git history for page copy — mattered less than
having one obvious place edits go.

The cost we accepted in exchange: `content/*.md` is now a **seed and read
fallback only**, and it will drift stale relative to what the site shows. That
is fine as long as nobody mistakes the files for the current copy. Two things
still depend on them, so they cannot be deleted:

- `js/content-hydrate.js` fetches the file when `pages/{slug}` is missing *or*
  when the Firestore read throws, which is what keeps the site readable during a
  Firebase outage.
- `js/admin-pages.js` seeds the editor from the file the first time a page is
  edited.

Reverting a page now means copying `content/<page>.md` back into the editor, or
deleting `pages/{slug}` in the Firebase console. If the write-back is ever
wanted again, the shape to reach for is a server-side action (a GitHub Action on
a Firestore trigger), not a token in a text box.

### 3.2c Deletion is the one thing that cannot be done from the browser

Everything else on this site is a static page talking straight to Firestore,
with `firestore.rules` as the only authorization boundary. Deleting a
participant broke that model twice over:

- **A Firebase Auth account can only be deleted by its owner from a browser.**
  Removing somebody else's login needs the Admin SDK, which needs a server.
- **`storage.rules` cannot read Firestore**, so it has no `isAdmin()` to appeal
  to and keys figure deletion to the uploader's uid. An organizer deleting an
  abstract could not remove its figure.

The alternative to a server was baking a list of admin uids into `storage.rules`
and accepting that the login survives — rejected, because the uid list rots
silently the moment the committee changes.

So `functions/` exists, holding exactly two callables and nothing else. Keep it
that way: the moment ordinary reads and writes start going through functions,
the site stops being a static site and every page pays cold-start latency for
work that rules already secure. The test for whether something belongs here is
narrow — *does it need to bypass the rules?*

Because the Admin SDK ignores rules, every callable checks the caller itself.
`request.auth` on a callable is set by the platform from a verified ID token and
is trustworthy; nothing else the client sends is.

### 3.2d The acceptance freeze is keyed on capability, not on role

An accepted abstract is read-only, because editing one would leave
`abstracts_public` serving the old text. The admin console can edit accepted
abstracts anyway, since it rewrites the public copy in the same batch.

The obvious way to express that is `frozen = accepted && !isAdmin`. **It is
wrong**, and it was briefly shipped that way. An organizer opening their own
accepted abstract on `account.html` would also be unfrozen — and nothing on that
page rewrites the public copy, so the site would publish one text and display
another.

The condition is therefore `frozen = accepted && !republish`, where `republish`
is the payload that makes the rewrite possible. The form unlocks when the caller
has demonstrably wired up the thing that keeps the two copies in step, not when
the caller happens to have a role. A missing payload fails closed.

Generally: gate on the capability that makes an action safe, not on the identity
of whoever usually holds it.

### 3.3 No build step

Which means: all paths relative, dependencies vendored, no environment-variable
injection, no minification, no transpilation. See §4.3 for the two places this
bites.

This still holds for the **site**. It does not hold for `functions/`, which has
its own `package.json`, its own `node_modules`, and a real deploy step. The two
are independent: every page works with the functions never deployed, minus the
two delete buttons, which say so when pressed.

### 3.4 The Firebase web API key is public, unavoidably

The browser must receive it, so it is visible in the served JavaScript whatever
you do. GitHub's scanner flags it; that is a false positive in the sense that
matters. **Authorization is `firestore.rules`, not secrecy.**

The exposure worth mitigating is *quota abuse*, not data access: an unrestricted
key lets anyone drive signup attempts and read loops against the project. Fix it
with HTTP referrer restrictions on the key and App Check — both free, both in the
console. Hiding the string achieves nothing.

## 4. Pitfalls that cost real time

Each of these was found empirically, most of them after something passed a test
and still failed in reality.

### 4.1 Security rules

| Symptom | Cause | Fix |
|---|---|---|
| A list page gets `PERMISSION_DENIED` although a single-document read works | Collection queries need `list`, not just `get` | `allow read: if true` covers both. Do not write rules that inspect `request.query` |
| The very first consent opt-in is denied | A rules `get()` reads *pre-batch* committed state, so checking `users/{uid}.showPublicly` fails inside the `writeBatch` that sets it | Drop the `get()`. Validate ownership, a key allowlist, and lengths. The public document's *existence* is the consent record |
| A rejected participant can never resubmit | Freezing every non-`submitted` status. The abstract's document ID is the owner's UID, so there is no second slot — they can neither revise, delete, nor replace | Freeze **`accepted` only**. `rejected` and `withdrawn` must stay editable |
| Emulator tests pass, production denies | Rules were not deployed with the code that depends on them | Deploy rules **before or with** the client change. `npm run test:rules && npx firebase deploy --only firestore:rules` |
| Rules cannot pin `edition` to the current one | Rules cannot read `js/config.mjs` | Accepted looseness. Duplicating the edition string into rules is a worse trade |

Two habits that paid off repeatedly:

- **Assert both allow *and* deny in every rules test.** A rule that permits the
  right thing while also permitting everything passes a naive test suite.
- **Probe production after deploying**, with the real published API key:
  ```bash
  B="https://firestore.googleapis.com/v1/projects/PROJECT/databases/(default)/documents"
  curl -s "$B/users?key=$KEY"        # must be PERMISSION_DENIED
  curl -s "$B/participants_public?key=$KEY"   # must succeed
  ```
  This caught a rules deploy that had not landed.

### 4.2 Firebase Auth

- **`email_verified` is stale.** It comes from the ID token, which is *not*
  updated when the user clicks the verification link — it stays `false` for up to
  an hour. Symptom: verify, submit, `PERMISSION_DENIED`, "fixes itself" later.
  Fix: `await user.reload()` then `await user.getIdToken(true)` before enabling
  anything that depends on it.
- **Authorized domains.** Every host that serves the site must be listed under
  *Authentication → Settings → Authorized domains*, including `localhost` for
  local work. Omitting it fails with an opaque `auth/unauthorized-domain`.
- **A failed verification email must not look like a failed signup.** The account
  already exists at that point, so surfacing the mail error sends people back to
  "Create an account" and into `auth/email-already-in-use`, from which they
  conclude the site is broken. Report the two outcomes separately.
- **Institutional mail filters reject the default sender.** Firebase sends from
  `noreply@<project>.firebaseapp.com`, which has no SPF/DKIM alignment a
  university mail server trusts. Measured here: a Gmail address received and
  verified; an `@ens.psl.eu` address never did. Since a conference audience is
  almost entirely institutional addresses, treat this as a launch blocker, not a
  detail. Fixes: custom SMTP through a real mailbox, or a custom sender domain
  with DNS records. Upgrading to Identity Platform (needed for custom SMTP) is
  **free on Spark**, capped at 3,000 daily active users.
- **Organizers are participants too.** Role-based navigation that swapped a
  single "account" link for "Admin" left organizers with no route to their own
  profile or abstract form at all. Render both.

### 4.3 GitHub Pages and caching

- **`404.html` is the one file that cannot use relative paths.** Pages serves it
  from the *requested* URL, so on a hit to `/pints/typo` a relative
  `css/styles.css` resolves to `/pints/typo/css/styles.css` and 404s — the page
  loads unstyled with no navigation. It is therefore self-contained, with inline
  CSS and a `<base>` tag that must match the serving path.
- **`.nojekyll` is required.** Without it Pages runs Jekyll, which drops paths
  beginning with `_` and would transform `content/*.md` instead of serving it raw
  for the client-side renderer.
- **Assets are served `max-age=600`.** A returning visitor runs up to ten minutes
  of stale JavaScript after a push. It self-heals; do not conclude a fix failed
  inside that window.
- **A dynamic `import()` survives a hard reload.** This one is genuinely
  surprising: a hard reload revalidates the document and its *statically*
  imported module graph, but a runtime `await import()` is an ordinary fetch that
  honours the HTTP cache. A deployed fix appeared not to deploy for this reason.
  Prefer static imports for anything a page always needs; when testing a lazily
  loaded module, verify with `fetch(url, {cache:'reload'})` rather than trusting
  a reload.

### 4.4 Testing

- **Rules test files share one emulator.** Each calls `clearFirestore()` in
  `beforeEach`, so `node --test` running files in parallel wipes the database
  mid-test in a sibling. It *passed* anyway, which is the dangerous part; the
  tells were a `RESOURCE_EXHAUSTED` error and one test taking 10.5 s beside
  neighbours at 20 ms. `--test-concurrency=1` took the suite from ~12 s to 1.6 s.
- **`@firebase/rules-unit-testing` must be v5** with `firebase` v12. v4 peers on
  v11 and fails `npm install` with `ERESOLVE`.
- **The emulator needs a JVM.** Homebrew installs `openjdk` keg-only, off `PATH`.
  `scripts/rules-tests.mjs` locates it rather than asking every contributor to
  edit their shell config.
- **HTTP 200 is not "it works".** Both bugs that reached production returned 200
  with correct-looking markup and failed only when the JavaScript ran. Load the
  page; read the console.

### 4.5 Content and UI

- **Markdown cannot attach a class**, so any styling an embedded image needs must
  be global. A 1549 px sponsor banner overflowed `.prose` and made the whole page
  scroll sideways until `img { max-width: 100%; height: auto; }` was added.
- **Two markdown allowlists, deliberately different.** Repo-authored
  `content/*.md` is trusted and renders headings, lists, tables, images.
  Participant-submitted abstract bodies are untrusted and render through a tight
  allowlist (`p br em strong sup sub a`) with https-only URLs. The XSS cases are
  unit-tested; keep them that way.
- **Sort client-side, do not `orderBy`.** Every list page fetches by `edition`
  equality and sorts through a tested pure function. Adding `orderBy` to an
  equality filter demands a composite index — needless setup friction at this
  scale (a few hundred records).
- **Migrating a previous edition's content is not migrating facts.** The 2025
  site's venue, dates and committee are not 2026's. Carried-over material is
  labelled *"from the 2025 edition — to be confirmed"* and the 2026 placeholders
  stay put. Publishing a stale venue as current is worse than publishing nothing.

## 5. How the testing is split, and why

Three layers, because each catches a class the others cannot:

1. **Pure-function unit tests** (`test/*.test.mjs`, `node --test`, no framework).
   All logic worth testing lives in `js/*-utils.mjs` with no DOM or Firebase
   dependency: sorting, validation, time parsing, CSV quoting, markdown
   sanitization. Fast, and the reason "no build step" is still verifiable.
2. **Security-rules tests** (`test/rules/`, Firestore emulator). The rules *are*
   the security model, so they get the heaviest coverage — every case asserting
   both allow and deny.
3. **Manual browser verification against production.** Not automated, and it
   caught what the other two could not: stale caches, undeployed rules, module
   loading order, layout overflow.

The gap: nothing exercises the DOM assembly. The populated schedule table, the
abstract card, the author superscripts — all verified by eye. If this site grows,
that is where to add coverage next.

## 6. Reusing this for another conference

The bones are generic. To retarget:

1. `js/config.mjs` — `CURRENT_EDITION`, `SITE_NAME`, `SITE_TAGLINE`, `NAV`,
   field limits. Every edition-scoped document is stamped with `CURRENT_EDITION`,
   so next year is a one-line change, not a migration.
2. `content/*.md` — all page copy.
3. `js/firebase-config.js` — a new Firebase project.
4. `css/styles.css` — the palette lives in `:root` custom properties.
5. `firestore.rules` — reusable as-is; re-run its tests after any edit.

What is *not* generic: the assumption of **one abstract per participant**,
encoded by using the owner's UID as the abstract's document ID. That buys real
simplification (a direct `get`, no `list` permission on private data, uniqueness
for free). If a future edition needs multiple submissions per person, move to
`abstracts/{autoId}` with `allow list: if resource.data.ownerUid == request.auth.uid`
and queries constrained by `where("ownerUid", "==", uid)`. **This has already been
done once and undone again — read §7.1 before doing it a third time.**

## 7. What changed in August 2026, and why

Written after a second round of work, before the first real submission window.

### 7.1 The abstract id went back to the owner's uid

§6 above records moving *away* from `abstracts/{uid}` to `abstracts/{autoId}` so
one person could submit several. The organizers then decided one abstract each is
the rule, and it went back.

The alternative was to keep auto-ids and hide the "new abstract" form once
somebody had one. That was rejected: the rules are the only authorization
boundary on this site, and a limit the rules cannot express is a limit anyone
holding the public API key can ignore. Rules cannot count documents — but they do
not have to when there is only one slot to write, named by the uid. The rule is
now true by construction.

What it cost: the account page's editor-arbitration layer went with it (which was
a gain — it existed only to reconcile several open drafts), and the `list`
permission on `abstracts` narrowed to organizers, since a participant reads their
own with a direct `get` and a query could only ever have swept in other people's.

If it moves back to auto-ids a third time, the thing to preserve is the property,
not the shape: whatever replaces it has to make "one each" checkable by the
rules, or accept out loud that it is only a UI convention.

### 7.2 The public participant entry waits for verification

Registering used to write `users/{uid}` and `participants_public/{uid}` in one
batch, because registering *is* the consent and there was nothing to reconcile.
That is still true — what changed is that consent is not the only question.
Anyone can type any name and any address into a signup form, and the list is a
public page. So the private profile is written at registration and the public
entry when a fresh ID token says the address is confirmed.

The hook is `account.html`, because the verification link already lands there and
already forces a token refresh for the abstract form's sake. The write is
idempotent and unconditional on every load, which is what makes a registration
interrupted between the two writes heal itself rather than needing a repair
button nobody would find.

### 7.3 Reviews became per organizer, and the shared note became a liability

One free-text note shared by the whole committee could not answer "what does
everyone think", and it had a real bug: the textarea was filled by an async read
after the card rendered, and the accept and reject buttons wrote it back on every
click. Clicking Accept quickly enough saved an empty note over a real one.

Scores and notes are now a map keyed by reviewer uid inside the same document,
merged rather than set — two organizers reviewing at once would otherwise have
the last save win silently. Accept and reject no longer touch reviews at all;
they record who decided and when, and nothing else.

A note with no score counts as a review and does not move the mean. That is not a
detail: "conflict of interest, abstaining" is a thing organizers write, and
scoring it as a zero would be worse than not counting it.

### 7.4 The Dropbox sync is the second reason to have a Cloud Function

§3.2c says `functions/` exists for exactly one reason — deletion needs to bypass
the rules — and warns against letting anything else in. The archive slideshow is
the first thing admitted since, on a related but distinct ground: it needs a
credential the browser must not hold. A Dropbox shared folder cannot be listed
without an `Authorization` header, and §3.2b is the record of what happened last
time a token lived in a text box in the browser.

The shape that keeps this from becoming a server: the callable runs only when an
organizer presses Sync, and it *writes to Firestore*. Visitors read the cached
document. Nobody's page load calls a function, and the Archive page is unchanged
if the function is never deployed.

The test for admission to `functions/` is now two questions, not one — does it
need to bypass the rules, or hold a secret? — and both are narrow on purpose.

### 7.5 The verification gate moved from submitting to being listed

§4.2 records email verification as a launch blocker: Firebase sends from
`noreply@<project>.firebaseapp.com`, institutional filters quarantine it, and an
`@ens.psl.eu` address never received the message in testing. The response at the
time was to document it and exempt organizers.

It is now fixed by moving the gate rather than the mail. Submitting an abstract
requires only that you are signed in and own the document; the **public
participant list** is what waits for a verified address. That is where the gate
belongs: an unproven address on a public page is the actual harm, whereas an
unproven address on a submission is a problem the organizers were always going to
notice when they read it.

The change also made "submit without an account" possible at all. An account
created during submission is seconds old and cannot be verified, so any design
where the write needs `isVerified()` cannot accept a first-time submitter.

What still stands between `abstracts` and the open internet: an account per
submission, one abstract per account (the uid key from §7.1), the submission
window, and a required figure. That is a weaker barrier than before, deliberately,
and it is worth naming as such rather than discovering later that it changed.

### 7.6 Registering happens before the write, not after

The ask was "let people submit without logging in, and register them afterwards".
Afterwards is impossible: `firestore.rules` keys the abstract on the owner's uid
and `storage.rules` keys the figure on the uploader's, so there is no uid to
write under until an account exists. The only alternatives were to open
`abstracts` to unauthenticated writes — handing the collection to anyone with the
public API key — or to proxy the write through a Cloud Function, which would put
ordinary writes behind a server and undo the property §3.2c exists to protect.

So the account is created a moment *before* the write. From the form it is
invisible: you fill it in, press Submit, and you have both an abstract and an
account. `mountAbstractForm` takes an `ensureAccount` callback and resolves the
uid at save time rather than at mount, which is the whole mechanism.

Two consequences worth keeping:

- **Nothing irreversible happens until the form is valid.** Account creation runs
  after validation, never before, so a half-filled form leaves no orphan account
  behind. The pure validator gained `validateSubmitter` so the submitter's
  details fail in the same list as the abstract's.
- **The submitter never chooses a password.** One is generated and discarded, and
  they get a "set your password" email rather than a verification one —
  completing a password reset proves the same thing and Firebase marks the
  address verified when they do. One email doing both jobs, and no account
  nobody can sign in to.

### 7.7 The one moment a first-time submitter is paying attention

A guest submission does two things, and only one of them finishes: the abstract
is stored, and an account is created whose email has not been opened. Everything
that is still missing — a password, a verified address, a place on the
participant list — is behind that email.

The first cut reported it as a status line, which was immediately overwritten by
"Abstract received" a second later. That is worth recording because it is the
generic version of a mistake this codebase has made before (§7.3): a message
element shared between two things that happen close together will lose one of
them. The fix is the same both times — give the thing that must persist its own
element.

It is now a panel rather than a line, it names the sending domain, and it carries
its own resend button. Not a link to somewhere they can resend from: the moment
somebody notices the mail never arrived is right then, not on a later visit to a
page they do not know exists.

### 7.8 `?emulator` on any page

Guest submission could not be rehearsed. Trying it against production meant a
real account and a real abstract to clean up afterwards, and the failure modes
that matter — a first-time submitter, an address already taken, a bounced mail —
are all ones you only find by running them.

`js/firebase.js` now points Auth, Firestore and Storage at the local emulators
when a page is loaded with `?emulator`, guarded on localhost as well, exactly as
`js/functions.js` had always guarded its own. It found a real bug within minutes
(the shared `#msg` above), which is the argument for it.

One wrinkle worth writing down: the emulator starts with no `config/site`, and
`submissionWindowOpen()` calls `get()` on it. A missing document makes the rule
error, and an erroring rule fails closed — so every submission is refused with no
obvious cause until you seed it. That is the *desired* behaviour in production
(§4.1) and a confusing first five minutes locally. The README gives the curl.

### 7.9 The listing gap got a scheduled sweep, not an auth-action page

§7.2 hangs the public participant write on `account.html`, because the
verification link already lands there and already forces a token refresh. That
covers most people instantly and two groups not at all: anyone who opens the
link on a device where they are not signed in, and every guest submitter, who
is sent a password-reset mail rather than a verification one and so never visits
the page. Completing that reset is precisely what verifies their address, so the
people most likely to be missing are the ones who used the newest route in.

Neither case can be fixed client-side. `participants_public` is writable only by
its owner or an organizer, and the person is signed in nowhere — so whatever
fixes it needs the Admin SDK, which means `functions/`.

The alternative considered was hosting the email action page ourselves: a
`auth-action.html` that calls `applyActionCode` (which works signed out) and
then asks a callable to publish. It is genuinely event-driven and would have
been instant. It was rejected because it takes over Firebase's handler for
*every* auth email, so it would also have had to implement password reset and
email-change correctly — more surface, and more to get wrong, for a result the
sweep reaches within five minutes.

Two details worth keeping if this is ever rewritten:

- **It writes with `create()`, not `set()`.** "Never overwrite" is then enforced
  by the database rather than by the freshness of the set of already-listed uids
  read at the top of the run. An organizer's correction cannot be reverted by
  it, and losing a race with the client's own publish is a no-op instead of a
  clobber.
- **Five minutes, not one.** The fast path already covers the common case, so
  this is a net, and a net that sweeps the whole participant list every minute
  is a standing Firestore bill for finding nothing. The design notes claim the
  running cost of this site is nil; a poller is the easiest way to make that
  quietly untrue.

## 8. Open items

- **Restrict the web API key** and enable App Check (§3.4). Free, console-only.
- **Verify email deliverability from an institutional address** after any sender
  change. Gmail arriving proves the pipeline, not the filters.
- **Poster numbers can collide** under concurrent review: `nextPosterNumber()`
  suggests, nothing enforces. Safe for one organizer working sequentially; make
  `publishAbstract` a transaction if review is ever shared.
- **Mailing-list sending** is not built; CSV export stands in. Real sending needs
  a paid plan.
- **`pints.fr` exists** and currently forwards to the 2025 site. Pointing Pages
  at it would give the site a proper domain and remove the `404.html` `<base>`
  coupling.
