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

Roughly 174 unit tests and 94 security-rules tests.

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

**Superseded by §7.21 — the gate is back on submitting. Kept for the reasoning.**

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

**Superseded by §7.21 — guest submission was removed. Kept because the mechanism
is the hard part, and this is where it is written down.**

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

**Partly superseded by §7.21: the panel survives, on `submit.html`, as the
unconfirmed-address stop. The guest submission it originally reported is gone.**

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

Guest submission could not be rehearsed (it is gone — §7.21 — but the tooling it
forced is the lasting part). Trying it against production meant a
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

**Its conclusion was overtaken by §7.25 — but its cost estimate was not.** The
site now does host `auth-action.html`, for a reason this section did not have,
and it cost exactly what this section predicted. The scheduled sweep stays: the
handler still cannot publish for somebody who is signed in nowhere, which is the
gap the sweep exists to close.

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

### 7.10 Page copy may contain HTML; the `style` attribute is filtered, not trusted

Organizers asked to colour a word on the home page. Markdown has no syntax for
that, and the sanitizer was stripping the HTML they tried, so nothing they could
type in the editor would do it.

The fix is two changes to `PAGE_ALLOWLIST`: `span`, `div`, `u`, `s`, `small`,
`mark` join the tags, and `style` and `class` join the attributes. Abstracts are
untouched — `ABSTRACT_ALLOWLIST` is a separate constant, and participant input
still renders no HTML at all.

Allowing a bare `style` attribute would have been the one-line version, and it
is broader than the request. DOMPurify decides whether an attribute may exist;
it does not read this one's contents. So `safeStyle()` filters the declarations,
wired in through an `afterSanitizeAttributes` hook:

- **Presentation properties pass**: colour, font, text, spacing, borders,
  background, sizing, opacity, display.
- **`position`, `z-index`, and the offsets do not.** Those are what turn a
  styled word into an invisible layer over the rest of the page. No conference
  copy needs them, and dropping them costs nothing.
- **Any value containing `url(`, `expression(`, `javascript:`, or `@import` is
  discarded whole.** `url()` is the one CSS function that reaches the network,
  which would turn a page view into a signal to whoever wrote the copy.

Rejecting the token rather than parsing what is inside it is deliberate: the
failure mode of a too-clever CSS parser is a bypass, and the failure mode of
this is an organizer having to write a colour a different way.

This does not make a stolen admin session harmless — an admin already holds full
database write access, which is the larger problem either way. It keeps the
blast radius at "ugly page" rather than "script execution".

**The trap worth knowing about**: marked treats a block-level tag as a raw HTML
block, so `<div>**bold**</div>` prints the asterisks. A blank line above and
below the contents hands them back to the markdown parser. The editor hint says
so, `README.md` says so, and a unit test pins the behaviour so the advice cannot
silently go stale.

### 7.11 The header logo carries its text as outlines

`scripts/logo/` generates two files from the 2025 Inkscape source it keeps
alongside them: `assets/pints-2026-header.svg`, the home hero, replacing the text
heading and the date line under it; and `assets/pints-mark.svg`, the wordmark
alone, which `js/layout.js` puts in the header brand link on every page. Neither
is hand-edited. Same artwork, two crops — the mark is not a separate drawing, so
they cannot drift apart.

The source draws the wordmark, subtitle and date as `<text>` in Trebuchet MS.
That is fine in Inkscape and fine on macOS and Windows, and it falls apart
everywhere else: without the font a browser substitutes its default serif, the
wordmark renders as Times, and the pint-glass "i" — a `<path>`, so it does not
move — ends up sitting on the N. Most Linux and Android visitors would see that.
So the generator shapes each run with HarfBuzz and emits outlines. Only the two
icon paths are copied across verbatim, transforms and clip-paths intact, so the
artwork itself is the designer's.

Two things had to be recovered by measuring the designer's own export
(`pints_header_2025.png`) rather than trusting the file, because Inkscape and
browsers disagree about both:

- The subtitle's grey runs carry no `font-family` and no `font-size`, so a
  browser renders them in 16px serif next to 12px bold sans capitals. The export
  shows them as 12.5px Trebuchet, matching the capitals.
