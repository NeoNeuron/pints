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

- **Accounts** — a registration page that takes a name, an affiliation and an
  email, a separate sign-in page, password reset, and email verification.
  Confirming the address is what puts you on the public participant list: there
  is no opt-in, and no button. See "Registering and being listed".
- **Abstracts** — **one per participant**, with a topic (cognitive / systems /
  computational), a **required figure and caption**, a live preview, and an
  opt-out from being considered for a talk. **No account needed to submit** —
  `submit.html` creates one from the email on the form. Admin review with a
  per-organizer 1–10 score and private note, filters (text, status, talk/poster,
  talk opt-out, topic), two CSV exports, poster-vs-talk assignment, poster
  numbering, accept/reject/unpublish. Public list with search and a topic filter.
- **Pages** — organizers edit page copy in the admin console; edits live in
  Firestore and `content/*.md` remains the seed and the read fallback. See
  "Editing page content".
- **Schedule** — admin editor for a single-day program, ordered by start time;
  public program page headed by the meeting date from Settings. An item may be
  tagged with a *session* (the three abstract topics, plus Keynote Lectures);
  consecutive items sharing one are printed as a tinted block under a banner —
  "Session II — Computational Neuroscience" — numbered by where it falls in the
  day, so inserting a session never means renumbering the rest. Coffee, lunch and
  the poster slot are left untagged and print between the blocks.
- **Settings** — set the meeting date, open/close the submission window, set the
  deadline, grant admin rights. No Firebase-console workarounds remain for
  day-to-day organizing.
- **Archive** — a slideshow of photographs from previous editions, synced from a
  Dropbox folder by an organizer. See "Photographs of previous editions".
- **Organizer edit and delete** — organizers can correct a participant's name or
  affiliation, edit any abstract at any status, and delete an abstract or a
  participant outright. See "Editing and deleting as an organizer".

89 security-rules tests and 142 unit tests cover this.

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

## Registering and being listed

Registration is one form, `register.html`: full name, affiliation, email,
password. It creates the Firebase Auth account, sends the confirmation email,
and writes `users/{uid}` — the private profile.

**It does not put anyone on the participant list yet.** That happens when the
address is confirmed: the verification link lands on `account.html`, which forces
a fresh ID token (`refreshVerification()` — the token's `email_verified` is stale
for up to an hour otherwise) and, when it comes back true, writes
`participants_public/{uid}`. There is no opt-in checkbox and no button; the write
is idempotent and runs on every account-page load, so a registration interrupted
between the two writes heals itself the next time the person opens their account.

### Being listed without ever loading account.html

Two routes skip that hook entirely: opening the verification link on a device
where you are not signed in (the page redirects to sign-in and the write never
happens), and submitting an abstract without registering — those people get a
"set your password" mail rather than a verification one.

The second of those is narrowed as far as it can be: the reset mail carries a
continue URL of `login.html?next=account.html`, so finishing it drops them on
the sign-in page and signing in publishes them at once. It still does not close
the gap, because nothing obliges them to sign in there.

Neither can be fixed in the browser, because `participants_public` may be
written only by its owner or an organizer and the person in question is signed
in nowhere. So `backfillParticipants` in `functions/` sweeps up the difference:
every five minutes it compares verified Firebase Auth accounts against the
public list and publishes anyone with a profile who is missing from it. It
**never overwrites** an existing entry — it writes with `create()`, so a name an
organizer corrected in the admin console cannot be reverted by it, and a race
with the client's own publish resolves harmlessly.

Five minutes rather than one: the client-side path already covers the common
case immediately, so this is a safety net, and sweeping the whole list twelve
times an hour would bill Firestore reads for nothing. Widen or narrow it by
editing the `schedule` in `functions/index.js`. If the list is ever visibly
lagging, that is the number to look at.

`login.html` is sign-in and password reset only. Both pages carry a `?next=`
target through registration, so "Submit an abstract" on the home page brings a
signed-out visitor back to `account.html#abstract` once they have an account.
`js/redirect-utils.mjs` validates that target against a deliberately narrow
pattern — one page of this site, optionally with a fragment — so the parameter
cannot be turned into an open redirect.

## One abstract per participant

