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

**All three phases are built, deployed, and live.** Every requirement in
`CLAUDE.md` is implemented except the bonus mailing-list *sending*, which needs a
paid Firebase plan; the CSV export stands in for it.

- **Accounts** — sign up, sign in, password reset, email verification, opt-in
  public listing, participant list.
- **Abstracts** — submission with live preview, edit, withdraw; admin review with
  private notes, poster numbering, accept/reject/unpublish; public list with search.
- **Schedule** — admin editor grouped by day; public program page.
- **Settings** — open/close the submission window, set the deadline, grant admin
  rights. No Firebase-console workarounds remain for day-to-day organizing.

58 security-rules tests and 56 unit tests cover this.

### Deploying rules — order matters

**`firestore.rules` must be deployed *before or with* the code that depends on
it.** Pushing a page that reads a new collection while the old ruleset is live
gives users "Missing or insufficient permissions" even though the emulator tests
pass. After changing rules:

```bash
npm run test:rules
npx firebase deploy --only firestore:rules
```

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

### Caching after a deploy

GitHub Pages serves assets with `cache-control: max-age=600`, so a returning
visitor can run up to ten minutes of stale JavaScript after a push. It
self-heals; just don't conclude a fix failed within that window.

One asymmetry is worth knowing when testing: a hard reload revalidates the
document and its **statically** imported modules, but a runtime
`await import(...)` is an ordinary fetch that honours the HTTP cache, so a
dynamically imported module can stay stale *through* a hard reload. Prefer a
static import for anything a page always needs. The admin console's tab modules
are still dynamic — that lazy loading is deliberate, since only one tab is
opened at a time — so when testing an admin tab, confirm with
`fetch(url, {cache:'reload'})` rather than trusting a hard reload.

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

### Verification emails and institutional mail filters

Abstract submission requires a verified email address, enforced in
`firestore.rules` via `request.auth.token.email_verified`.

**Known problem.** Firebase sends from `noreply@pints-conference.firebaseapp.com`.
That domain has no SPF/DKIM alignment an institutional mail server trusts, so
university filters routinely quarantine it. Tested 2026-07-29: a Gmail address
received the message and verified successfully; an `@ens.psl.eu` address did
not. The Firebase pipeline itself is fine — this is recipient-side filtering,
and it will vary institution by institution.

Two mitigations are already in place:

- The unverified banner on `account.html` names the cause and points at the spam
  or quarantine folder, and shows the error code if a resend fails.
- Organizers are exempt from the gate, because `firestore.rules` already grants
  admins `allow write: if isAdmin()` on abstracts. An organizer is never locked
  out of their own submission by undelivered mail.

**The real fix: send from a domain PINTS controls.**
Per [Firebase's custom-domain guide](https://firebase.google.com/docs/auth/email-custom-domain):

1. **Authentication → Templates**, click the edit icon on a template, then
   **customize domain**.
2. Enter the domain (e.g. `pints.example.org`).
3. Add the **TXT** and **CNAME** records Firebase displays, at the registrar.
   **Only one `v=spf1` TXT record is allowed per domain** — if the domain
   already has one, merge the values into it rather than adding a second.
4. Wait for verification, up to 24 hours. The Templates page shows a green
   "Verification complete".
5. Click **Apply Custom Domain**.

Prerequisites: a domain PINTS owns, and someone able to edit its DNS. After
applying, re-run the deliverability test from an institutional address before
announcing submissions — a custom domain improves the odds substantially but
does not guarantee every filter accepts it.

**Unblocking one person in the meantime:** Firebase console →
**Authentication → Users**, find them, and mark the address verified.

### Making someone an organizer

1. **Authentication → Users** — find the person and copy their UID.
2. **Firestore → `admins`** — add a document whose **ID is that UID**, with
   fields `email` (string), `addedBy` (string), `addedAt` (timestamp).

The first admin must be created this way. After that, admins can add each other
from the admin console (Phase 3).