- The wordmark run carries `dx="0 -1.295"`, which the export ignores. Honouring
  it puts `NTS` 3px left of where the logo has always been.

With those fixed the output matches the 2025 export to within 2px across its
980px width. The `viewBox` is also cropped to the ink: the source frames the
artwork on a page-sized canvas, and that dead margin read as the logo being
indented against the buttons beneath it.

**Why this is not a build step.** The generated SVGs are committed and the site
loads them directly; `scripts/logo/` is an asset tool that runs when the date or
the wording changes, needs macOS system fonts and a throwaway virtualenv, and is
deliberately absent from `package.json`.

### 7.12 `.wrap` was silently eating every page's vertical padding

Sizing the hero logo to the width of the prose below it turned up two layout
bugs that had nothing to do with the logo.

`main { padding-block: 2rem 1rem }` had never once applied. `.wrap` set
`padding: 0 1.25rem`, and as a *shorthand* that also declares `padding-block: 0`
— from a class selector, which outranks an element selector regardless of source
order. Every page's copy therefore sat flush against the header. It is now
`padding-inline`. The header, hero and footer wraps all set `padding-block`
explicitly, so they never depended on the zero.

The second was `--measure`. It is `68ch`, and `ch` is the width of the *element's
own* `0` glyph — so the identical `max-width: var(--measure)` resolved 9% wider
on the hero logo than on `.prose`, because the logo inherited the `h1`'s bold
display font. The `h1` now holds nothing but the image and carries `font:
inherit`, which is what makes the two columns line up.

Worth remembering as a pair: **a shorthand declares every longhand it covers**,
and **font-relative units are relative to the element, not the page**.

### 7.13 Program sessions are derived, not numbered by hand

The organizers keep the program in a spreadsheet where a session is a run of
tinted rows under a banner — "Session II | Computational Neuroscience". The site
had only a flat time-ordered table, so the shape that makes the day legible was
being lost on the way in.

The field added is deliberately small: `session`, optional, one of the three
`ABSTRACT_TOPICS` plus `keynote`. A session is what a topic becomes once it is
scheduled, so reusing those ids means the program and the abstract list group the
day by the same vocabulary rather than two that can drift.

Three things are **not** stored, and that is the point:

- **The numeral.** `groupScheduleBySession()` assigns I, II, III by where a block
  lands in the day. Inserting a session at 11:00 renumbers everything after it for
  free; a stored numeral would have to be edited on every item by hand, and the
  first missed edit prints two Session IIIs.
- **The banner text.** It comes from `SESSION_LABELS`, so a typo cannot produce
  two spellings of one session, and a session with no items simply does not print.
- **The order.** Grouping is by *contiguous run*, not by session id. That is the
  one decision worth defending: grouping by id would let a stray 17:00 item tagged
  `cognitive` drag itself back up into the 10:00 block and silently print the day
  out of order. A program that lies about time is worse than one that shows a
  session split in two — so a split renders as two blocks carrying the same
  numeral, which makes the data-entry slip visible instead of hiding it.

The rule allows the field but not a blank one: `''` is rejected and the editor
drops the key rather than storing an empty string, because a blank would print an
unnamed banner. An id outside the vocabulary is also treated as no session at
render time, so shrinking `SCHEDULE_SESSIONS` between editions degrades to a loose
row rather than an empty banner.

### 7.14 The preview had to become the card, not resemble it

The submission form's preview rendered the abstract body and nothing else — no
figure, no caption, no authors — while the published card rendered all of it. Two
renderers, one of them quietly wrong, and the wrong one was the one shown to the
person deciding whether their submission was ready.

The fix was to delete the second renderer rather than teach it the missing parts.
`js/abstract-card.js` is now the only function that draws an abstract, called by
the public list, the preview, and the post-submission confirmation. The preview
feeds it a draft straight out of the form with `figureUrl` pointed at the object:
URL of the not-yet-uploaded file, so what is on screen is the real card fed real
input. It deliberately omits the poster number and the talk pill: those are the
committee's to assign, and showing them would promise a decision nobody has taken.

