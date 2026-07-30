# PINTS Conference Website — Design Spec

**Date:** 2026-07-29
**Status:** Approved

## Context

PINTS (Paris Île-de-France Neuroscience, Theory, and Systems) runs on
`pints2025.sciencesconf.org`, a hosted platform the organizers don't control. Schedules are posted
as spreadsheet screenshots, there is no abstract submission flow, and every content change goes
through sciencesconf's UI.

This spec describes a replacement: a static site on GitHub Pages backed by Firebase Auth and
Firestore, giving organizers a site they own, an admin console for schedule and abstracts, and a
real submission system.

## Requirements

From `CLAUDE.md`. Items 1–6 are in the first release; item 7 is deferred.

1. (priority) Login for registered participants and admins, with different rights
2. (priority) Abstract submission system
3. Names of registered people
4. Schedules that are easy to add/edit — better than an Excel screenshot
5. Poster list with abstracts
6. Standalone pages editable in human-friendly markdown
7. (bonus) Mailing list management — **deferred**

Confirmed with the user: text-only abstracts on Firebase's free Spark plan; hybrid content model
(static pages in the repo, structured data in Firestore); open signup with opt-in public name
listing.

## Stack

Plain HTML/CSS/JS ES modules, **no build step**, multi-page, GitHub Pages from `main` at root,
Firebase Auth + Firestore via the modular CDN SDK (v12.16.0).

[`jmourabarbosa/compneuroparis`](https://github.com/jmourabarbosa/compneuroparis) (parisneuro.fr —
same community) is the direct precedent: no build step, GitHub Pages, Firebase Auth/Firestore, and
an `admins` collection driving role-based security rules. We build a fresh repo and borrow its
proven patterns rather than forking:

- Pure-function logic in `.mjs` modules, unit-tested with `npm test`; DOM and Firebase glue kept in
  thin `.js` page controllers. This is what makes "no build step" still verifiable.
- `admins/{uid}` registry + `exists()` checks in rules, bootstrapped manually from the console.
- "Remember me on this device" auth persistence toggle.

Departure from compneuroparis: **multi-page `.html` files, not SPA hash routing.** GitHub Pages has
no rewrites, real URLs are better for a conference people find via search, and organizers can edit
one page without touching the rest. This is what `gnt20.github.io` does.

## Constraint 1 — no Cloud Storage, no Cloud Functions

As of February 2026, Cloud Storage is no longer on the Spark plan; it requires Blaze and a credit
card. Firestore, Auth, and Auth's verification emails remain free.

The design therefore uses **no Cloud Storage and no Cloud Functions**: abstracts are structured
text, posters are physical A0 (per the 2025 site) so nothing needs hosting, and the mailing list
degrades to an admin CSV export. Nothing in the first release requires billing.

## Constraint 2 — rules cannot filter fields

Firestore security rules make reads all-or-nothing per document. There is no way to expose some
fields of a document publicly and hide others. Three requirements collide with this: the public
name list, public abstracts, and admin-only review notes.

The fix is **separate public projection collections** written alongside the private originals. This
is the load-bearing piece of the design; field-level rules do not exist and must not be attempted.

Projections and `schedule` need `allow read: if true` — that is `get` **and** `list`, since the
participants, abstracts, and program pages all issue collection queries and a `get`-only rule denies
them. What to avoid is rules that validate `request.query.limit`/`orderBy`; at this scale they buy
nothing.

To avoid composite-index setup, list pages fetch the current edition and sort client-side through
tested pure functions rather than using `orderBy` with an equality filter.

## Data model

Single Firestore database. `CURRENT_EDITION` (e.g. `"pints2026"`) is a constant in `js/config.mjs`,
stamped on every edition-scoped document, so next year is a config change rather than a migration.

| Collection | Contents | Read | Write |
|---|---|---|---|
| `users/{uid}` | Private profile: `email`, `displayName`, `affiliation`, `showPublicly`, `edition`, `consentAt`, timestamps | owner + admin | owner (field allowlist), admin |
| `participants_public/{uid}` | Public projection: `displayName`, `affiliation`, `edition`, `updatedAt` | public | owner only, field allowlist + length caps |
| `abstracts/{uid}` | Private submission: `ownerUid`, `edition`, `title`, `authors[]`, `affiliations[]`, `body` (markdown), `type`, `status`, timestamps | owner + admin | owner **only while `status == "submitted"`**, admin always |
| `abstracts_public/{uid}` | Public projection of accepted abstracts + `posterNumber`, `acceptedAt` | public | admin only |
| `abstract_reviews/{uid}` | Admin-only notes and decisions — a separate document precisely because rules cannot hide a field from the owner | admin | admin |
| `schedule/{itemId}` | `edition`, `day`, `start`, `end`, `title`, `speaker`, `affiliation`, `kind`, `location`, `abstractUid?`, `order` | public | admin |
| `config/site` | `submissionsOpen`, `submissionDeadline`, `edition` | public | admin |
| `admins/{uid}` | `email`, `addedBy`, `addedAt` | own document (so the client knows to show admin UI) + admins | admin |

