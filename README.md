# PINTS conference website

Static site for the PINTS meeting (Paris Île-de-France Neuroscience, Theory, and
Systems). No build step: the repository contents *are* the deployed site.

- **Live site:** <https://neoneuron.github.io/pints/>
- **Design notes and lessons:** [`docs/design-notes.md`](docs/design-notes.md) —
  start here if you are picking this up. Why the architecture is what it is, and
  the traps that cost time the first time round.
- **Design spec:** `docs/superpowers/specs/2026-07-29-pints-website-design.md`
- **Implementation plan:** `docs/superpowers/plans/2026-07-29-pints-website.md`

## Status

**Phase 0 (static site) is complete and deployed** at
<https://neoneuron.github.io/pints/>. Every page and asset serves, markdown
renders, the custom 404 works, and the browser console is clean.

**All three phases are built, deployed, and live.** Every requirement in
`CLAUDE.md` is implemented except the bonus mailing-list *sending*, which needs a
paid Firebase plan; the CSV export stands in for it.

- **Accounts** — sign up, sign in, password reset, email verification. Registering
  puts you on the public participant list; there is no separate opt-in.
- **Abstracts** — as many submissions per person as you like, each with a topic
  (cognitive / systems / computational), an optional figure, a live preview, and
  an opt-out from being considered for a talk. Admin review with private notes,
  poster-vs-talk assignment, poster numbering, accept/reject/unpublish. Public
  list with search and a topic filter.
- **Pages** — organizers edit page copy in the admin console; edits live in
  Firestore and `content/*.md` remains the seed and the read fallback. See
  "Editing page content".
- **Schedule** — admin editor for a single-day program, ordered by start time;
  public program page headed by the meeting date from Settings.
- **Settings** — set the meeting date, open/close the submission window, set the
  deadline, grant admin rights. No Firebase-console workarounds remain for
  day-to-day organizing.
- **Organizer edit and delete** — organizers can correct a participant's name or
  affiliation, edit any abstract at any status, and delete an abstract or a
  participant outright. See "Editing and deleting as an organizer".

71 security-rules tests and 78 unit tests cover this.

### Deploying rules — order matters

**`firestore.rules` and `storage.rules` must be deployed *before or with* the
code that depends on them.** Pushing a page that reads a new collection while the
old ruleset is live gives users "Missing or insufficient permissions" even though
the emulator tests pass. After changing rules:

```bash
npm run test:rules
npx firebase deploy --only firestore:rules,storage
```

The site content is still placeholder: the edition dates, venue, keynote, and
organizer contacts all need filling in via `content/*.md`.

## Editing page content

**The easy way: sign in as an organizer, open `admin.html` → Pages, pick a page,
edit the markdown, and press "Save and publish".** The change is live on reload.
No GitHub account, no commit.

Edits are stored in Firestore under `pages/{slug}`, and that is the only place
the site writes. The `content/*.md` files stay in the repository as the seed and
the read fallback: a page nobody has edited on the site is served from its file,
and so is a page whose Firestore read fails.

Editing the `.md` file on GitHub still works, but **it has no effect on a page
that has been edited through the admin console** — the Firestore copy wins from
the first save onwards, permanently. If you have been editing on the site, edit
on the site. To go back to the committed text, open `content/<page>.md`, copy it
into the editor, and save; deleting `pages/{slug}` in the Firebase console does
the same thing.

| File | Slug | Appears on |
|---|---|---|
| `content/home.md` | `home` | `index.html` |
| `content/about.md` | `about` | `about.html` |
| `content/venue.md` | `venue` | `venue.html` |
| `content/previous-editions.md` | `previous-editions` | `previous.html` |
| `content/poster-guidelines.md` | `poster-guidelines` | `abstracts.html` |

The list of editable pages is `PAGES` in `js/config.mjs`; adding a page means
adding an entry there and a `data-page` attribute on the host element.

Markdown supports headings, lists, links, tables, bold, and italic. It is
sanitized before rendering, so raw HTML and scripts are stripped.

## Editing and deleting as an organizer

Deletion is the one operation that does not run in the browser, because two
things make it impossible there: a Firebase Auth account can only be deleted by
its owner from a client, and `storage.rules` scopes figure deletion to the
uploader. Both need the Admin SDK, so `functions/` holds two callables:

| Callable | Removes |
|---|---|
| `deleteAbstractCompletely` | the abstract, its published copy, its reviewer note, its figure |
| `deleteParticipant` | all of the above for every abstract they own, their profile, their public listing, and their login |

`deleteParticipant` refuses to delete you, and refuses to delete another
organizer — revoke their admin rights in Settings first. The Participants tab
does not offer the button in either case, so the refusal is a backstop rather
than the first line of defence.

**The site works without them.** Every page loads and every other feature works
if the functions are never deployed; the two delete buttons report that the
service is missing when pressed. Deploy them with:

```bash
cd functions && npm install
npx firebase deploy --only functions
```

They deploy to `europe-west1`, not the `us-central1` default, so participant
names and email addresses stay in the EU. `js/functions.js` names the same
region — **if you change one, change both**, or every call fails as an opaque
CORS error.

Cloud Functions need the Blaze plan. Nothing else on the site does.

### Editing

**Abstracts.** The Abstracts tab has an Edit button per card, which opens the
submission form inline. Any abstract at any status can be edited. Saving an
**accepted** one rewrites `abstracts_public` in the same batch, so the public
list cannot go stale.

That last point is load-bearing and is enforced by construction: the form unlocks
an accepted abstract only when the caller supplies `republish`, the payload
carrying its type and poster number. The admin console supplies it; `account.html`
does not, so a submitter — *including an organizer looking at their own accepted
abstract* — still sees it read-only. Never key that exemption on "is an admin":
it would unlock the account page, where nothing rewrites the public copy.

Organizers cannot replace somebody else's **figure**, because `storage.rules`
keys uploads to the uploader's uid and cannot read Firestore to learn who is an
organizer. The form shows the figure and says so.

**Participants.** The Participants tab has an Edit button per row for the name
and affiliation, written through the same `saveProfile()` the account page uses,
so `users/{uid}` and `participants_public/{uid}` move together.

The **email is not editable**: it belongs to the Firebase Auth login, and
changing only the Firestore copy would leave the two disagreeing about who the
person is.

Organizers can be edited but not deleted — revoke their rights in Settings
first.

## Local development