Two mechanical notes worth keeping. The preview listens on the **form**, not on
each field, because author rows are added and removed after mount and a
per-field listener misses every row that did not exist at mount time; row removal
and the figure controls fire no `input` event at all and call the refresh
directly. And `collect()` had to move above the preview: it was declared after
it, and the first `refreshPreview()` call ran while it was still in its temporal
dead zone.

### 7.15 A submission you cannot see is a submission you do not trust

Pressing Submit left the filled-in form exactly where it was and added a green
line above it. Everything about the screen said "nothing happened", which is the
opposite of what a person needs at the one moment they are wondering whether
their work arrived.

`submit.html` now answers with the record itself: the stored abstract, re-read
from Firestore rather than echoed from the draft, drawn as the same card the
organizers will read, with an **Edit submission** button on it. Arriving later
with an abstract already on file lands in the same view — it is the same state,
and two different screens for one state is how a page starts lying.

Sharing came with the same work, and it has one real constraint:
**`abstracts_public` holds accepted abstracts only.** So `abstracts.html?a=<id>`
can serve a link anybody can open, but only after a decision. Offering a
submitter a link to an abstract still in review would hand them a URL that works
for exactly one person — themselves — which is worse than offering none, so the
link appears only once the abstract is public. The unknown-id and the
not-accepted cases give the same answer for a related reason: distinguishing them
would announce a decision through a 404.

### 7.16 The list had to collapse, and `loading="lazy"` was a trap

`abstracts.html` rendered every accepted abstract in full. At the twenty of a
first edition that is merely long; at the hundreds the organizers expect it is
unusable, and it fetches every figure whether or not anyone scrolls that far.

Rows now collapse: poster number or talk pill, title, presenting author with "et
al." (`summaryAuthorLine`), grouped under topic headings via the `groupByTopic`
the review console already used. The interesting part is not the disclosure, it
is **where the deferral lives**.

The obvious implementation — render every card inside a closed `<details>` — buys
nothing. Collapsed markup is not a deferred download; the browser parses and
fetches it all the same. So `abstractDisclosure` builds only the `<summary>` and
attaches the body on the first `toggle`. Verified rather than assumed: 120 seeded
abstracts, zero figure requests on load, one after opening one row.

Then the trap. The figure carried `loading="lazy"`, which sounds like belt and
braces and was in fact **broken**. An image with no `width`/`height` and nothing
loaded yet lays out at 0×0, and a zero-area target never registers as
intersecting, so a figure revealed by opening a disclosure sat blank
indefinitely — measured: in the viewport at y=473, still `naturalWidth === 0`
after 1.5 s, loading instantly the moment it was forced eager. It would also have
printed blank, defeating the `beforeprint` handler.

The attribute is gone. Every remaining caller draws one abstract's figure at a
time, or has already deferred the work by not building the body, so there is
nothing left for it to do. **Two lazy mechanisms did not compose; the one that
could be verified stayed.**

Printing gets a handler rather than a stylesheet, for the same reason: a rule
cannot reveal a body that was never built, so `beforeprint` opens every row —
which builds them — and `@media print` only strips the chrome.

### 7.17 Two pages disagreed about what "your submission" looks like

`submit.html` showed a participant their stored abstract as a card with its
status and an Edit button. `account.html`, reached from the header on every page,
dropped the same person straight into the editor for the same abstract. Both
screens were reachable, neither was wrong on its own, and together they were a
site contradicting itself — the sort of defect that gets reported as "the change
didn't work" because the reporter was on the other page.

`js/submission-view.js` is now the single answer, and both pages call it. The
extraction is the fix; the card was already right.

It took one piece of state with it. `page-account.js` had a `mountedId` guard
whose only job was to stop a re-render wiping the "Abstract saved" line, because
re-rendering meant re-mounting the form the person was reading. Returning to the
card *is* the post-save render now, so the guard went and two honest flags
replaced it: `justSaved`, consumed by the next render, and `hasAbstract`, which is
the whole difference between "submitted" and "updated". A delete clears both, so
a second attempt is congratulated the same way the first was.

### 7.18 A status that existed only to be a button's return value

