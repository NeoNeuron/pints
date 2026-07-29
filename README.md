# PINTS conference website

Static site for the PINTS meeting (Paris Ile-de-France Neuroscience, Theory, and
Systems). No build step: the repository contents *are* the deployed site.

- **Live site:** <https://neoneuron.github.io/pints/>
- **Design spec:** `docs/superpowers/specs/2026-07-29-pints-website-design.md`
- **Implementation plan:** `docs/superpowers/plans/2026-07-29-pints-website.md`

## Status

**Phase 0 (static site) is complete and deployed** at
<https://neoneuron.github.io/pints/>. Every page and asset serves, markdown
renders, the custom 404 works, and the browser console is clean.

**Phase 1 (accounts) is built and deployed** — sign up, sign in, password reset,
email verification, the account page with opt-in public listing, and the
participant list. Its security rules are covered by 32 emulator tests. It is
**dormant until the Firebase project is created**: see the Firebase section
below. Until then the account pages say so plainly rather than erroring.

Phases 2–3 — abstract submission and review, and the schedule editor — are
specified in the plan but not yet built.

The site content is still placeholder: the edition dates, venue, keynote, and
organizer contacts all need filling in via `content/*.md`.

## Editing page content

Page copy lives in `content/*.md`. Edit the file on GitHub, commit, and the
change is live within a minute. No other step.

| File | Appears on |
|---|---|
| `content/home.md` | `index.html` |
| `content/about.md` | `about.html` |
| `content/venue.md` | `venue.html` |
| `content/poster-guidelines.md` | `abstracts.html` (from Phase 2) |

Markdown supports headings, lists, links, tables, bold, and italic. It is
sanitized before rendering, so raw HTML and scripts are stripped.

## Local development

```bash
npm install
npm run vendor      # refresh vendor/ after upgrading marked or dompurify
npm run serve       # http://127.0.0.1:4173
npm test            # pure-function unit tests
npm run test:rules  # Firestore rules tests (Phase 1 onward; needs Java)
```

`npm test` must pass before every commit.

## Architecture

- Multi-page static HTML at the repository root. Each page has a real `<title>`
  and `<h1>`; the header, nav, and footer are injected by `js/layout.js` from the
  single `NAV` definition in `js/config.mjs`.
- Pure logic lives in `js/*-utils.mjs` and is unit-tested under Node. DOM and
  Firebase glue lives in `js/page-*.js`.
- `marked` and `DOMPurify` are **vendored** into `vendor/` by `npm run vendor`,
  so the browser imports them as local files. There is no CDN dependency at
  runtime and no bundler.
- **All paths are relative.** Never write a leading-slash path: the site may be
  served from `<owner>.github.io/pints/`, where absolute paths would 404.
  **The single exception is `404.html`**, which Pages renders at the *requested*
  URL rather than at the site root — relative paths there would resolve against
  the bad URL. It is therefore self-contained, with inline CSS and a `<base>`
  tag. If the site ends up on a subpath, that `<base href="/">` is the one line
  that must change, to `/<repo-name>/`.

## Deployment

GitHub Pages serves the `main` branch from the repository root. Pushing to
`main` deploys. `.nojekyll` must stay in place — without it, Pages runs Jekyll,
which drops any path beginning with an underscore and would transform
`content/*.md` instead of serving it raw for the client-side renderer.

**If the site URL ever changes** — moving to a PINTS org, or attaching a custom
domain — `404.html`'s `<base href="/pints/">` must change to match. Nothing will
appear broken: the 404 page still renders, its links just point at the wrong
path. Verifying a deliberately bogus URL is therefore part of any such move.

## Firebase

**Not yet created.** The accounts code is written, deployed, and its security
rules are tested — but until the steps below are done, every account page shows
"Accounts are not switched on yet" instead of failing with an SDK error.

`firestore.rules` is the **only** authorization boundary: the site is a static
page with no server in front of it, so anything the rules do not forbid is
permitted to anyone on the internet. Change it only alongside its tests.

### One-time setup

1. <https://console.firebase.google.com> → **Add project**, name it
   `pints-conference`. Analytics off. **Stay on the Spark (free) plan — do not
   enable Cloud Storage or Cloud Functions.** Both require Blaze and a credit
   card, and nothing here needs them.
2. **Build → Firestore Database → Create database → Production mode**, location
   `eur3 (europe-west)`.
3. **Build → Authentication → Get started → Sign-in method → Email/Password →
   Enable.** Leave "Email link" off.
4. **Authentication → Settings → Authorized domains → Add domain** →
   `neoneuron.github.io`. Add `localhost` and `127.0.0.1` too, for local work.
   *Skipping this makes every sign-in fail with `auth/unauthorized-domain`.*
5. **Project settings → General → Your apps → Web (`</>`)**, register the app,
   copy the `firebaseConfig` object, and paste it over the placeholders in
   `js/firebase-config.js`. That file is public by design — the web API key
   identifies the project, it is not a credential.
6. Deploy the rules: `npx firebase login && npx firebase use --add` (pick the
   project), then `npx firebase deploy --only firestore:rules`.
7. In Firestore, create collection `config`, document ID `site`, with fields
   `submissionsOpen` (boolean), `submissionDeadline` (timestamp), and `edition`
   (string, `pints2026`). Phase 2's rules call `get()` on this document; if it
   is missing, the rule errors and denies every submission.

### Making someone an organizer

1. **Authentication → Users** — find the person and copy their UID.
2. **Firestore → `admins`** — add a document whose **ID is that UID**, with
   fields `email` (string), `addedBy` (string), `addedAt` (timestamp).

The first admin must be created this way. After that, admins can add each other
from the admin console (Phase 3).