**The abstract's document id is the owner's uid.** That is what makes "one each"
real rather than advisory: there is no second slot to create, no rule has to
count anything, and Firestore rules cannot count documents anyway. `ownerUid`
stays as a field because the review console joins submitter details on it and
`deleteParticipant` queries it.

A **figure and a caption are both required**, enforced in
`js/abstract-validation-utils.mjs` for a readable error and again in
`firestore.rules` for anyone holding the public API key. Organizers writing
through `allow write: if isAdmin()` skip the check, so a record that predates the
requirement can still be repaired.

There are **three statuses**: `submitted` (shown as "In review"), `accepted` and
`rejected` ("Not accepted"). `withdrawn` was retired — it existed only so the
admin's Withdraw button had somewhere to put an abstract it pulled off the public
list, and that button is now **Return to review**, which writes `submitted`. A
document that still holds the old value reads as "In review" and normalises on
its next save.

Only an **accepted** abstract is frozen to its owner: the participant's "Edit
submission" button is disabled and the form behind it is read-only. A rejected one
stays editable, and with a single slot per person that matters more than it used
to — a rejected participant would otherwise be unable to revise, delete, or
replace their submission, because there is nowhere else to put a second attempt.

### One renderer, four places

`js/abstract-card.js` draws an abstract, and it is the only thing that does: the
public list, the live preview inside the submission form, the shared-link page and
the confirmation shown after a submission all call it. That is what lets the form promise "exactly
what the abstract list will show" — with a second renderer nearby the promise
would be a guess. The preview updates on every keystroke and includes the figure
and its caption; it leaves out the poster number and the talk pill, which are the
committee's to assign.

After a save, `submit.html` shows the stored abstract as that same card, with the
status and an **Edit submission** button, rather than leaving the filled-in form
on screen behind a green line. Arriving with an abstract already on file shows the
same view, because it is the same state. `account.html` does exactly the same,
through the shared `js/submission-view.js` — a participant meets their own
abstract on two pages and they must not disagree about what it looks like.

### Sharing an abstract

The public list is **collapsed and grouped**: topic headings in the order
`ABSTRACT_TOPICS` declares them (anything unrecognised lands in a trailing
"Other"), and one row per abstract carrying the poster board number or a talk
pill, the title, and the presenting author with "et al." Clicking a row opens it.
**The body is built on first open, not at render time** — a poster session runs to
hundreds of abstracts, and a `<details>` that already contains its `<img>` still
fetches it. **Expand all** opens everything, and a `beforeprint` handler does the
same automatically, so printing the page yields an abstract book rather than a
list of titles.

`abstracts.html?a=<id>` renders one abstract on its own, sets the tab title to
its title, and offers a way back to the list; every row in the list carries that
link. The status a submitter sees is **In review** until a decision is taken and
then **Accepted as a talk** or **Accepted as poster P12**
(`submissionStatusLabel`).

The share link appears **only once the abstract is accepted**. `abstracts_public`
is the world-readable copy and holds accepted abstracts only; a link to one still
in review resolves for its author and for nobody else, which is worse than no
link. For the same reason an unknown id and an unaccepted one give the same
answer — saying which would leak a decision that is not the site's to announce.

### Submitting without an account

`submit.html` works signed out. The form carries a "Your details" block — name,
affiliation, **email, all required** — and on save it creates a Firebase account
from them a moment *before* writing the abstract.

**Before, not after, and that is forced.** `firestore.rules` keys the abstract on
the owner's uid and `storage.rules` keys the figure on the uploader's, so an
unauthenticated visitor cannot write either; opening those up would hand the
collection to anyone holding the public API key. Creating the account first is
what lets the rules stay the only authorization boundary while the person filling
the form never sees a signup step.

They never choose a password, so a random one is generated and discarded and they
get a **"set your password" email** instead of a verification one. That is not a
shortcut: completing a password reset proves the same thing a verification link
proves, and Firebase marks the address verified when they do. One email, both
jobs, no dead end where somebody holds an account they cannot sign in to.

A signed-in submitter sees the same block with their **login email filled in and
read-only** — the address belongs to the login, and a second editable copy would
leave the two disagreeing about who they are.