`withdrawn` was never a state anyone wanted an abstract to be in. It existed
because the console's Withdraw button — the only way to un-accept something —
had to write *some* status, and inventing a fourth one was easier than thinking
about what the abstract had actually become. It had become what it was before the
acceptance: waiting on the committee. So the button is **Return to review**, it
writes `submitted`, and the vocabulary is three states.

Removing a stored value is the part worth writing down, because the obvious move
is wrong. Deleting `'withdrawn'` from the rule's previous-status allowlist would
**freeze any document that still holds it** — its owner could no longer write it,
permanently, because the only path out of a status is an update the rule refuses.
So the retired value stays in that list, labelled as legacy tolerance, while the
line below it still pins what may be *written*.

No migration script either. `submissionStatusLabel` already returned "In review"
for anything it did not recognise — under-claiming was the safe direction when it
was written, and that decision paid for itself here — so a surviving document
displays correctly everywhere and normalises the next time anyone saves it. A
one-off script would have been more risk than the case deserves.

### 7.19 Open rows cannot live in the DOM on a list that re-renders

The review console rebuilds its whole list after every action: accept, reject,
save a review, delete. That was invisible while every card was expanded. Collapse
the rows and it becomes the defining bug — accept one abstract and the row you
were reading slams shut, a hundred times an evening.

So which rows are open is a `Set` of ids held beside `editingId`, updated from
the `toggle` listener and reapplied on render. `editingId` forces its own row
open, because the editor is mounted *inside* the body and a closed row would hide
it completely.

The general shape: **state the user created must not be stored only in nodes you
are about to replace.** The public list has the same disclosures and needs none of
this, because nothing re-renders it except a filter change — where losing the open
rows is correct.

### 7.20 Sorting a review pile: the two decisions that are not obvious

The console's order was whatever Firestore returned — arbitrary, and nobody had
noticed because nobody had tried to read the list as a ranking. Sorting by mean
score raised two questions worth recording, because the wrong answer to either is
quietly harmful rather than visibly broken.

**Within a topic, never across.** `groupByTopic` already grouped the pile because
the committee reviews a topic at a time. Sorting globally would invite comparing
a cognitive 7.4 against a systems 7.6, which compares two panels' scoring habits,
not two abstracts. The implementation is one sort of the flat list *before*
grouping — `groupByTopic` preserves input order, so that orders every group and
nothing has to sort per bucket.

**Unscored abstracts sort last in both directions.** Treating "no score" as a low
score is the obvious implementation and it is wrong: under "lowest first" every
abstract nobody has looked at yet fills the top, and the one the committee
actually rated worst is buried underneath them. Null is not a small number.

Ties break on title, which matters more here than it looks: this list re-renders
after every action, and an unstable comparator would shuffle rows under the
cursor between one click and the next.

### 7.21 The verification gate moved back to submitting — and why that is not a loop

§7.5 moved the gate off submitting and onto the participant list, and §7.6 built
guest submission on top of that. Both are now reversed: `submit.html` requires a
signed-in account with a confirmed address, and `firestore.rules` requires
`isVerified()` on `abstracts` create and update again.

This is a **product decision, not a correction of §7.5.** The reasoning in §7.5
still holds on its own terms — an unproven address does more harm on a public
page than on a submission — but it optimised for the wrong thing. What guest
submission bought was one fewer step before the form. What it cost was a pile of
abstracts attached to accounts nobody had ever opened the mail for: no password,
no verified address, no participant listing, and no reliable way to reach the
submitter about the abstract they had just sent. The organizers reach people by
email, so an address the site has never proved is not a detail.

Read §7.5 and §7.6 as the record of *why the mechanism was possible*, not as
advice to rebuild it. If it comes back, the two things that made it work are
still the hard parts: an account must exist before the write (the uid keys both
the document and the figure path — §7.6 first paragraph), and the "set your
password" mail is what proves the address in one message instead of two.

Three things carried forward from that period rather than being reverted:

- **The abstract id is still the owner's uid** (§7.1). That is orthogonal to who
  may write it.