```bash
npm install
npm run vendor      # refresh vendor/ after upgrading marked or dompurify
npm run serve       # http://127.0.0.1:4173
npm test            # pure-function unit tests
npm run test:rules  # Firestore rules tests (needs Java)
npm run emulators   # Firestore, Auth, Storage and Functions emulators
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

### The web API key in `js/firebase-config.js` is public on purpose

GitHub's secret scanner flags it as a "Google API Key". It is not a credential,
and it must not be hidden:

- **It cannot be hidden.** The browser has to receive it to reach Firebase, so it
  ends up in the served JavaScript and the Network tab no matter where it is
  stored. Injecting it from a GitHub Actions secret changes where it lives, not
  whether it is public — and it would force a build step this project
  deliberately does not have.
- **It does not grant access.** It identifies the project. Authorization is
  `firestore.rules`, covered by 58 emulator tests and verified against
  production: an anonymous caller holding this exact key gets
  `PERMISSION_DENIED` on `users`, `admins`, `abstracts`, and `abstract_reviews`,
  and can read only what is public by design.

**What the exposure does cost you is quota, not data.** An unrestricted key lets
anyone drive Identity Toolkit and Firestore calls against this project — mass
signup attempts, password-reset floods, read loops. On Spark that means hitting a
daily cap and denying service to real participants.

Two free mitigations, neither yet applied (checked 2026-07-30: the key answers
`curl` with no `Referer` at all, so it currently has no restrictions):

1. **Restrict the key** — Google Cloud console → *APIs & Services →
   Credentials* → the browser key. Set *Application restrictions* to **HTTP
   referrers** and allow `neoneuron.github.io/*` (plus `localhost` for local
   work). Under *API restrictions*, limit it to the APIs actually used:
   Identity Toolkit, Cloud Firestore, Token Service. Test sign-in afterwards —
   an over-tight list breaks auth.
2. **Enable App Check** with reCAPTCHA v3 (free) and enforce it on Firestore, so
   requests must come from your real site rather than a script holding the key.

If the scanning alert is noisy, dismiss it as a false positive rather than
rotating the key — rotation changes the string without changing what it can do.

### One-time setup

1. <https://console.firebase.google.com> → **Add project**, name it
   `pints-conference`. Analytics off. **The project must be on the Blaze
   (pay-as-you-go) plan**, because abstract figures are stored in Cloud Storage
   and Storage is not available on Spark. Everything else here stays inside the
   free allowance; set a budget alert of a few euros so a surprise is impossible.
   **Do not enable Cloud Functions** — nothing in this site needs them, and they
   would break the "no server" property the whole design rests on.
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
6. **Build → Storage → Get started.** This is the step that needs Blaze. Accept
   the default bucket; `storage.rules` locks it down to `abstract_figures/{uid}/`.
7. Deploy the rules: `npx firebase login && npx firebase use --add` (pick the
   project), then `npx firebase deploy --only firestore:rules,storage`.
8. In Firestore, create collection `config`, document ID `site`, with fields
   `submissionsOpen` (boolean), `submissionDeadline` (timestamp), `eventDate`
   (string, `YYYY-MM-DD`), and `edition` (string, `pints2026`). The abstract
   rules call `get()` on this document; if it is missing, the rule errors and
   denies every submission.

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

There are two real fixes. Both make the mail pass SPF/DKIM/DMARC, which is what
institutional filters actually check.

#### Option A — send through a Gmail account (no domain needed)

Mail genuinely originates from Gmail, DKIM-signed by Google for `gmail.com`, so
it passes DMARC. This is the only legitimate way to have a `@gmail.com` sender:
**you cannot simply set the From field to a Gmail address.** Firebase's
custom-domain flow verifies ownership through DNS records, and nobody can add
records to `gmail.com`. Claiming a Gmail From without sending through Gmail
fails DMARC alignment and is treated *worse* than the current default.

1. **Upgrade to Firebase Authentication with Identity Platform** —
   Firebase console → **Authentication → Settings**. Custom SMTP is an Identity
   Platform feature. On Spark this stays free but caps at **3,000 daily active
   users**; a one-day meeting is nowhere near that. Google documents no
   downgrade path, so treat the upgrade as one-way.
2. **Generate a Gmail app password** — <https://myaccount.google.com> →
   **Security**. 2-Step Verification must be on, then **App passwords** → create
   one for Mail. It is a 16-character string.
3. **Configure custom SMTP** — Firebase console → **Authentication → Templates**
   (or Google Cloud console → Identity Platform → Settings → Email):
   | Field | Value |
   |---|---|
   | Sender email | the Gmail address |
   | Host | `smtp.gmail.com` |
   | Port / security | `465` with SSL, or `587` with START_TLS |
   | Username | the same Gmail address |
   | Password | the app password from step 2 |
4. Set **Sender display name** to `PINTS Conference`, and **Reply-to** to
   whichever address should receive replies.

Caveats: a consumer Gmail account is limited to roughly **500 messages a day**,
which is ample here. The app password grants permission to send mail as that
account — paste it only into the Firebase console, never into the repository,
and revoke it from the Google account page if the organizer changes.

#### Option B — send from a domain PINTS controls

Better long-term, and looks more official than a personal Gmail on the From
line. Per [Firebase's custom-domain guide](https://firebase.google.com/docs/auth/email-custom-domain):

1. **Authentication → Templates**, click the edit icon on a template, then
   **customize domain**.
2. Enter the domain (e.g. `pints.example.org`).
3. Add the **TXT** and **CNAME** records Firebase displays, at the registrar.
   **Only one `v=spf1` TXT record is allowed per domain** — if the domain
   already has one, merge the values into it rather than adding a second.
   Adding a second silently breaks SPF for *all* mail from that domain.
4. Wait for verification, up to 24 hours. The Templates page shows a green
   "Verification complete".
5. Click **Apply Custom Domain**.

Prerequisites: a domain PINTS owns, and someone able to edit its DNS. A
freshly-registered domain also starts with no sender reputation, which some
filters weigh.

**Whichever option you pick, re-run the deliverability test from an
`@ens.psl.eu` address before announcing that submissions are open.** Neither
option guarantees every institutional filter accepts the mail.

**Unblocking one person in the meantime:** Firebase console →
**Authentication → Users**, find them, and mark the address verified.

### Making someone an organizer

1. **Authentication → Users** — find the person and copy their UID.
2. **Firestore → `admins`** — add a document whose **ID is that UID**, with
   fields `email` (string), `addedBy` (string), `addedAt` (timestamp).

The first admin must be created this way. After that, admins can add each other
from the admin console (Phase 3).
