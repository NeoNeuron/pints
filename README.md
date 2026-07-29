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

Phases 1–3 — login, abstract submission and review, and the schedule editor —
are specified in the plan but not yet built. The pages for those sections exist
and currently say "not live yet". Phase 1 needs a Firebase project on the Spark
plan, created by hand in the console.

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
`main` deploys. `.nojekyll` must stay in place — without it, Pages runs Jekyll
and drops any path beginning with an underscore.

## Firebase

_Not yet configured. Phase 1 of the implementation plan covers this._

Two things that will matter when it is:

- The project must stay on the **Spark (free)** plan. Do not enable Cloud
  Storage or Cloud Functions — both require Blaze and a credit card.
- Every host that serves the site must be listed under **Authentication →
  Settings → Authorized domains**, or sign-in fails with an opaque
  `auth/unauthorized-domain` error.