- **The panel, not the status line** (§7.7). The unconfirmed-address stop on
  `submit.html` is a panel with its own resend button, for exactly the reason
  §7.7 gives: the moment somebody discovers the mail never arrived is right then.
  It is now shown *instead of* the form rather than after a successful save.
- **The token refresh** (`refreshVerification()`). Now that a real gate depends
  on `email_verified` again, the stale-token problem in §4.2 is live again too —
  every page that mounts the form refreshes before deciding anything.

`validateSubmitter`, `looksLikeEmail`, `createSubmitterAccount` and the form's
"Your details" fieldset went with the flow that needed them. They are in the
history if the decision reverses a third time.

### 7.22 Two ways a decorative layer leaked onto a page that had none

Putting photographs behind the home page hero was supposed to be additive: with
no photographs the band must be exactly the flat `--accent-soft` it always was.
Two separate things broke that promise, and both were invisible in the code.

**A `mix-blend-mode` layer with nothing under it still paints.** The burgundy
duotone started life on `.hero-photos`, the container, so that one rule tinted
every slide. That reads well and is wrong: with no slides, `mix-blend-mode:
color` has no backdrop to take luminosity from, so it falls back to the source
colour and lays flat `--accent` over the band at the layer's opacity. An empty
hero came out washed burgundy. The tint belongs to a photograph, so it moved to
`.hero-slide::after` — no slides, no tint, and the case that needs to be perfect
is perfect by construction rather than by arithmetic.

That move needed `isolation: isolate` on the slide. The blend has to reach the
slide's own photograph and stop there, and it is tempting to let the existing
`transform` do it — but the on-screen slide is `transform: none`, which creates
no stacking context at all, so exactly the slide you are looking at would have
bled its tint onto the band underneath.

**`transparent` is not "this colour, invisible".** The legibility veil is
`--accent-soft` fading out at both edges, and over an `--accent-soft` band that
should be a no-op at every stop. It was not: the ends were visibly greyer. The
keyword `transparent` is `rgba(0, 0, 0, 0)` — transparent *black* — so the
gradient interpolated from a pale pink toward black while fading, and left a grey
cast across both ends of a band that had no photographs behind it. Written as
`rgb(from var(--accent-soft) r g b / 0)` the hue is constant and the veil really
does disappear.

Both share a shape worth remembering: **a layer that is meant to be invisible in
the empty case has to be invisible by construction, not by a calculation that
happens to come out to zero.** Neither bug was reachable through the tests —
they are questions about compositing, and only a screenshot answers them.

### 7.23 One photograph, two lists, and who is allowed to delete it

The twelve photographs behind the home page hero are the same twelve that now
open the PINTS 2025 album on the Archive page. Importing them could have copied
the objects; it shares them instead, because they are already downscaled and
already in the bucket and a copy would put the same three megabytes in twice.

Sharing turns a delete into a question about somebody else's page. Three answers
were available:

1. **Copy the bytes on import.** No coupling at all, at the cost of doubling the
   storage and a browser round-trip per photograph — and `fetch`-ing a download
   url back into a blob depends on a bucket CORS configuration nobody has set.
2. **Make the album a live mirror of `config/hero`.** Nothing to import and never
   out of step, but the album is then capped at `HERO.maxPhotos` and no
   photograph can be in it without also being on the home page. That is the
   opposite of what an archive is for.
3. **Share the object and put ownership in its path.** Chosen.

The path prefix *is* the permission. `ownsObject()` returns true only for
`archive/`, so the Archive tab deletes what it uploaded and leaves an imported
`hero/` object and a path-less Dropbox entry alone. That covers one direction
completely and for free.

The other direction is not free, and is the part worth remembering: removing a
photograph from the **hero** already deleted its object on Save, which would have
blanked it on the Archive page — where it is the point rather than a tint. So
`js/admin-hero.js` now reads the albums before deleting and skips anything one
still references. One extra read, and only when something was actually removed.

The general shape: when two features share a resource, the cheap half of the
coupling is the one you can encode in a name, and the expensive half is the one
that needs a lookup. Doing only the cheap half looks symmetric and is not.

### 7.24 The album had no handle to hang on, so it reads the heading