### Abstract document ID is the owner's UID

`abstracts/{uid}` rather than `abstracts/{autoId}`: one abstract per registered participant, which
matches how a one-day meeting with a poster session actually works. This buys real simplification —
the owner reads their submission with a direct `get` instead of a query, so no `list` permission is
needed on the private collection at all, and "one submission per person" is enforced by the data
model rather than by validation.

If multiple submissions per person are ever needed, the migration is to `abstracts/{autoId}` with
`allow list: if resource.data.ownerUid == request.auth.uid`, and client queries constrained by
`where("ownerUid", "==", uid)`.

### Consent handling — deliberately without a `get()`

`participants_public/{uid}` is written directly by the owner's browser when they tick "show my name
publicly", and deleted when they untick it. Rules validate ownership, a strict key allowlist, and
string lengths — but deliberately **do not** `get()` the user's `showPublicly` flag.

Updating `users/{uid}` and creating `participants_public/{uid}` in one `writeBatch` would fail such
a check, because `get()` in rules reads pre-batch committed state. And the check buys no
confidentiality: a user can only ever publish their own name. The existence of the public document
*is* the consent record.

### Freezing an abstract on acceptance

Rules allow the owner to update or delete `abstracts/{uid}` **unless `status == "accepted"`**.
Without this, two silent leaks appear: an owner editing after acceptance leaves
`abstracts_public/{uid}` showing a stale title and body, and an owner withdrawing after acceptance
leaves the public copy up forever. Post-acceptance changes and withdrawals go through the admin
console, which updates both documents together.

The freeze covers `accepted` **only**. Freezing every non-`submitted` status would trap a rejected
participant with a document they can neither revise, delete, nor replace — the document ID is their
UID, so there is no second slot — for the rest of the edition, even with weeks left before the
deadline. `rejected` and `withdrawn` stay editable, and an edit resets the status to `submitted`.

### Submission window

Abstract create and update require `get(/config/site).data.submissionsOpen == true` **and**
`request.time < get(/config/site).data.submissionDeadline`. Both are checked, so a forgotten toggle
still closes submissions on time. One extra document read per submission write, which is the correct
place to spend it. `config/site` must exist before any submission is attempted or the rule errors
and denies.

### Spam surface

Abstract creation requires `request.auth != null && request.auth.token.email_verified == true`.
Unlike compneuroparis's public-create `submissions` collection, nothing here is writable
anonymously — the requirement already scopes submission to registered participants, so this removes
the spam surface for free.

**Token-refresh gotcha:** `request.auth.token.email_verified` comes from the ID token, which is
*not* updated when the user clicks the verification link — it stays `false` until the token
refreshes (~1h). The classic symptom is "user verifies, submits, gets `PERMISSION_DENIED`, and it
fixes itself an hour later." On the verification return and on `account.html` load, call
`await user.reload()` then `await user.getIdToken(true)` before enabling the submit path.

## Repository layout

```
/  (GitHub Pages: main branch, root)
├── .nojekyll                    # required the moment any path starts with _
├── index.html  about.html  venue.html  program.html
├── abstracts.html  participants.html
├── login.html  account.html  admin.html  404.html
├── content/                     # markdown, edited via GitHub's web editor
├── css/styles.css
├── js/
│   ├── config.mjs               # CURRENT_EDITION, nav, limits
│   ├── firebase-config.js       # public API key — not a secret; rules are the boundary
│   ├── firebase.js  auth.js  db.js  layout.js  markdown.js
│   ├── page-*.js                # one thin controller per page
│   └── *-utils.mjs              # pure, unit-tested
├── vendor/                      # marked.esm.js + purify.es.mjs, committed
├── assets/
├── test/                        # *.test.mjs + test/rules/
├── scripts/vendor.mjs
├── firestore.rules  firebase.json
├── package.json                 # devDependencies only
└── README.md                    # admin bootstrap + deploy runbook
```