If the address already has an account, the form says so and offers a sign-in
link. Nothing navigates away, so signing in in another tab picks up here — the
page re-renders on auth state — and the draft is still on screen. No account and
no abstract are created in that case: account creation runs only after the whole
form validates, and the abstract write only after the account exists.

**When the submission lands, a panel says to go and check the email**, names the
address it went to, warns that the sender is a `firebaseapp.com` domain that
university filters quarantine, and carries its own resend button. That moment is
the only one where the person is definitely still paying attention, and until
they open the mail they have no password, no verified address, and no place on
the participant list.

**Submitting no longer requires a verified email address.** That gate was the
wrong shape twice over: institutional mail filters quarantine the verification
message (measured — see "Verification emails and institutional mail filters"),
and a just-created account is never verified. What still stands between the
submission pile and the open internet is an account per submission, one abstract
per account, the submission window, and a required figure. What an unproven
address would actually harm is the **public participant list**, and that still
waits for verification.

## Reviewing abstracts

The Abstracts tab collapses to one row per abstract — the coloured status pill,
the title, the presenting author, and the mean score with how many organizers
scored it — because the review screen has to survive the same hundreds the public
list does. Rows open in place, their bodies built on first open, and **open rows
survive the re-render** that follows every accept, reject and review save.

**Sort within topic** orders each topic group by mean score, highest or lowest
first, or by title. Always within a topic: a mean of 7.4 in cognitive against 7.6
in systems compares two panels' scoring habits, not two abstracts. Unscored
abstracts sort last in *both* directions — "no score" is not a low score, and in
"lowest first" they would otherwise bury the abstract the committee actually
rated worst.

It filters on free text, status, presentation (talk / poster / not
published yet), the submitter's **talk opt-out**, and topic, and both CSV exports
cover exactly what the filters are showing — the button row says so when they are narrower than the whole pile.