The albums had to land under the right edition inside copy an organizer can
rewrite from the Pages tab. The obvious mechanism — a marker typed into the
markdown — turned out to be unavailable: `PAGE_ALLOWLIST` permits `class` but not
`id`, so the only marker possible is a class name, and a class name somebody has
to remember and spell correctly is one that will eventually be neither.

So the anchor is the content itself. `yearInHeading()` pulls the first four-digit
year out of each `<h2>`, and the album is inserted at the end of that section.
"PINTS 2025" works; so does "The 2025 meeting", which matters because that copy
is editable and nobody editing it will be thinking about this.

The failure mode was chosen deliberately. A heading with no year in it does not
lose its album — the album falls back to the section at the foot of the page,
which is exactly where every album lived before this change. Degrading to the
previous design is a better failure than degrading to nothing, and it is the same
posture the rest of the page takes: no gallery documents, or an unreachable
Firestore, and the Archive page is the page it was.

### 7.25 We built the auth-action page §7.9 refused, because the reason changed

§7.9 weighed hosting Firebase's email action handler and said no: it takes over
the handler for *every* auth email, so it would also have to implement password
reset and email change correctly — more surface, and more to get wrong, for a
benefit a five-minute sweep already delivered. That reasoning was right, and the
sweep is still there.

What changed is that the page stopped being optional. Abstract submission needs a
verified address, and Firebase's default sender
(`noreply@pints-conference.firebaseapp.com`) is a domain PINTS cannot publish DNS
for, so the mail carries no alignment an institutional filter trusts. Measured:
Gmail accepted it, `@ens.psl.eu` quarantined it. The fix is to send as `pints.fr`,
and applying a custom domain in Firebase rewrites **the action links as well as
the From field**. `pints.fr` is GitHub Pages. There is no Firebase handler there.

So the choice was never "handler or sweep". It was "handler, or keep sending mail
that the intended audience's mail servers eat".

Three things fall out of that:

- **All three modes, not one.** §7.9 predicted this exact cost and it is real:
  `sendReset()` is live, so password-reset links land on our page the moment the
  domain is applied. A handler that only knew `verifyEmail` would break password
  reset silently, for everyone, at the instant of a console click. `recoverEmail`
  is there for the same reason — Firebase can send it and we do not get to decline.
- **Ordering, not correctness, is the risk.** The page has to be deployed and
  returning 200 *before* Apply Custom Domain is clicked. Nothing about the code
  can protect against getting that backwards; only the runbook can, which is why
  the README states it as an order rather than a list. It is the same shape as
  the rules-before-code rule.
- **The action URL turned out to be immovable, and the handler is unreachable.**
  See §7.26. The paragraph below describes why the handler sits where it does; it
  is still accurate, but nothing routes to it today.

- **We had to take `/__/auth/action` after all.** The first version put the
  handler at `auth-action.html` and planned to point the template's *customize
  action URL* at it, specifically to avoid depending on `.nojekyll` continuing to
  keep an underscore-prefixed directory publishable — a coupling between a Jekyll
  implementation detail and whether anybody can reset their password.

  That field will not accept it: **it is validated against Firebase Hosting, and
  this project has none.** `pints-conference.web.app` returns "Site Not Found",
  because the site is on GitHub Pages. The console answers *"an error occurs in
  updating the action URL"* and says nothing about why. `pints.fr` was already an
  authorized domain, which is the obvious suspect and the wrong one.

  Standing up a Firebase Hosting site purely to satisfy that validation would add
  a second host to the deployment story for no other benefit. So the action URL
  stays at its default, the custom domain moves it onto `pints.fr`, and
  `__/auth/action/index.html` — a five-line shim forwarding to
  `auth-action.html` with the query intact — answers it.

  The coupling we tried to avoid is therefore real and now load-bearing, which is
  worth stating plainly rather than burying: **if `.nojekyll` is ever removed,
  email verification and password reset both break, silently.** The handler still
  lives in exactly one place; the shim only translates a path we do not control.