**All paths are relative** (`css/styles.css`, `js/…`, `content/about.md`, nav `href`s, and the
`fetch()` calls for markdown) — never leading-slash absolute. If the repo is named `pints`, Pages
serves it from `<owner>.github.io/pints/` and every absolute path 404s. All HTML lives at the repo
root at one depth, so relative paths work unchanged whether the site ends up under a subpath, at
`<org>.github.io`, or on a custom domain.

Shared nav and footer are injected by `js/layout.js` from a single definition in `config.mjs`.
Per-page `<title>`, `<h1>`, and meta description stay as real HTML in each file so search engines
see actual content.

Markdown is rendered client-side with **vendored** `marked` and `DOMPurify` committed under
`vendor/` — no CDN dependency at runtime, no build step. Repo-authored markdown renders with the
default allowlist; **user-submitted abstract bodies render through a tight allowlist**
(`p`, `br`, `em`, `strong`, `sup`, `sub`, `a`) because that path is untrusted input.

## Pages

- **index.html** — hero, dates, venue, keynote lineup, sponsors, CTA. Body from `content/home.md`.
- **about.html / venue.html** — markdown from `content/`.
- **program.html** — schedule from Firestore grouped by day, sorted by start time then `order`.
- **abstracts.html** — accepted abstracts from `abstracts_public`, client-side search by
  title/author/keyword, poster numbers, A0-portrait guideline note.
- **participants.html** — opted-in names and affiliations, sorted by last name.
- **login.html** — sign up, sign in, password reset, resend verification, "remember me".
- **account.html** — profile and public-listing consent; submit, edit, withdraw own abstract;
  submission status and deadline.
- **admin.html** — tabbed console: abstract review (accept/reject/notes, poster numbers, publish
  projection, edit or withdraw an already-accepted abstract updating both documents), schedule
  editor, participant list, site config, CSV export of consented emails.

## Phases

Each phase ends deployable and verifiable on its own.

- **Phase 0 — Scaffold and static site.** Repo, `.nojekyll`, CSS, nav injection, vendored markdown
  renderer, all public static pages with seed content. No Firebase. Satisfies requirement 6.
- **Phase 1 — Auth, profiles, participants.** Firebase project (Spark), authorized domains,
  signup/login/reset/verify, `users` + `participants_public`, consent, participants page,
  `firestore.rules` with its emulator test suite, first admin bootstrapped by hand.
- **Phase 2 — Abstract submission.** Submit/edit/withdraw, validation module, admin review console,
  `abstract_reviews`, publish to `abstracts_public` on accept, public abstracts page, CSV export.
- **Phase 3 — Schedule.** Admin schedule editor and program page.
- **Phase 4 — Deferred.** Mailing list sending (needs Blaze + Trigger Email). Optional hardening:
  Firebase App Check (reCAPTCHA v3, free).

## Verification

**Unit tests** — `npm test` runs `node --test`, no framework, no build: `schedule-utils`,
`abstract-validation-utils`, `markdown-render-utils` (the untrusted allowlist strips `<script>`,
`onerror=`, `javascript:` URLs), `participant-utils`, `csv-utils` (quoting, injection-safe leading
`=+-@`), `nav-utils`.

**Security rules tests** — `npm run test:rules` against the Firestore emulator using
`@firebase/rules-unit-testing` (needs Java). Every case asserts both allow and deny; see the
implementation plan for the full list.

**Manual end-to-end** — sign up → verify → **submit an abstract in the same session without
re-logging in** (the token-refresh regression) → complete profile → tick public listing → confirm
the name appears → untick → confirm it disappears → confirm the submitted abstract is not public →
admin accepts → confirm it appears with a poster number → confirm the owner can no longer edit it →
admin withdraws it → confirm it disappears → admin adds schedule items → confirm the program renders
them grouped by day.

**Deploy checks** — Pages serves from `main` root; `.nojekyll` present; Auth authorized domains
include the live host; `firebase deploy --only firestore:rules` from the committed `firestore.rules`;
browser console clean on every page.

## Notes

- The Firebase web API key is committed and public by design — it identifies the project, it is not
  a credential. All authorization lives in `firestore.rules`.
- Seed content is adapted from the 2025 site as placeholders (speakers, sponsors DIM C-Brains /
  QLife / Aquineuro, A0-portrait poster rule, logo credit to majab.com). Organizers replace it by
  editing `content/*.md`.
- **Open input:** the target edition's dates and venue, and whether a PINTS GitHub org or custom
  domain already exists.