**Every organizer has their own 1–10 score and their own private note.** They are
stored as a map keyed by reviewer uid inside `abstract_reviews/{abstractId}`, and
written with a merge into that nested map rather than a whole-document set — two
organizers reviewing the same abstract at the same time must not overwrite each
other. A note without a score counts as a review ("conflict of interest,
abstaining") and does not drag the mean down.

Notes written before scores were per-organizer are shown read-only, labelled as
earlier shared notes. They are not migrated: they belong to whoever wrote them,
and nothing records who that was.

Two exports:

| Button | Contents |
|---|---|
| Export abstracts (CSV) | one row per abstract: title, topic, status, presentation, poster number, authors with affiliation marks, submitter and email, figure caption and URL, dates, body |
| Export reviewer scores (CSV) | one row per abstract, **one column per organizer**, then the mean and how many scored it. An organizer who has scored nothing still gets a column — an empty one is a fact worth seeing |

### "Update published copy" — what it is for

On an abstract that is already accepted, the accept button reads **Update
published copy**, and it is not a second acceptance. It is the only control that
can change poster ↔ talk or the board number after acceptance, and the only one
that pushes an edit made elsewhere into `abstracts_public`. Withdraw-then-accept
would do the same thing while removing the abstract from the public list in
between.

It used to restamp `acceptedAt` on every click, so "when was this accepted"
became "when did somebody last touch it"; the original is now carried through.
It also used to write the reviewer-note textarea on every click, and that
textarea was filled asynchronously after the card rendered — a fast click saved
an empty note over a real one. Accept and reject no longer write notes at all.

## Photographs of previous editions

> **The sync is not deployed.** Its callable was temporarily removed from
> `functions/index.js` so the rest of the functions could ship — see "Editing and
> deleting as an organizer" for why and how to restore it. Everything below is
> accurate and the browser half is untouched; only the Sync button is inert, and
> the Archive admin tab says so.

The Archive page carries a slideshow, one photograph at a time, one edition at a
time, fed from `gallery/{year}` in Firestore. An organizer pastes a Dropbox
folder link in the admin console's **Archive** tab and presses **Sync from
Dropbox**; captions are typed there and survive later syncs, matched by file name.

**A browser cannot list a Dropbox folder.** Every Dropbox listing endpoint needs
an `Authorization` header, and a static site has nowhere safe to keep one — this
is the same problem that got the GitHub write-back removed (`docs/design-notes.md`
§3.2b). So the token lives in the `syncDropboxGallery` callable, the result is
cached in Firestore, and visitors never call a function at all.

### Setting up the Dropbox app

1. <https://www.dropbox.com/developers/apps> → **Create app** → **Scoped access**
   → **Full Dropbox** → name it. Under **Permissions**, tick `sharing.read` and
   `files.metadata.read`, and **Submit**.
2. On the **Settings** tab, note the **App key** and **App secret**.
3. Get a refresh token. In a browser, visit (one line, your app key substituted):
   ```
   https://www.dropbox.com/oauth2/authorize?client_id=APP_KEY&response_type=code&token_access_type=offline
   ```
   Approve, copy the code it shows, and exchange it:
   ```bash
   curl -u APP_KEY:APP_SECRET https://api.dropbox.com/oauth2/token \
     -d code=THE_CODE -d grant_type=authorization_code
   ```
   The `refresh_token` in the reply does not expire. An *access* token would —
   after four hours — which is why this is the one we store.
4. Store all three as secrets, never in the repository:
   ```bash
   npx firebase functions:secrets:set DROPBOX_APP_KEY
   npx firebase functions:secrets:set DROPBOX_APP_SECRET
   npx firebase functions:secrets:set DROPBOX_REFRESH_TOKEN
   npx firebase deploy --only functions
   ```
5. In Dropbox, share the photo folder with **Anyone with the link**, copy that
   link, and paste it into the Archive tab with the year.

**The site works without any of this.** The Archive page is exactly what it was
before there were photographs if the gallery is empty, the function is not
deployed, or Firestore is unreachable — the slideshow mounts nothing at all.

Two limits worth knowing: at most 200 photographs a year (enforced in both the
callable and `firestore.rules`), and Dropbox caps public-link bandwidth at
20 GB/day on a Basic account. A conference gallery is nowhere near either, but if
the Archive page ever draws real traffic, move the photographs to Firebase
Storage.

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

Markdown supports headings, lists, links, tables, bold, and italic.

### HTML in page copy

Markdown has no syntax for coloured text, so page copy may also contain plain
HTML. Write it inline and the editor's preview shows the result immediately:

```html
Registration closes <span style="color: red">this Friday</span>.

<div style="text-align: center">Poster session, 14:00</div>
```

The usable tags are `span`, `div`, `u`, `s`, `small`, and `mark`, on top of
everything markdown already produces, and they may carry `style` and `class`.

**One trap.** A block-level tag such as `<div>` switches the markdown parser
off for everything inside it, so `<div>**bold**</div>` prints the asterisks.
Leave a blank line above and below the contents and markdown works again:

```html
<div style="text-align: center">

**Poster session**, 14:00

</div>
```

`<span>` used inside a sentence has no such problem.

Everything is still sanitized before it reaches the page. Scripts, event
handlers such as `onclick`, and `javascript:` links are removed. A `style`
attribute is filtered down to presentation properties: colour, fonts, spacing,
borders, alignment and sizing survive, while `position`, `z-index`, and offsets
are dropped — those are what turn a styled word into an invisible layer over the
rest of the page — and so is any value containing `url(` or `expression(`, which
would otherwise let page copy call out to another server. The rules live in
`safeStyle()` in `js/markdown-render-utils.mjs` and are unit-tested.

Abstract bodies are a separate, much narrower allowlist and gain none of this:
participant input never renders HTML.

## Editing and deleting as an organizer

Deletion is the one operation that does not run in the browser, because two
things make it impossible there: a Firebase Auth account can only be deleted by
its owner from a client, and `storage.rules` scopes figure deletion to the
uploader. Both need the Admin SDK, so `functions/` holds these callables:

| Callable | Does |
|---|---|
| `deleteAbstractCompletely` | removes the abstract, its published copy, its reviews, its figure |
| `deleteParticipant` | all of the above for every abstract they own, plus their profile, their public listing, and their login |
| `backfillParticipants` | every five minutes, publishes verified participants who never loaded `account.html` — see "Being listed without ever loading account.html" |
| `syncDropboxGallery` | **temporarily removed** — see below |

All three deployed ones are here because they must **bypass the rules**: the
deletes act on somebody else's documents, and the backfill writes on behalf of a
person who is signed in nowhere. The other reason something may live here is that
it must **hold a secret the browser cannot** — which is `syncDropboxGallery`'s
justification. Those are the only two reasons anything belongs in `functions/`.

**`syncDropboxGallery` is not in `functions/index.js` right now.** It binds three
Dropbox secrets, and a function whose secrets do not exist cannot be provisioned
— which fails the whole `firebase deploy --only functions`, taking the deletes
and the backfill down with it. Rather than hold everything else hostage to a
Dropbox app nobody has created yet, it was removed in a commit of its own. To
bring it back: set the three secrets as described in "Setting up the Dropbox
app", find the commit whose subject begins "Take the Dropbox sync out of the
deploy", and `git revert` it. Its browser half — the Archive admin tab,
`js/functions.js`, the public slideshow — is untouched and still waiting for it. The moment ordinary reads and writes start
going through callables, the site stops being a static site and every page pays
cold-start latency for work the rules already secure.

`deleteParticipant` refuses to delete you, and refuses to delete another
organizer — revoke their admin rights in Settings first. The Participants tab
does not offer the button in either case, so the refusal is a backstop rather
than the first line of defence.

**The site works without them.** Every page loads and every other feature works
if the functions are never deployed; the two delete buttons report that the
service is missing when pressed, and the Archive page simply shows no
photographs. Deploy them with:

```bash
cd functions && npm install
npx firebase deploy --only functions
```

They deploy to `europe-west1`, not the `us-central1` default, so participant
names and email addresses stay in the EU. `js/functions.js` names the same
region — **if you change one, change both**, or every call fails as an opaque
CORS error.

Cloud Functions need the Blaze plan. Nothing else on the site does.
`backfillParticipants` additionally needs **Cloud Scheduler**, which Firebase
enables on the first deploy of a scheduled function; the job is free at this
frequency and each sweep costs a handful of Firestore reads.

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
npm test            # pure-function unit tests (142)
npm run test:rules  # Firestore rules tests (89; needs Java)
npm run emulators   # Firestore, Auth, Storage and Functions emulators
```

### Rehearsing against the emulators

Some flows cannot be tried against production without leaving real accounts and
real abstracts behind — signing up, submitting as a guest, deleting a
participant. Add `?emulator` to any page, with `npm run emulators` running, and
the whole SDK talks to the local stack instead:

```
http://127.0.0.1:4173/submit.html?emulator
```

The switch is in `js/firebase.js` and is guarded on **localhost AND the query
parameter**, the same way `js/functions.js` has always guarded its own — so the
deployed site can never be pointed at a laptop, and an ordinary local page load
still talks to the real project.

Two things to know. The emulator starts empty, so seed the submission window
first or every submission is refused (the rules read `config/site` and fail
closed when it is missing):

```bash
curl -X PATCH -H "Authorization: Bearer owner" -H "Content-Type: application/json" \
  "http://127.0.0.1:8080/v1/projects/pints-conference/databases/(default)/documents/config/site" \
  -d '{"fields":{"submissionsOpen":{"booleanValue":true},
       "submissionDeadline":{"timestampValue":"2027-01-01T00:00:00Z"},
       "edition":{"stringValue":"pints2026"}}}'
```

And no mail is actually sent — the Auth emulator queues it. To see the link a
submitter would have received:

```bash
curl -s http://127.0.0.1:9099/emulator/v1/projects/pints-conference/oobCodes
```

If `emulators:start` reports no Java runtime, Homebrew installed `openjdk`
keg-only. `npm run test:rules` finds it on its own; this command does not:

```bash
PATH="/opt/homebrew/opt/openjdk/bin:$PATH" npm run emulators
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
- Two logo files, both **generated** by `scripts/logo/` and not hand-edited —
  see the README in that directory. `assets/pints-2026-header.svg` is the home
  hero (wordmark, subtitle and date); `assets/pints-mark.svg` is the wordmark
  alone and is the header brand link on every page, injected by `js/layout.js`.
  Their text is stored as outlines rather than `<text>` in Trebuchet MS, because
  a visitor without that font (most Linux and Android) otherwise gets a Times
  wordmark with the pint-glass "i" landing on the N. Changing the date or the
  venue means editing the constants at the top of `scripts/logo/build_logo.py`
  and re-running it; the alt text in `index.html` has to be updated to match.
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