The `continueUrl` Firebase echoes back gets `safeContinueUrl()` rather than being
followed. It is the same threat as `?next=` — a value that arrives in a link a
stranger can write and ends in a navigation — so it gets the same answer: resolve
it, require the same origin, then hand the bare filename back to `safeNext()`. Two
gates. The query string is carried into that second check rather than stripped
first, so a URL that is suspicious *because* it has one gets refused instead of
quietly cleaned up and followed.

One thing improved for free. People used to land on a bare Google-branded
confirmation page with no route back — the complaint already written into the
comment on `returnToAccount()`. They now land on a PINTS page that tells them
what just opened up and links to it.

### 7.26 Four hypotheses about one error code, and the one that was right

Moving the confirmation link onto `pints.fr` failed in the console with *"an
error occurs in updating the action URL"*. The underlying API says
`EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`, which is more honest and still not an
explanation. Four readings were tested against the API directly rather than
argued about:

1. **"`pints.fr` is not an authorized domain."** It is. Reading
   `identitytoolkit.googleapis.com/v1/projects?key=…` listed it. Wrong.
2. **"The whole email config is read-only for this project."** Writing the
   existing `callbackUri` back to itself succeeds. The field is writable; the
   *value* is refused. Wrong.
3. **"It must be a Firebase Hosting domain the project owns."** This one had real
   evidence — `web.app` was accepted while `pints.fr` and `pints-fr.github.io`
   were not — and it was wrong too. `auth.pints.fr` was stood up as a Hosting
   custom domain, verified, and issued a certificate. Still refused.
4. **The field accepts only the two URLs Firebase already ships**
   (`<project>.firebaseapp.com/__/auth/action` and the `web.app` equivalent).
   Every other domain and every other path is refused, including other paths on
   the accepted domains. This one survives all the evidence.

Worth keeping, beyond the conclusion:

- **A generic console error deserves the API underneath it.** The console had
  been retried several times on the theory that it was flaky. It was faithfully
  reporting a refusal it had no words for. One `curl` produced a real error code
  and turned the question from "why is this UI broken" into "what does the server
  actually allow" — which is answerable.
- **Hypothesis 3 is why the probe mattered.** It fit every observation available
  at the time and was still false. Building `auth.pints.fr` on it cost a
  subdomain, a Hosting site, and a certificate wait, and none of that was
  necessary. The cheap version — probing the grid of domain × path *before*
  provisioning anything — was available from the start.
- **The chase was worth less than it looked.** The deliverability fix was the
  sender, and that landed early: `noreply@pints.fr`, DKIM-signed, DMARC passing.
  Everything after was the link hostname, a much weaker filter signal. The
  correct stopping point was earlier than where the stopping actually happened.

The handler stays in the tree, unreachable, because the moment this restriction
lifts or the project is upgraded to Identity Platform it works by changing one
field. The README says so where somebody deleting apparent dead code will look.

## 8. Open items

- **Restrict the web API key** and enable App Check (§3.4). Free, console-only.
- **Verify email deliverability from an institutional address** after any sender
  change. Gmail arriving proves the pipeline, not the filters. Since §7.25 the
  test is specific: register from `@ens.psl.eu` and check the raw headers for
  `dkim=pass header.d=pints.fr`, `spf=pass`, `dmarc=pass`.
- **Poster numbers can collide** under concurrent review: `nextPosterNumber()`
  suggests, nothing enforces. Safe for one organizer working sequentially; make
  `publishAbstract` a transaction if review is ever shared.
- **Mailing-list sending** is not built; CSV export stands in. Real sending needs
  a paid plan.
- **`pints.fr` is live** on GitHub Pages, and its DNS at GoDaddy is now also
  what makes verification mail deliverable (§7.25). The zone had no MX, SPF or
  DMARC record before that work; DMARC starts at `p=none` and wants tightening to
  `p=quarantine` once the reports come back clean.
- **The logo's grey is now `#5c5c5c`** (was the designer's `#808080`). With
  `.hero::after` at `.78` the date line reads 4.4:1 against a black pixel and
  4.9:1 over a mid-tone, so it clears AA over any real photograph and sits just
  under it in the worst case. `.80` crosses 4.5:1 outright. See "A note on the
  logo's grey" in the README.
