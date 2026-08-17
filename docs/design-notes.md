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

Roughly 56 unit tests and 58 security-rules tests.

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

### 3.3 No build step

Which means: all paths relative, dependencies vendored, no environment-variable
injection, no minification, no transpilation. See §4.3 for the two places this
bites.

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
and queries constrained by `where("ownerUid", "==", uid)`.

## 7. Open items

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
