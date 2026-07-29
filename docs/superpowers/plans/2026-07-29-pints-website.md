# PINTS Conference Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `pints2025.sciencesconf.org` with a self-owned conference site on GitHub Pages that has participant/admin login, abstract submission and review, an editable schedule, a public poster list, and markdown-authored static pages.

**Architecture:** Multi-page static HTML with no build step, served from the repo root on GitHub Pages. All logic is ES modules loaded directly by the browser. Pure functions live in `.mjs` files unit-tested under Node; DOM and Firebase glue lives in thin `.js` page controllers. Firebase Auth handles identity and Firestore holds structured data, with `firestore.rules` as the *only* authorization boundary. Because Firestore rules cannot hide individual fields, every "public but partial" view is served by a separate projection collection written alongside its private original.

**Tech Stack:** HTML5, CSS (hand-written, no framework), ES modules, Firebase JS SDK 12.16.0 via the gstatic CDN, Firestore, Firebase Auth. Dev-only: Node's built-in `node --test`, `@firebase/rules-unit-testing` + the Firestore emulator, `jsdom`, `marked`, `dompurify`, `http-server`, `firebase-tools`.

**Spec:** `docs/superpowers/specs/2026-07-29-pints-website-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **No build step.** Nothing may require compilation, bundling, or transpilation to serve the site. `npm` is dev-only tooling; the deployed site is the repo contents as-is.
- **No Cloud Storage, no Cloud Functions, no Blaze plan.** Cloud Storage left the free Spark plan in February 2026. Nothing in this plan may introduce a billing requirement.
- **All paths relative.** Never write a leading-slash path (`/css/…`) in HTML, JS, or markdown. The site may be served from `<owner>.github.io/pints/`. Every `.html` file lives at the repo root, so `css/styles.css`, `js/…`, `content/…`, `vendor/…` all resolve correctly.
- **Firestore rules cannot filter fields.** Never attempt field-level read rules. Public subsets are separate projection collections.
- **Public list pages need `allow read: if true`** (that is `get` *and* `list`). Never write rules that inspect `request.query`.
- **Client-side sort, not `orderBy`.** List pages fetch by `edition` equality and sort through tested pure functions, avoiding composite-index setup.
- **Firebase SDK version is pinned to `12.16.0`** in every gstatic import URL. Changing it is a deliberate, separate change.
- **`CURRENT_EDITION`** is defined once in `js/config.mjs` and stamped on every edition-scoped document. Never hardcode an edition string anywhere else.
- **Untrusted markdown** (abstract bodies) renders only through `renderAbstract()` with the tight allowlist. Repo-authored markdown uses `renderPage()`.
- **Commit after every task.** Conventional commit messages (`feat:`, `test:`, `chore:`, `docs:`).

## File Structure

| Path | Responsibility |
|---|---|
| `js/config.mjs` | Edition constant, nav definition, field limits, enumerations. No imports. |
| `js/nav-utils.mjs` | Pure: resolve the active nav item from a pathname. |
| `js/markdown-render-utils.mjs` | Pure: allowlists and the render pipeline, with `parse`/`sanitize` injected. |
| `js/participant-utils.mjs` | Pure: last-name sort key, accent-aware participant ordering. |
| `js/abstract-validation-utils.mjs` | Pure: abstract input parsing and validation. |
| `js/abstract-utils.mjs` | Pure: author line parts, poster numbering, search, public ordering. |
| `js/schedule-utils.mjs` | Pure: time parsing/formatting, group-by-day, within-day ordering. |
| `js/csv-utils.mjs` | Pure: CSV cell quoting with formula-injection defence. |
| `js/markdown.js` | Browser wiring of `marked` + `DOMPurify` onto the pure render pipeline. |
| `js/layout.js` | Injects header/nav/footer; highlights the active page. |
| `js/firebase-config.js` | The public Firebase project config object. Nothing else. |
| `js/firebase.js` | Initializes and exports the `app`, `auth`, `db` singletons. |
| `js/auth.js` | Sign up / in / out, reset, verification, token refresh, admin check, auth-state helpers. |
| `js/db.js` | All Firestore reads and writes. Page controllers never import Firestore directly. |
| `js/page-*.js` | One thin controller per page. DOM only; delegates to `db.js`/`auth.js`/utils. |
| `js/abstract-form.js` | The submit/edit/withdraw form, mounted into `account.html`. |
| `js/admin-*.js` | One module per admin tab, each exporting `mountXTab(host, ctx)`. |
| `content/*.md` | Organizer-editable page copy. |
| `firestore.rules` | The authorization boundary. |
| `test/*.test.mjs` | Node unit tests for the pure modules. |
| `test/rules/*.test.mjs` | Emulator tests for `firestore.rules`. |

---

# Phase 0 — Scaffold and static site

Ships a live, organizer-editable site with no Firebase at all. Satisfies requirement 6.

### Task 1: Project scaffold, config, and the test loop

**Files:**
- Create: `.gitignore`, `.nojekyll`, `package.json`, `js/config.mjs`, `js/nav-utils.mjs`
- Test: `test/nav-utils.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `CURRENT_EDITION: string`, `SITE_NAME: string`, `NAV: {href: string, label: string}[]`, `LIMITS: object`, `ABSTRACT_TYPES: string[]`, `ABSTRACT_STATUSES: string[]`, `SCHEDULE_KINDS: string[]` from `js/config.mjs`; `currentPageFile(pathname): string` and `markActive(nav, pathname): {href,label,active}[]` from `js/nav-utils.mjs`.

- [ ] **Step 1: Create `.gitignore`**

```
node_modules/
.firebase/
firebase-debug.log
firestore-debug.log
ui-debug.log
.DS_Store
*.swp
```

- [ ] **Step 2: Create `.nojekyll`**

Empty file. Required so GitHub Pages serves paths beginning with `_` verbatim instead of running Jekyll.

```bash
touch .nojekyll
```

- [ ] **Step 3: Create `package.json`**

```json
{
  "name": "pints-website",
  "version": "1.0.0",
  "private": true,
  "description": "Website for the PINTS conference (Paris Ile-de-France Neuroscience, Theory, and Systems)",
  "type": "module",
  "scripts": {
    "test": "node --test test/*.test.mjs",
    "test:rules": "firebase emulators:exec --only firestore --project demo-pints-rules \"node --test test/rules/*.test.mjs\"",
    "serve": "http-server -p 4173 -c-1 .",
    "vendor": "node scripts/vendor.mjs"
  },
  "devDependencies": {
    "@firebase/rules-unit-testing": "^4.0.1",
    "dompurify": "^3.2.4",
    "firebase": "^12.16.0",
    "firebase-tools": "^14.0.0",
    "http-server": "^14.1.1",
    "jsdom": "^26.0.0",
    "marked": "^15.0.7"
  }
}
```

- [ ] **Step 4: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, no errors. If a version above no longer resolves, install the current major (`npm install -D marked dompurify jsdom http-server firebase firebase-tools @firebase/rules-unit-testing`) and let npm write the versions.

- [ ] **Step 5: Write the failing test**

Create `test/nav-utils.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { currentPageFile, markActive } from "../js/nav-utils.mjs";

const NAV = [
  { href: "index.html", label: "Home" },
  { href: "program.html", label: "Program" },
];

test("currentPageFile returns the file name from a path", () => {
  assert.equal(currentPageFile("/pints/program.html"), "program.html");
  assert.equal(currentPageFile("/program.html"), "program.html");
});

test("currentPageFile treats a directory path as index.html", () => {
  assert.equal(currentPageFile("/"), "index.html");
  assert.equal(currentPageFile("/pints/"), "index.html");
  assert.equal(currentPageFile(""), "index.html");
});

test("markActive flags exactly the current page", () => {
  const marked = markActive(NAV, "/pints/program.html");
  assert.deepEqual(marked.map((i) => i.active), [false, true]);
});

test("markActive flags home for a bare directory path", () => {
  const marked = markActive(NAV, "/pints/");
  assert.deepEqual(marked.map((i) => i.active), [true, false]);
});

test("markActive does not mutate the input nav", () => {
  const input = [{ href: "index.html", label: "Home" }];
  markActive(input, "/");
  assert.deepEqual(input, [{ href: "index.html", label: "Home" }]);
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../js/nav-utils.mjs'`

- [ ] **Step 7: Create `js/config.mjs`**

```javascript
// Single source of truth for edition-scoped and site-wide constants.
// Never hardcode any of these values elsewhere.

export const CURRENT_EDITION = "pints2026";
export const SITE_NAME = "PINTS";
export const SITE_TAGLINE = "Paris Ile-de-France Neuroscience, Theory, and Systems";

export const NAV = [
  { href: "index.html", label: "Home" },
  { href: "program.html", label: "Program" },
  { href: "abstracts.html", label: "Abstracts" },
  { href: "participants.html", label: "Participants" },
  { href: "venue.html", label: "Venue" },
  { href: "about.html", label: "About" },
];

export const LIMITS = {
  displayName: 80,
  affiliation: 120,
  title: 200,
  body: 2500,
  authors: 20,
  affiliations: 10,
};

export const ABSTRACT_TYPES = ["poster", "talk"];
export const ABSTRACT_STATUSES = ["submitted", "accepted", "rejected", "withdrawn"];
export const SCHEDULE_KINDS = ["keynote", "talk", "poster", "break", "lunch", "social", "other"];
```

- [ ] **Step 8: Create `js/nav-utils.mjs`**

```javascript
/** Resolve the served file name from a pathname, treating directories as index.html. */
export function currentPageFile(pathname) {
  const last = String(pathname ?? "").split("/").pop();
  return last === "" || last === undefined ? "index.html" : last;
}

/** Return a copy of `nav` with an `active` flag on the entry matching `pathname`. */
export function markActive(nav, pathname) {
  const file = currentPageFile(pathname);
  return nav.map((item) => ({ ...item, active: item.href === file }));
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — 5 tests passing.

- [ ] **Step 10: Commit**

```bash
git add .gitignore .nojekyll package.json package-lock.json js/config.mjs js/nav-utils.mjs test/nav-utils.test.mjs
git commit -m "chore: scaffold repo with config, nav utils, and the node test loop"
```

---

### Task 2: Vendored markdown rendering with a hardened allowlist

**Files:**
- Create: `scripts/vendor.mjs`, `js/markdown-render-utils.mjs`, `js/markdown.js`
- Create (generated): `vendor/marked.esm.js`, `vendor/purify.es.mjs`
- Test: `test/markdown-render-utils.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `PAGE_ALLOWLIST`, `ABSTRACT_ALLOWLIST`, `renderMarkdown(src, {parse, sanitize, config}): string`, `renderPage(src, deps): string`, `renderAbstract(src, deps): string` from `js/markdown-render-utils.mjs`; browser-ready `renderPageHtml(src): string` and `renderAbstractHtml(src): string` from `js/markdown.js`.

- [ ] **Step 1: Create `scripts/vendor.mjs`**

```javascript
// Copies the ESM builds of our two runtime dependencies into vendor/ so the
// browser can import them directly. This is the whole "build step": a file copy.
import { copyFileSync, mkdirSync } from "node:fs";

const FILES = [
  ["node_modules/marked/lib/marked.esm.js", "vendor/marked.esm.js"],
  ["node_modules/dompurify/dist/purify.es.mjs", "vendor/purify.es.mjs"],
];

mkdirSync("vendor", { recursive: true });
for (const [from, to] of FILES) {
  copyFileSync(from, to);
  console.log(`vendored ${from} -> ${to}`);
}
```

- [ ] **Step 2: Run it and verify the files land**

Run: `npm run vendor && ls -l vendor`
Expected: both `vendor/marked.esm.js` and `vendor/purify.es.mjs` exist and are non-empty. If either source path is missing, find the real one with `ls node_modules/marked/lib node_modules/dompurify/dist` and update `FILES`.

- [ ] **Step 3: Write the failing test**

Create `test/markdown-render-utils.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { marked } from "../vendor/marked.esm.js";
import createDOMPurify from "../vendor/purify.es.mjs";
import {
  ABSTRACT_ALLOWLIST,
  renderAbstract,
  renderPage,
} from "../js/markdown-render-utils.mjs";

const { window } = new JSDOM("");
const purify = createDOMPurify(window);
const deps = {
  parse: (src) => marked.parse(src),
  sanitize: (html, config) => purify.sanitize(html, config),
};

test("renderPage renders ordinary markdown", () => {
  const html = renderPage("# Venue\n\nSee the [map](https://example.org/map).", deps);
  assert.match(html, /<h1[^>]*>Venue<\/h1>/);
  assert.match(html, /href="https:\/\/example\.org\/map"/);
});

test("renderAbstract keeps the scientific inline subset", () => {
  const html = renderAbstract("Firing rate *increased* by **40%** in V1^2^.", deps);
  assert.match(html, /<em>increased<\/em>/);
  assert.match(html, /<strong>40%<\/strong>/);
});

test("renderAbstract strips script tags", () => {
  const html = renderAbstract("Hello <script>alert(1)</script> world", deps);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /alert\(1\)/);
});

test("renderAbstract strips event handler attributes", () => {
  const html = renderAbstract('<img src="x" onerror="alert(1)">', deps);
  assert.doesNotMatch(html, /onerror/i);
  assert.doesNotMatch(html, /<img/i);
});

test("renderAbstract strips javascript: URLs", () => {
  const html = renderAbstract("[click](javascript:alert(1))", deps);
  assert.doesNotMatch(html, /javascript:/i);
});

test("renderAbstract drops block-level markup outside the allowlist", () => {
  const html = renderAbstract("# Not a heading here\n\n- not a list", deps);
  assert.doesNotMatch(html, /<h1/i);
  assert.doesNotMatch(html, /<ul/i);
  assert.match(html, /Not a heading here/);
});

test("the abstract allowlist is exactly the intended tag set", () => {
  assert.deepEqual(ABSTRACT_ALLOWLIST.ALLOWED_TAGS.slice().sort(), [
    "a", "br", "em", "p", "strong", "sub", "sup",
  ]);
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../js/markdown-render-utils.mjs'`

- [ ] **Step 5: Create `js/markdown-render-utils.mjs`**

```javascript
/**
 * Rendering pipeline for markdown. `parse` and `sanitize` are injected so this
 * module stays pure and testable under Node.
 *
 * Two allowlists, deliberately different:
 *  - PAGE_ALLOWLIST     repo-authored content/*.md, written by organizers we trust.
 *  - ABSTRACT_ALLOWLIST participant-submitted abstract bodies. Untrusted input.
 */

export const PAGE_ALLOWLIST = {
  ALLOWED_TAGS: [
    "h1", "h2", "h3", "h4", "p", "br", "hr", "em", "strong", "sup", "sub",
    "a", "ul", "ol", "li", "blockquote", "code", "pre",
    "table", "thead", "tbody", "tr", "th", "td", "img",
  ],
  ALLOWED_ATTR: ["href", "title", "src", "alt", "colspan", "rowspan"],
  // No ALLOWED_URI_REGEXP here on purpose: DOMPurify's own default is vetted and
  // already blocks javascript:/data: URLs. Hand-copying a regex only risks
  // getting it subtly wrong. The abstract allowlist below overrides it because
  // that input is untrusted and we want https-only, which is stricter.
};

export const ABSTRACT_ALLOWLIST = {
  ALLOWED_TAGS: ["p", "br", "em", "strong", "sup", "sub", "a"],
  ALLOWED_ATTR: ["href"],
  ALLOWED_URI_REGEXP: /^https?:\/\//i,
};

/** Parse then sanitize. Sanitization always runs last. */
export function renderMarkdown(src, { parse, sanitize, config }) {
  if (src === null || src === undefined || String(src).trim() === "") return "";
  return sanitize(parse(String(src)), config);
}

/** Render trusted, repo-authored markdown. */
export function renderPage(src, deps) {
  return renderMarkdown(src, { ...deps, config: PAGE_ALLOWLIST });
}

/** Render untrusted, participant-submitted markdown. */
export function renderAbstract(src, deps) {
  return renderMarkdown(src, { ...deps, config: ABSTRACT_ALLOWLIST });
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all markdown tests green. The `<img>`/`javascript:`/`<script>` cases are the ones that matter; if any fails, the allowlist is wrong, not the test.

- [ ] **Step 7: Create `js/markdown.js` (browser wiring)**

```javascript
import { marked } from "../vendor/marked.esm.js";
import createDOMPurify from "../vendor/purify.es.mjs";
import { renderAbstract, renderPage } from "./markdown-render-utils.mjs";

const purify = createDOMPurify(window);
const deps = {
  parse: (src) => marked.parse(src),
  sanitize: (html, config) => purify.sanitize(html, config),
};

export const renderPageHtml = (src) => renderPage(src, deps);
export const renderAbstractHtml = (src) => renderAbstract(src, deps);
```

- [ ] **Step 8: Commit**

```bash
git add scripts/vendor.mjs vendor js/markdown-render-utils.mjs js/markdown.js test/markdown-render-utils.test.mjs
git commit -m "feat: vendored markdown rendering with separate trusted and untrusted allowlists"
```

---

### Task 3: Stylesheet and shared layout injection

**Files:**
- Create: `css/styles.css`, `js/layout.js`

**Interfaces:**
- Consumes: `NAV`, `SITE_NAME`, `SITE_TAGLINE` from `js/config.mjs`; `markActive` from `js/nav-utils.mjs`.
- Produces: `mountLayout(): void` from `js/layout.js`, which fills `#site-header` and `#site-footer`. Every page calls it. Also `setAuthLink(state)` where `state` is `{signedIn: boolean, isAdmin: boolean}`, used from Phase 1 onward to swap the "Sign in" link for "My account" / "Admin".

- [ ] **Step 1: Create `css/styles.css`**

```css
:root {
  --ink: #1a1a1a;
  --muted: #5c5c5c;
  --line: #dcdcdc;
  --bg: #ffffff;
  --bg-soft: #f6f6f4;
  --accent: #7b1e3a;
  --accent-soft: #f3e6ea;
  --ok: #1c6b3f;
  --warn: #8a5a00;
  --err: #a01b1b;
  --measure: 68ch;
  --radius: 6px;
}

*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--ink);
  background: var(--bg);
}

.wrap { max-width: 62rem; margin: 0 auto; padding: 0 1.25rem; }
.prose { max-width: var(--measure); }
.prose h1, .prose h2, .prose h3 { line-height: 1.25; margin: 2rem 0 .5rem; }
.prose p, .prose ul, .prose ol { margin: 0 0 1rem; }
a { color: var(--accent); }

/* Header and nav */
.site-header { border-bottom: 1px solid var(--line); background: var(--bg-soft); }
.site-header .wrap { display: flex; flex-wrap: wrap; align-items: baseline; gap: .5rem 1.5rem; padding-block: 1rem; }
.brand { font-weight: 700; font-size: 1.35rem; color: var(--ink); text-decoration: none; letter-spacing: .02em; }
.brand small { display: block; font-weight: 400; font-size: .78rem; color: var(--muted); letter-spacing: 0; }
.site-nav { display: flex; flex-wrap: wrap; gap: .25rem 1rem; margin-left: auto; }
.site-nav a { color: var(--muted); text-decoration: none; padding: .25rem 0; border-bottom: 2px solid transparent; }
.site-nav a:hover { color: var(--ink); }
.site-nav a[aria-current="page"] { color: var(--ink); border-bottom-color: var(--accent); }
.site-nav a.auth-link { color: var(--accent); font-weight: 600; }

/* Footer */
.site-footer { margin-top: 4rem; border-top: 1px solid var(--line); background: var(--bg-soft); }
.site-footer .wrap { padding-block: 1.5rem; color: var(--muted); font-size: .9rem; }

main { padding-block: 2rem 1rem; }

/* Hero */
.hero { background: var(--accent-soft); border-bottom: 1px solid var(--line); }
.hero .wrap { padding-block: 3rem; }
.hero h1 { margin: 0 0 .5rem; font-size: clamp(1.9rem, 5vw, 3rem); line-height: 1.1; }
.hero .meta { font-size: 1.05rem; color: var(--muted); margin: 0; }

/* Cards, tables, forms */
.card { border: 1px solid var(--line); border-radius: var(--radius); padding: 1rem 1.25rem; margin-bottom: 1rem; background: var(--bg); }
.card h3 { margin: 0 0 .25rem; }
.card .byline { color: var(--muted); font-size: .92rem; margin: 0 0 .5rem; }

.table-scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: .5rem .75rem; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-size: .82rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
tr.kind-break td, tr.kind-lunch td { color: var(--muted); font-style: italic; }
td.time { white-space: nowrap; font-variant-numeric: tabular-nums; }

form { max-width: var(--measure); }
label { display: block; margin: 1rem 0 .25rem; font-weight: 600; }
label .hint { display: block; font-weight: 400; font-size: .85rem; color: var(--muted); }
input[type="text"], input[type="email"], input[type="password"], input[type="time"],
input[type="date"], input[type="number"], select, textarea {
  width: 100%; padding: .5rem .6rem; border: 1px solid var(--line);
  border-radius: var(--radius); font: inherit; background: var(--bg); color: var(--ink);
}
textarea { min-height: 12rem; resize: vertical; }
.checkline { display: flex; align-items: flex-start; gap: .5rem; margin: 1rem 0; }
.checkline input { margin-top: .35rem; }
.checkline label { margin: 0; }

button, .button {
  font: inherit; font-weight: 600; padding: .5rem 1rem; border-radius: var(--radius);
  border: 1px solid var(--accent); background: var(--accent); color: #fff; cursor: pointer;
  text-decoration: none; display: inline-block;
}
button.secondary, .button.secondary { background: transparent; color: var(--accent); }
button.danger { background: var(--err); border-color: var(--err); }
button[disabled] { opacity: .5; cursor: not-allowed; }
.actions { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: 1.5rem; }

/* Status messages */
.msg { padding: .6rem .9rem; border-radius: var(--radius); margin: 1rem 0; border: 1px solid; }
.msg.ok { color: var(--ok); border-color: var(--ok); background: #eef7f1; }
.msg.warn { color: var(--warn); border-color: var(--warn); background: #fdf6e7; }
.msg.err { color: var(--err); border-color: var(--err); background: #fbeeee; }
.msg ul { margin: .25rem 0 0 1rem; padding: 0; }
.msg:empty { display: none; }

.muted { color: var(--muted); }
.pill { display: inline-block; font-size: .78rem; padding: .1rem .5rem; border-radius: 999px; background: var(--bg-soft); border: 1px solid var(--line); color: var(--muted); }
.poster-no { font-weight: 700; color: var(--accent); }
sup { font-size: .7em; }

/* Admin tabs */
.tabs { display: flex; flex-wrap: wrap; gap: .5rem; border-bottom: 1px solid var(--line); margin-bottom: 1.5rem; }
.tabs button { background: transparent; color: var(--muted); border: none; border-bottom: 2px solid transparent; border-radius: 0; padding: .5rem .75rem; }
.tabs button[aria-selected="true"] { color: var(--ink); border-bottom-color: var(--accent); }
[hidden] { display: none !important; }

.sponsors { display: flex; flex-wrap: wrap; gap: 1.5rem; align-items: center; margin-top: 1rem; }
.sponsors img { max-height: 3.5rem; width: auto; }

@media (max-width: 40rem) {
  .site-header .wrap { padding-block: .75rem; }
  .site-nav { margin-left: 0; width: 100%; }
}
```

- [ ] **Step 2: Create `js/layout.js`**

```javascript
import { NAV, SITE_NAME, SITE_TAGLINE } from "./config.mjs";
import { markActive } from "./nav-utils.mjs";

function navLink({ href, label, active }) {
  const a = document.createElement("a");
  a.href = href;
  a.textContent = label;
  if (active) a.setAttribute("aria-current", "page");
  return a;
}

/** Fill #site-header and #site-footer. Called by every page. */
export function mountLayout() {
  const header = document.getElementById("site-header");
  if (header) {
    header.className = "site-header";
    const wrap = document.createElement("div");
    wrap.className = "wrap";

    const brand = document.createElement("a");
    brand.className = "brand";
    brand.href = "index.html";
    brand.textContent = SITE_NAME;
    const tagline = document.createElement("small");
    tagline.textContent = SITE_TAGLINE;
    brand.append(tagline);

    const nav = document.createElement("nav");
    nav.className = "site-nav";
    nav.setAttribute("aria-label", "Main");
    for (const item of markActive(NAV, location.pathname)) nav.append(navLink(item));

    const auth = document.createElement("a");
    auth.className = "auth-link";
    auth.id = "auth-link";
    auth.href = "login.html";
    auth.textContent = "Sign in";
    nav.append(auth);

    wrap.append(brand, nav);
    header.replaceChildren(wrap);
  }

  const footer = document.getElementById("site-footer");
  if (footer) {
    footer.className = "site-footer";
    const wrap = document.createElement("div");
    wrap.className = "wrap";
    wrap.textContent = `${SITE_NAME} — ${SITE_TAGLINE}. Logo by majab.com.`;
    footer.replaceChildren(wrap);
  }
}

/**
 * Swap the header auth link once auth state is known.
 * Phase 0 never calls this; Phase 1 onward does.
 */
export function setAuthLink({ signedIn, isAdmin }) {
  const link = document.getElementById("auth-link");
  if (!link) return;
  if (!signedIn) {
    link.href = "login.html";
    link.textContent = "Sign in";
  } else {
    link.href = isAdmin ? "admin.html" : "account.html";
    link.textContent = isAdmin ? "Admin" : "My account";
  }
}
```

- [ ] **Step 3: Verify the unit suite still passes**

Run: `npm test`
Expected: PASS — layout is browser-only and untested here by design; its pure part (`markActive`) is already covered.

- [ ] **Step 4: Commit**

```bash
git add css/styles.css js/layout.js
git commit -m "feat: site stylesheet and shared header/footer injection"
```

---

### Task 4: Static pages and organizer-editable content

**Files:**
- Create: `index.html`, `about.html`, `venue.html`, `404.html`
- Create: `program.html`, `abstracts.html`, `participants.html`, `login.html`, `account.html`, `admin.html` (shells only — filled in later phases)
- Create: `content/home.md`, `content/about.md`, `content/venue.md`, `content/poster-guidelines.md`
- Create: `js/page-content.js`

**Interfaces:**
- Consumes: `mountLayout` from `js/layout.js`; `renderPageHtml` from `js/markdown.js`.
- Produces: the convention that any element with `data-markdown="content/foo.md"` is filled by `js/page-content.js`. Later pages reuse it.

- [ ] **Step 1: Create `js/page-content.js`**

```javascript
import { mountLayout } from "./layout.js";
import { renderPageHtml } from "./markdown.js";

mountLayout();

/** Fill every [data-markdown] element from its markdown file. */
for (const host of document.querySelectorAll("[data-markdown]")) {
  const src = host.getAttribute("data-markdown");
  try {
    const res = await fetch(src, { cache: "no-cache" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    host.innerHTML = renderPageHtml(await res.text());
  } catch (err) {
    host.innerHTML = "";
    const p = document.createElement("p");
    p.className = "msg err";
    p.textContent = `Could not load ${src}.`;
    host.append(p);
    console.error(`[pints] failed to load ${src}`, err);
  }
}
```

- [ ] **Step 2: Create `index.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PINTS — Paris Ile-de-France Neuroscience, Theory, and Systems</title>
<meta name="description" content="PINTS is a one-day meeting bringing together the Paris Ile-de-France neuroscience, theory, and systems community.">
<link rel="stylesheet" href="css/styles.css">
</head>
<body>
<header id="site-header"></header>
<section class="hero">
  <div class="wrap">
    <h1>PINTS 2026</h1>
    <p class="meta">Paris Ile-de-France Neuroscience, Theory, and Systems<br>
      <strong>Date to be confirmed</strong> · Paris</p>
    <p class="actions"><a class="button" href="login.html">Register / sign in</a>
      <a class="button secondary" href="program.html">See the program</a></p>
  </div>
</section>
<main class="wrap">
  <div class="prose" data-markdown="content/home.md"></div>
</main>
<footer id="site-footer"></footer>
<script type="module" src="js/page-content.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create `about.html` and `venue.html`**

Both follow the same shape. `about.html`:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>About — PINTS</title>
<meta name="description" content="About the PINTS meeting: scope, organizers, and sponsors.">
<link rel="stylesheet" href="css/styles.css">
</head>
<body>
<header id="site-header"></header>
<main class="wrap">
  <h1>About</h1>
  <div class="prose" data-markdown="content/about.md"></div>
</main>
<footer id="site-footer"></footer>
<script type="module" src="js/page-content.js"></script>
</body>
</html>
```

`venue.html` is identical with `<title>Venue — PINTS</title>`, `<h1>Venue</h1>`, `data-markdown="content/venue.md"`, and description "How to reach the PINTS venue."

- [ ] **Step 4: Create `404.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page not found — PINTS</title>
<link rel="stylesheet" href="css/styles.css">
</head>
<body>
<header id="site-header"></header>
<main class="wrap prose">
  <h1>Page not found</h1>
  <p>That page does not exist. Try the <a href="index.html">home page</a>.</p>
</main>
<footer id="site-footer"></footer>
<script type="module" src="js/page-content.js"></script>
</body>
</html>
```

- [ ] **Step 5: Create the shell pages linked from the nav**

So no nav link 404s before its phase lands. Create `program.html`, `abstracts.html`, `participants.html`, `login.html`, `account.html`, `admin.html` using the `about.html` shape, each with its own `<title>`/`<h1>` and this body in place of the markdown div:

```html
  <p class="msg warn">This section is not live yet.</p>
```

Titles and headings: Program/Program, Abstracts/Abstracts, Participants/Registered participants, Sign in/Sign in, My account/My account, Admin/Admin console.

- [ ] **Step 6: Create `content/home.md`**

```markdown
PINTS is a one-day meeting that brings together the neuroscience, theory, and
systems community across Paris and the Ile-de-France region. Talks and posters
span experimental, computational, and theoretical work.

## Keynote

**To be announced.**

## Invited speakers

To be announced.

## Registration

Registration is free but required, so we can plan catering and poster boards.
[Create an account](login.html) to register and to submit a poster abstract.

## Sponsors

We gratefully acknowledge the support of DIM C-Brains, QLife, and Aquineuro.
```

- [ ] **Step 7: Create `content/about.md`, `content/venue.md`, `content/poster-guidelines.md`**

`content/about.md`:

```markdown
PINTS — Paris Ile-de-France Neuroscience, Theory, and Systems — is an annual
one-day meeting for the regional neuroscience community. It is deliberately
informal: a keynote, a handful of contributed talks, and a large poster session.

## Organizing committee

To be completed by the organizers.

## Previous editions

- [PINTS 2025](https://pints2025.sciencesconf.org)

## Contact

To be completed by the organizers.

## Editing this page

This page is written in markdown at `content/about.md`. Edit it directly on
GitHub and the change is live within a minute — no rebuild, no deploy step.
```

`content/venue.md`:

```markdown
**Venue to be confirmed.**

## Getting there

To be completed by the organizers: metro/RER lines, nearest stops, and access
instructions for the building.

## Accessibility

To be completed by the organizers.
```

`content/poster-guidelines.md`:

```markdown
Posters must be **no larger than A0, in portrait orientation**. Poster boards
and fixings are provided. Find your board number in the
[abstract list](abstracts.html) — it is assigned once your abstract is accepted.
```

- [ ] **Step 8: Serve locally and check every page**

Run: `npm run serve`, then open `http://127.0.0.1:4173/`.
Expected: header and nav render on every page; the active nav item is underlined; `content/*.md` renders as HTML on home, about, and venue; the browser console is clean; no request 404s in the network tab.

- [ ] **Step 9: Commit**

```bash
git add index.html about.html venue.html 404.html program.html abstracts.html participants.html login.html account.html admin.html content js/page-content.js
git commit -m "feat: static pages rendered from organizer-editable markdown"
```

---

### Task 5: Deploy to GitHub Pages and write the runbook

**Files:**
- Create: `README.md`
- Modify: nothing in code.

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: a live URL. Record it in `README.md`; Phase 1 needs it for Firebase authorized domains.

- [ ] **Step 1: Create `README.md`**

````markdown
# PINTS conference website

Static site for the PINTS meeting (Paris Ile-de-France Neuroscience, Theory, and
Systems). No build step: the repository contents *are* the deployed site.

- **Live site:** _fill in after enabling Pages_
- **Design spec:** `docs/superpowers/specs/2026-07-29-pints-website-design.md`
- **Implementation plan:** `docs/superpowers/plans/2026-07-29-pints-website.md`

## Editing page content

Page copy lives in `content/*.md`. Edit the file on GitHub, commit, and the
change is live within a minute. No other step.

## Local development

```bash
npm install
npm run vendor    # refresh vendor/ after changing marked or dompurify
npm run serve     # http://127.0.0.1:4173
npm test          # pure-function unit tests
npm run test:rules  # Firestore rules tests (needs Java for the emulator)
```

## Deployment

GitHub Pages serves the `main` branch from the repository root. Pushing to
`main` deploys. `.nojekyll` must stay in place.

## Firebase

_Filled in during Phase 1._
````

- [ ] **Step 2: Commit and push**

```bash
git add README.md
git commit -m "docs: add README with the local dev and deploy runbook"
git branch -M main
# Create the repo on GitHub first if it does not exist, then:
git remote add origin <REPO_URL>
git push -u origin main
```

- [ ] **Step 3: Enable GitHub Pages**

In the repository: **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`**. Wait for the build, then open the URL.

- [ ] **Step 4: Verify the deployed site**

Expected: every nav page loads over HTTPS, markdown renders, no console errors, and no 404s for `css/`, `js/`, `vendor/`, or `content/`. A 404 on those paths means an absolute path slipped in — fix it to be relative.

- [ ] **Step 5: Record the live URL and commit**

Replace `_fill in after enabling Pages_` in `README.md` with the real URL.

```bash
git add README.md && git commit -m "docs: record the live site URL" && git push
```

---

# Phase 1 — Auth, profiles, and the participant list

Satisfies requirements 1 and 3, and establishes the rules test harness that everything after depends on.

### Task 6: Firebase project, config, and the rules test harness

**Files:**
- Create: `js/firebase-config.js`, `js/firebase.js`, `firebase.json`, `firestore.rules`, `test/rules/helpers.mjs`, `test/rules/config.rules.test.mjs`
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `app`, `auth`, `db` from `js/firebase.js`; `makeTestEnv(): Promise<RulesTestEnvironment>`, `asUser(env, uid, opts): Firestore`, `asAnon(env): Firestore`, `seed(env, fn): Promise<void>` from `test/rules/helpers.mjs`.

- [ ] **Step 1: Create the Firebase project (manual, in the console)**

1. <https://console.firebase.google.com> → **Add project** → name it `pints-conference`. Disable Google Analytics.
2. **Build → Firestore Database → Create database → Production mode**, location `eur3 (europe-west)`.
3. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable.** Leave "Email link" off.
4. **Authentication → Settings → Authorized domains → Add domain**, and add the GitHub Pages host from Task 5 (e.g. `pints.github.io`). **Skipping this makes every sign-in fail with an opaque `auth/unauthorized-domain` error.**
5. **Project settings → General → Your apps → Web (`</>`)**, register the app, and copy the `firebaseConfig` object.

Stay on the **Spark** plan. Do not enable Storage.

- [ ] **Step 2: Create `js/firebase-config.js`**

Paste the copied object. This file is public by design — the web API key identifies the project and is not a credential. All authorization lives in `firestore.rules`.

```javascript
// Public Firebase web config. Not a secret: it identifies the project, it does
// not grant access. Authorization is enforced entirely by firestore.rules.
export const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "pints-conference.firebaseapp.com",
  projectId: "pints-conference",
  storageBucket: "pints-conference.firebasestorage.app",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME",
};
```

- [ ] **Step 3: Create `js/firebase.js`**

```javascript
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
```

- [ ] **Step 4: Create `firebase.json`**

```json
{
  "firestore": {
    "rules": "firestore.rules"
  },
  "emulators": {
    "firestore": { "port": 8080 },
    "ui": { "enabled": false },
    "singleProjectMode": true
  }
}
```

- [ ] **Step 5: Create `firestore.rules` with a deny-all baseline plus `config`**

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() { return request.auth != null; }
    function isAdmin() {
      return isSignedIn()
        && exists(/databases/$(database)/documents/admins/$(request.auth.uid));
    }

    // Site configuration: submission window and current edition.
    // Public read so every page can show the deadline; admin write only.
    match /config/{docId} {
      allow read: if true;
      allow write: if isAdmin();
    }

    // Anything not matched above is denied.
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

- [ ] **Step 6: Create `test/rules/helpers.mjs`**

```javascript
import { readFileSync } from "node:fs";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";

export const PROJECT_ID = "demo-pints-rules";

export function makeTestEnv() {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
}

/** A signed-in user. `verified` drives request.auth.token.email_verified. */
export function asUser(env, uid, { verified = true, email = `${uid}@example.org` } = {}) {
  return env.authenticatedContext(uid, { email, email_verified: verified }).firestore();
}

export function asAnon(env) {
  return env.unauthenticatedContext().firestore();
}

/** Write fixture data with rules turned off. */
export function seed(env, fn) {
  return env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));
}

/** Make `uid` an admin. */
export function seedAdmin(env, uid, setDoc, doc) {
  return seed(env, (fs) =>
    setDoc(doc(fs, "admins", uid), { email: `${uid}@example.org`, addedBy: "seed", addedAt: new Date() }));
}
```

- [ ] **Step 7: Write the failing rules test**

Create `test/rules/config.rules.test.mjs`:

```javascript
import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { asAnon, asUser, makeTestEnv, seed, seedAdmin } from "./helpers.mjs";

let env;

before(async () => { env = await makeTestEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

test("anyone can read config/site", async () => {
  await seed(env, (fs) => setDoc(doc(fs, "config", "site"), { submissionsOpen: true }));
  await assertSucceeds(getDoc(doc(asAnon(env), "config", "site")));
});

test("a signed-in non-admin cannot write config/site", async () => {
  await assertFails(setDoc(doc(asUser(env, "alice"), "config", "site"), { submissionsOpen: false }));
});

test("an admin can write config/site", async () => {
  await seedAdmin(env, "boss", setDoc, doc);
  await assertSucceeds(setDoc(doc(asUser(env, "boss"), "config", "site"), { submissionsOpen: false }));
});

test("unmatched collections are denied", async () => {
  await assertFails(getDoc(doc(asAnon(env), "whatever", "x")));
  assert.ok(true);
});
```

- [ ] **Step 8: Run the rules tests**

Run: `npm run test:rules`
Expected: PASS — 4 tests. The emulator needs Java 11+; if `firebase emulators:exec` complains, install a JDK (`brew install openjdk`) and retry. First run downloads the emulator jar.

- [ ] **Step 9: Deploy the rules**

```bash
npx firebase login
npx firebase use --add    # select the pints-conference project, alias "default"
npx firebase deploy --only firestore:rules
```

- [ ] **Step 10: Create `config/site` in the console**

**Firestore → Start collection → `config`**, document ID `site`, fields:
- `submissionsOpen` (boolean) = `true`
- `submissionDeadline` (timestamp) = a date a few months out
- `edition` (string) = `pints2026`

This document must exist before anyone submits an abstract: Phase 2 rules call `get()` on it, and a missing document makes the rule error and deny.

- [ ] **Step 11: Update `README.md`**

Replace the `## Firebase` section:

````markdown
## Firebase

Project `pints-conference`, **Spark (free) plan** — do not enable Cloud Storage
or Cloud Functions; both require Blaze.

- `js/firebase-config.js` holds the public web config. It is not a secret.
- `firestore.rules` is the only authorization boundary. Deploy it with
  `npx firebase deploy --only firestore:rules`.
- `config/site` must exist (`submissionsOpen`, `submissionDeadline`, `edition`).
- Every host that serves the site must be listed under
  **Authentication → Settings → Authorized domains**.

### Making someone an admin

1. **Authentication → Users** — find the person and copy their UID.
2. **Firestore → `admins`** — add a document whose **ID is that UID**, with
   fields `email` (string), `addedBy` (string), `addedAt` (timestamp).

The very first admin must be created this way; after that, admins can add each
other from the admin console.
````

- [ ] **Step 12: Commit**

```bash
git add js/firebase-config.js js/firebase.js firebase.json firestore.rules test/rules README.md
git commit -m "feat: firebase project wiring and the firestore rules test harness"
```

---

### Task 7: User profile rules and the admin registry

**Files:**
- Modify: `firestore.rules`
- Create: `test/rules/users.rules.test.mjs`

**Interfaces:**
- Consumes: `makeTestEnv`, `asUser`, `asAnon`, `seed`, `seedAdmin` from `test/rules/helpers.mjs`.
- Produces: the enforced shape of `users/{uid}` and `admins/{uid}` that `js/db.js` must write in Task 9.

- [ ] **Step 1: Write the failing tests**

Create `test/rules/users.rules.test.mjs`:

```javascript
import test, { after, before, beforeEach } from "node:test";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { asAnon, asUser, makeTestEnv, seed, seedAdmin } from "./helpers.mjs";

let env;
before(async () => { env = await makeTestEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const profile = (over = {}) => ({
  email: "alice@example.org",
  displayName: "Alice Dupont",
  affiliation: "ENS",
  showPublicly: true,
  edition: "pints2026",
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

test("a user can create their own profile", async () => {
  const fs = asUser(env, "alice", { email: "alice@example.org" });
  await assertSucceeds(setDoc(doc(fs, "users", "alice"), profile()));
});

test("a user cannot create a profile under someone else's uid", async () => {
  const fs = asUser(env, "alice", { email: "alice@example.org" });
  await assertFails(setDoc(doc(fs, "users", "bob"), profile()));
});

test("a user cannot claim an email that is not theirs", async () => {
  const fs = asUser(env, "alice", { email: "alice@example.org" });
  await assertFails(setDoc(doc(fs, "users", "alice"), profile({ email: "boss@example.org" })));
});

test("a user cannot smuggle unknown fields into their profile", async () => {
  const fs = asUser(env, "alice", { email: "alice@example.org" });
  await assertFails(setDoc(doc(fs, "users", "alice"), profile({ role: "admin" })));
});

test("a user cannot set an over-long display name", async () => {
  const fs = asUser(env, "alice", { email: "alice@example.org" });
  await assertFails(setDoc(doc(fs, "users", "alice"), profile({ displayName: "x".repeat(81) })));
});

test("a user cannot read another user's profile", async () => {
  await seed(env, (fs) => setDoc(doc(fs, "users", "bob"), profile({ email: "bob@example.org" })));
  await assertFails(getDoc(doc(asUser(env, "alice"), "users", "bob")));
});

test("anonymous visitors cannot read any profile", async () => {
  await seed(env, (fs) => setDoc(doc(fs, "users", "bob"), profile()));
  await assertFails(getDoc(doc(asAnon(env), "users", "bob")));
});

test("an admin can read any profile", async () => {
  await seedAdmin(env, "boss", setDoc, doc);
  await seed(env, (fs) => setDoc(doc(fs, "users", "bob"), profile()));
  await assertSucceeds(getDoc(doc(asUser(env, "boss"), "users", "bob")));
});

test("a user can read their own admins document but not another's", async () => {
  await seedAdmin(env, "boss", setDoc, doc);
  await assertSucceeds(getDoc(doc(asUser(env, "alice"), "admins", "alice")));
  await assertFails(getDoc(doc(asUser(env, "alice"), "admins", "boss")));
});

test("a non-admin cannot make themselves an admin", async () => {
  const fs = asUser(env, "alice");
  await assertFails(setDoc(doc(fs, "admins", "alice"), { email: "alice@example.org", addedBy: "self", addedAt: new Date() }));
});

test("an admin can add another admin", async () => {
  await seedAdmin(env, "boss", setDoc, doc);
  await assertSucceeds(setDoc(doc(asUser(env, "boss"), "admins", "alice"), {
    email: "alice@example.org", addedBy: "boss", addedAt: new Date(),
  }));
});

test("a user can update their own profile but not change their email", async () => {
  await seed(env, (fs) => setDoc(doc(fs, "users", "alice"), profile()));
  const fs = asUser(env, "alice", { email: "alice@example.org" });
  await assertSucceeds(updateDoc(doc(fs, "users", "alice"), { affiliation: "Sorbonne", updatedAt: new Date() }));
  await assertFails(updateDoc(doc(fs, "users", "alice"), { email: "someone@else.org" }));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:rules`
Expected: FAIL — every `assertSucceeds` case fails, because the catch-all currently denies `users` and `admins`.

- [ ] **Step 3: Add the rules**

In `firestore.rules`, insert these helpers below `isAdmin()`:

```
    function isOwner(uid) { return isSignedIn() && request.auth.uid == uid; }
    function isVerified() {
      return isSignedIn() && request.auth.token.email_verified == true;
    }
    function str(value, maxLen) {
      return value is string && value.size() > 0 && value.size() <= maxLen;
    }
    function optStr(data, field, maxLen) {
      return !(field in data) || (data[field] is string && data[field].size() <= maxLen);
    }
    function validProfile(data) {
      return data.keys().hasOnly(['email', 'displayName', 'affiliation', 'showPublicly',
                                  'edition', 'consentAt', 'createdAt', 'updatedAt'])
        && data.keys().hasAll(['email', 'displayName', 'edition'])
        && str(data.displayName, 80)
        && optStr(data, 'affiliation', 120)
        && data.edition is string
        && (!('showPublicly' in data) || data.showPublicly is bool);
    }
```

Then add these blocks *above* the `match /{document=**}` catch-all:

```
    // Admin registry. A user may read their own document so the client knows
    // whether to show admin UI; only admins may list or write.
    match /admins/{uid} {
      allow get: if isOwner(uid) || isAdmin();
      allow list: if isAdmin();
      allow write: if isAdmin();
    }

    // Private participant profile. Never public — see participants_public.
    match /users/{uid} {
      allow get: if isOwner(uid) || isAdmin();
      allow list: if isAdmin();
      allow create: if isOwner(uid)
        && validProfile(request.resource.data)
        && request.resource.data.email == request.auth.token.email;
      allow update: if isOwner(uid)
        && validProfile(request.resource.data)
        && request.resource.data.email == resource.data.email;
      allow delete: if isOwner(uid);
      allow write: if isAdmin();
    }
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm run test:rules`
Expected: PASS — all config and users tests green.

- [ ] **Step 5: Deploy and commit**

```bash
npx firebase deploy --only firestore:rules
git add firestore.rules test/rules/users.rules.test.mjs
git commit -m "feat: firestore rules for user profiles and the admin registry"
```

---

### Task 8: Authentication module and the sign-in page

**Files:**
- Create: `js/auth.js`, `js/page-login.js`
- Modify: `login.html`

**Interfaces:**
- Consumes: `auth`, `db` from `js/firebase.js`; `setAuthLink`, `mountLayout` from `js/layout.js`.
- Produces from `js/auth.js`: `signUp(email, password, remember): Promise<User>`, `signIn(email, password, remember): Promise<User>`, `signOutNow(): Promise<void>`, `sendReset(email): Promise<void>`, `sendVerification(user): Promise<void>`, `refreshVerification(user): Promise<boolean>`, `checkIsAdmin(uid): Promise<boolean>`, `onUser(callback): Unsubscribe` where callback receives `{user, isAdmin}` (`user` is `null` when signed out), `requireUser(): Promise<User>` (redirects to `login.html` if signed out), `friendlyAuthError(err): string`.

- [ ] **Step 1: Create `js/auth.js`**

```javascript
import {
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase.js";

const persistenceFor = (remember) =>
  setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);

export async function signUp(email, password, remember) {
  await persistenceFor(remember);
  const { user } = await createUserWithEmailAndPassword(auth, email, password);
  await sendEmailVerification(user);
  return user;
}

export async function signIn(email, password, remember) {
  await persistenceFor(remember);
  const { user } = await signInWithEmailAndPassword(auth, email, password);
  return user;
}

export const signOutNow = () => signOut(auth);
export const sendReset = (email) => sendPasswordResetEmail(auth, email);
export const sendVerification = (user) => sendEmailVerification(user);

/**
 * Pull a fresh ID token so request.auth.token.email_verified reflects reality.
 *
 * Clicking the verification link does NOT update the token already held by this
 * tab: it stays false for up to an hour. Without this, a user who verifies and
 * immediately submits gets PERMISSION_DENIED that "fixes itself" later.
 */
export async function refreshVerification(user) {
  if (!user) return false;
  await user.reload();
  await user.getIdToken(true);
  return user.emailVerified;
}

export async function checkIsAdmin(uid) {
  if (!uid) return false;
  try {
    const snap = await getDoc(doc(db, "admins", uid));
    return snap.exists();
  } catch {
    return false;
  }
}

/** Subscribe to auth state, resolving admin status before each callback. */
export function onUser(callback) {
  return onAuthStateChanged(auth, async (user) => {
    callback({ user, isAdmin: user ? await checkIsAdmin(user.uid) : false });
  });
}

/** Resolve with the signed-in user, or redirect to the sign-in page. */
export function requireUser() {
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, (user) => {
      stop();
      if (user) resolve(user);
      else location.replace("login.html");
    });
  });
}

const MESSAGES = {
  "auth/email-already-in-use": "That email already has an account. Try signing in instead.",
  "auth/invalid-email": "That does not look like a valid email address.",
  "auth/weak-password": "Passwords must be at least 6 characters.",
  "auth/invalid-credential": "Wrong email or password.",
  "auth/wrong-password": "Wrong email or password.",
  "auth/user-not-found": "Wrong email or password.",
  "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
  "auth/unauthorized-domain": "This site is not an authorized domain for the Firebase project. An organizer needs to add it under Authentication → Settings → Authorized domains.",
  "auth/network-request-failed": "Network error. Check your connection and try again.",
};

export const friendlyAuthError = (err) =>
  MESSAGES[err?.code] ?? `Something went wrong (${err?.code ?? "unknown"}).`;
```

- [ ] **Step 2: Replace the body of `login.html`**

```html
<main class="wrap">
  <h1>Sign in</h1>
  <p class="prose muted">Registration is free. You need an account to register for
    PINTS and to submit a poster abstract.</p>

  <div id="msg" class="msg" role="status" aria-live="polite"></div>

  <form id="auth-form" novalidate>
    <label for="email">Email
      <span class="hint">Use your institutional address if you have one.</span>
    </label>
    <input id="email" name="email" type="email" autocomplete="email" required>

    <label for="password">Password
      <span class="hint">At least 6 characters.</span>
    </label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>

    <div class="checkline">
      <input id="remember" type="checkbox" checked>
      <label for="remember">Remember me on this device</label>
    </div>

    <div class="actions">
      <button id="signin" type="submit">Sign in</button>
      <button id="signup" type="button" class="secondary">Create an account</button>
      <button id="reset" type="button" class="secondary">Forgot password</button>
    </div>
  </form>
</main>
```

Change the page's script tag to `<script type="module" src="js/page-login.js"></script>`.

- [ ] **Step 3: Create `js/page-login.js`**

```javascript
import { mountLayout, setAuthLink } from "./layout.js";
import { friendlyAuthError, onUser, sendReset, signIn, signUp } from "./auth.js";

mountLayout();

const form = document.getElementById("auth-form");
const msg = document.getElementById("msg");
const emailEl = document.getElementById("email");
const passwordEl = document.getElementById("password");
const rememberEl = document.getElementById("remember");
const buttons = [...document.querySelectorAll("#auth-form button")];

function say(text, kind = "ok") {
  msg.className = `msg ${kind}`;
  msg.textContent = text;
}

function busy(state) {
  for (const b of buttons) b.disabled = state;
}

async function run(fn) {
  busy(true);
  try {
    await fn();
  } catch (err) {
    say(friendlyAuthError(err), "err");
    console.error("[pints] auth", err);
  } finally {
    busy(false);
  }
}

// Signing up changes auth state, which would immediately redirect and discard
// the "check your inbox" message. Hold the user here until they choose to move on.
let justSignedUp = false;

onUser(({ user, isAdmin }) => {
  setAuthLink({ signedIn: Boolean(user), isAdmin });
  if (user && !justSignedUp) location.replace(isAdmin ? "admin.html" : "account.html");
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  run(() => signIn(emailEl.value.trim(), passwordEl.value, rememberEl.checked));
});

document.getElementById("signup").addEventListener("click", () =>
  run(async () => {
    justSignedUp = true;
    await signUp(emailEl.value.trim(), passwordEl.value, rememberEl.checked);
    msg.className = "msg ok";
    const link = document.createElement("a");
    link.href = "account.html";
    link.textContent = "complete your registration";
    msg.replaceChildren(
      document.createTextNode("Account created. Check your inbox for a verification link, then "),
      link,
      document.createTextNode("."),
    );
  }));

document.getElementById("reset").addEventListener("click", () =>
  run(async () => {
    const email = emailEl.value.trim();
    if (!email) return say("Enter your email address first.", "warn");
    await sendReset(email);
    say("If that address has an account, a reset link is on its way.", "ok");
  }));
```

- [ ] **Step 4: Teach the static pages about auth state**

`js/page-content.js` was written in Phase 0, before Firebase existed, so its header always reads "Sign in". Now that `auth.js` exists, add the subscription. Insert after the `mountLayout();` line in `js/page-content.js`:

```javascript
import { onUser } from "./auth.js";
import { setAuthLink } from "./layout.js";

onUser(({ user, isAdmin }) => setAuthLink({ signedIn: Boolean(user), isAdmin }));
```

Merge the `setAuthLink` import into the existing `./layout.js` import line rather than adding a second one. This is the reason Phase 0 could not do it: importing `auth.js` pulls in `firebase-config.js`, which did not exist yet.

- [ ] **Step 5: Verify manually**

Run: `npm run serve`, open `http://127.0.0.1:4173/login.html`.
Expected: creating an account shows "Account created. Check your inbox…" with a link onward (no immediate redirect); signing in redirects to `account.html`; a wrong password shows "Wrong email or password."; the header link reads "My account" on `index.html` and the other static pages while signed in. If you see `auth/unauthorized-domain` for `127.0.0.1`, add `127.0.0.1` and `localhost` to the Firebase authorized domains list.

- [ ] **Step 6: Commit**

```bash
git add js/auth.js js/page-login.js js/page-content.js login.html
git commit -m "feat: email/password auth with verification, reset, and persistence toggle"
```

---

### Task 9: Profile, consent, and the participants projection

**Files:**
- Create: `js/db.js`, `js/page-account.js`
- Modify: `account.html`, `firestore.rules`
- Create: `test/rules/participants.rules.test.mjs`

**Interfaces:**
- Consumes: `db` from `js/firebase.js`; `requireUser`, `refreshVerification`, `signOutNow`, `checkIsAdmin` from `js/auth.js`; `CURRENT_EDITION`, `LIMITS` from `js/config.mjs`.
- Produces from `js/db.js`: `getProfile(uid): Promise<object|null>`, `saveProfile(uid, {email, displayName, affiliation, showPublicly}): Promise<void>` (writes `users/{uid}` **and** creates or deletes `participants_public/{uid}` in one batch), `listPublicParticipants(): Promise<object[]>`.

- [ ] **Step 1: Write the failing rules tests**

Create `test/rules/participants.rules.test.mjs`:

```javascript
import test, { after, before, beforeEach } from "node:test";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDocs, collection, setDoc } from "firebase/firestore";
import { asAnon, asUser, makeTestEnv, seed, seedAdmin } from "./helpers.mjs";

let env;
before(async () => { env = await makeTestEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const pub = (over = {}) => ({
  displayName: "Alice Dupont",
  affiliation: "ENS",
  edition: "pints2026",
  updatedAt: new Date(),
  ...over,
});

test("anyone can list public participants", async () => {
  await seed(env, (fs) => setDoc(doc(fs, "participants_public", "alice"), pub()));
  await assertSucceeds(getDocs(collection(asAnon(env), "participants_public")));
});

test("a user can publish their own name", async () => {
  await assertSucceeds(setDoc(doc(asUser(env, "alice"), "participants_public", "alice"), pub()));
});

test("a user cannot publish someone else's name", async () => {
  await assertFails(setDoc(doc(asUser(env, "alice"), "participants_public", "bob"), pub()));
});

test("a user cannot smuggle extra fields into the public projection", async () => {
  await assertFails(setDoc(doc(asUser(env, "alice"), "participants_public", "alice"),
    pub({ email: "alice@example.org" })));
});

test("a user cannot publish an over-long display name or affiliation", async () => {
  const fs = asUser(env, "alice");
  await assertFails(setDoc(doc(fs, "participants_public", "alice"), pub({ displayName: "x".repeat(81) })));
  await assertFails(setDoc(doc(fs, "participants_public", "alice"), pub({ affiliation: "y".repeat(121) })));
});

test("a user can withdraw their own name", async () => {
  await seed(env, (fs) => setDoc(doc(fs, "participants_public", "alice"), pub()));
  await assertSucceeds(deleteDoc(doc(asUser(env, "alice"), "participants_public", "alice")));
});

test("a user cannot delete someone else's public entry", async () => {
  await seed(env, (fs) => setDoc(doc(fs, "participants_public", "bob"), pub()));
  await assertFails(deleteDoc(doc(asUser(env, "alice"), "participants_public", "bob")));
});

test("an admin can remove any public entry", async () => {
  await seedAdmin(env, "boss", setDoc, doc);
  await seed(env, (fs) => setDoc(doc(fs, "participants_public", "bob"), pub()));
  await assertSucceeds(deleteDoc(doc(asUser(env, "boss"), "participants_public", "bob")));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:rules`
Expected: FAIL — `participants_public` is still caught by the deny-all.

- [ ] **Step 3: Add the rules**

Insert above the catch-all in `firestore.rules`:

```
    // Public projection of a participant's name. Written by the participant
    // themselves: the existence of this document IS the consent record.
    //
    // Deliberately no get() on users/{uid}.showPublicly. A get() would read
    // pre-batch state and so break the single writeBatch that flips consent and
    // publishes in one go — and it buys no confidentiality, because a user can
    // only ever publish their own name.
    match /participants_public/{uid} {
      allow read: if true;
      allow create, update: if isOwner(uid)
        && request.resource.data.keys().hasOnly(['displayName', 'affiliation', 'edition', 'updatedAt'])
        && str(request.resource.data.displayName, 80)
        && optStr(request.resource.data, 'affiliation', 120)
        && request.resource.data.edition is string;
      allow delete: if isOwner(uid) || isAdmin();
    }
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm run test:rules`
Expected: PASS — all rules tests green.

- [ ] **Step 5: Create `js/db.js`**

```javascript
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { db } from "./firebase.js";
import { CURRENT_EDITION } from "./config.mjs";

const snapData = (snap) => ({ id: snap.id, ...snap.data() });

export async function getProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snapData(snap) : null;
}

/**
 * Save the profile and reconcile the public projection in a single batch.
 * Firestore rules cannot expose only some fields of users/{uid}, so the public
 * name list is a separate collection written here.
 */
export async function saveProfile(uid, { email, displayName, affiliation, showPublicly }) {
  const batch = writeBatch(db);
  const clean = {
    email,
    displayName: displayName.trim(),
    affiliation: (affiliation ?? "").trim(),
    showPublicly: Boolean(showPublicly),
    edition: CURRENT_EDITION,
    updatedAt: serverTimestamp(),
  };
  batch.set(doc(db, "users", uid), clean, { merge: true });

  const publicRef = doc(db, "participants_public", uid);
  if (showPublicly) {
    batch.set(publicRef, {
      displayName: clean.displayName,
      affiliation: clean.affiliation,
      edition: CURRENT_EDITION,
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.delete(publicRef);
  }
  await batch.commit();
}

export async function listPublicParticipants() {
  const q = query(collection(db, "participants_public"), where("edition", "==", CURRENT_EDITION));
  const snap = await getDocs(q);
  return snap.docs.map(snapData);
}
```

Note: `createdAt` is intentionally omitted — `merge: true` keeps whatever is already there, and the rules allowlist permits its absence.

- [ ] **Step 6: Replace the body of `account.html`**

```html
<main class="wrap">
  <h1>My account</h1>
  <div id="verify-banner" class="msg warn" hidden></div>
  <div id="msg" class="msg" role="status" aria-live="polite"></div>

  <section>
    <h2>Registration details</h2>
    <form id="profile-form" novalidate>
      <label for="displayName">Full name
        <span class="hint">As you want it to appear on the participant list.</span>
      </label>
      <input id="displayName" type="text" maxlength="80" autocomplete="name" required>

      <label for="affiliation">Affiliation
        <span class="hint">Lab, institute, or university. Optional.</span>
      </label>
      <input id="affiliation" type="text" maxlength="120" autocomplete="organization">

      <div class="checkline">
        <input id="showPublicly" type="checkbox">
        <label for="showPublicly">Show my name and affiliation on the public
          <a href="participants.html">participant list</a>
          <span class="hint">You can turn this off at any time; your entry is removed immediately.</span>
        </label>
      </div>

      <div class="actions">
        <button type="submit">Save</button>
        <button type="button" id="signout" class="secondary">Sign out</button>
      </div>
    </form>
  </section>

  <section id="abstract-section" hidden></section>
</main>
```

Set the script tag to `<script type="module" src="js/page-account.js"></script>`.

- [ ] **Step 7: Create `js/page-account.js`**

```javascript
import { mountLayout, setAuthLink } from "./layout.js";
import { checkIsAdmin, refreshVerification, requireUser, sendVerification, signOutNow } from "./auth.js";
import { getProfile, saveProfile } from "./db.js";

mountLayout();

const msg = document.getElementById("msg");
const banner = document.getElementById("verify-banner");
const form = document.getElementById("profile-form");
const nameEl = document.getElementById("displayName");
const affEl = document.getElementById("affiliation");
const showEl = document.getElementById("showPublicly");

const say = (text, kind = "ok") => {
  msg.className = `msg ${kind}`;
  msg.textContent = text;
};

const user = await requireUser();
setAuthLink({ signedIn: true, isAdmin: await checkIsAdmin(user.uid) });

// Force a token refresh so email_verified is current. Clicking the verification
// link does not update the token this tab already holds.
const verified = await refreshVerification(user);
if (!verified) {
  banner.hidden = false;
  banner.textContent = "Your email is not verified yet. ";
  const again = document.createElement("button");
  again.type = "button";
  again.className = "secondary";
  again.textContent = "Resend the verification email";
  again.addEventListener("click", async () => {
    await sendVerification(user);
    say("Verification email sent.", "ok");
  });
  banner.append(again);
}

const profile = await getProfile(user.uid);
nameEl.value = profile?.displayName ?? user.displayName ?? "";
affEl.value = profile?.affiliation ?? "";
showEl.checked = Boolean(profile?.showPublicly);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const displayName = nameEl.value.trim();
  if (!displayName) return say("Your full name is required.", "err");
  try {
    await saveProfile(user.uid, {
      email: user.email,
      displayName,
      affiliation: affEl.value,
      showPublicly: showEl.checked,
    });
    say(showEl.checked
      ? "Saved. Your name is now on the public participant list."
      : "Saved. Your name is not shown publicly.", "ok");
  } catch (err) {
    say("Could not save your details. Please try again.", "err");
    console.error("[pints] saveProfile", err);
  }
});

document.getElementById("signout").addEventListener("click", async () => {
  await signOutNow();
  location.replace("index.html");
});

export { user, verified };
```

- [ ] **Step 8: Verify manually**

Run: `npm run serve` → sign in → `account.html`.
Expected: the form loads existing values; saving with the checkbox ticked creates `participants_public/<uid>` in the Firestore console; unticking and saving deletes it; the unverified banner appears before verification and disappears after clicking the link and reloading.

- [ ] **Step 9: Commit**

```bash
git add js/db.js js/page-account.js account.html firestore.rules test/rules/participants.rules.test.mjs
git commit -m "feat: participant profile with opt-in public listing via a projection collection"
```

---

### Task 10: The public participant list

**Files:**
- Create: `js/participant-utils.mjs`, `js/page-participants.js`
- Modify: `participants.html`
- Test: `test/participant-utils.test.mjs`

**Interfaces:**
- Consumes: `listPublicParticipants` from `js/db.js`.
- Produces: `lastNameKey(displayName): string`, `sortParticipants(list): object[]` from `js/participant-utils.mjs`.

- [ ] **Step 1: Write the failing test**

Create `test/participant-utils.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { lastNameKey, sortParticipants } from "../js/participant-utils.mjs";

test("lastNameKey takes the final whitespace-separated token", () => {
  assert.equal(lastNameKey("Alice Dupont"), "Dupont");
  assert.equal(lastNameKey("Jean-Luc  de  Villiers"), "Villiers");
  assert.equal(lastNameKey("  Cher  "), "Cher");
  assert.equal(lastNameKey(""), "");
});

test("sortParticipants orders by last name", () => {
  const sorted = sortParticipants([
    { displayName: "Zoe Aaron" },
    { displayName: "Alice Dupont" },
    { displayName: "Bob Castel" },
  ]);
  assert.deepEqual(sorted.map((p) => p.displayName), ["Zoe Aaron", "Bob Castel", "Alice Dupont"]);
});

test("sortParticipants is accent-insensitive", () => {
  const sorted = sortParticipants([
    { displayName: "X Zeta" },
    { displayName: "Y Émile" },
    { displayName: "Z Fabre" },
  ]);
  assert.deepEqual(sorted.map((p) => p.displayName), ["Y Émile", "Z Fabre", "X Zeta"]);
});

test("sortParticipants breaks last-name ties on the full name", () => {
  const sorted = sortParticipants([
    { displayName: "Zoe Martin" },
    { displayName: "Anne Martin" },
  ]);
  assert.deepEqual(sorted.map((p) => p.displayName), ["Anne Martin", "Zoe Martin"]);
});

test("sortParticipants does not mutate its input", () => {
  const input = [{ displayName: "B B" }, { displayName: "A A" }];
  sortParticipants(input);
  assert.deepEqual(input.map((p) => p.displayName), ["B B", "A A"]);
});

test("sortParticipants tolerates missing names", () => {
  const sorted = sortParticipants([{ displayName: "A Zed" }, {}, { displayName: "" }]);
  assert.equal(sorted.length, 3);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../js/participant-utils.mjs'`

- [ ] **Step 3: Create `js/participant-utils.mjs`**

```javascript
// Accent- and case-insensitive so "Émile" sorts with "Emile", which is what
// people expect from an academic name list.
const collator = new Intl.Collator("en", { sensitivity: "base", ignorePunctuation: true });

/** Surname key: the last whitespace-separated token of a display name. */
export function lastNameKey(displayName) {
  const parts = String(displayName ?? "").trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

/** Sort by surname, then by full name. Returns a new array. */
export function sortParticipants(list) {
  return [...list].sort((a, b) =>
    collator.compare(lastNameKey(a?.displayName), lastNameKey(b?.displayName)) ||
    collator.compare(String(a?.displayName ?? ""), String(b?.displayName ?? "")));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Replace the body of `participants.html`**

```html
<main class="wrap">
  <h1>Registered participants</h1>
  <p class="prose muted">People who chose to have their name listed. Registered
    participants can opt in or out at any time from
    <a href="account.html">their account page</a>.</p>
  <p id="count" class="muted"></p>
  <div id="msg" class="msg" role="status" aria-live="polite"></div>
  <div class="table-scroll">
    <table>
      <thead><tr><th scope="col">Name</th><th scope="col">Affiliation</th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
  </div>
</main>
```

Set the script tag to `<script type="module" src="js/page-participants.js"></script>`.

- [ ] **Step 6: Create `js/page-participants.js`**

```javascript
import { mountLayout, setAuthLink } from "./layout.js";
import { onUser } from "./auth.js";
import { listPublicParticipants } from "./db.js";
import { sortParticipants } from "./participant-utils.mjs";

mountLayout();
onUser(({ user, isAdmin }) => setAuthLink({ signedIn: Boolean(user), isAdmin }));

const rows = document.getElementById("rows");
const count = document.getElementById("count");
const msg = document.getElementById("msg");

try {
  const people = sortParticipants(await listPublicParticipants());
  count.textContent = people.length === 1 ? "1 participant listed." : `${people.length} participants listed.`;
  for (const person of people) {
    const tr = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = person.displayName ?? "";
    const aff = document.createElement("td");
    aff.textContent = person.affiliation ?? "";
    tr.append(name, aff);
    rows.append(tr);
  }
  if (!people.length) {
    msg.className = "msg warn";
    msg.textContent = "No one has opted in to the public list yet.";
  }
} catch (err) {
  msg.className = "msg err";
  msg.textContent = "Could not load the participant list.";
  console.error("[pints] participants", err);
}
```

Note the use of `textContent`, never `innerHTML`: these are user-supplied strings.

- [ ] **Step 7: Verify manually**

Expected: the page lists opted-in participants sorted by surname, works when signed out, and shows the empty-state message when nobody has opted in.

- [ ] **Step 8: Commit**

```bash
git add js/participant-utils.mjs js/page-participants.js participants.html test/participant-utils.test.mjs
git commit -m "feat: public participant list sorted by surname"
```

---

# Phase 2 — Abstract submission and review

Satisfies requirements 2 and 5, and lands the CSV export that stands in for requirement 7.

### Task 11: Abstract domain logic

**Files:**
- Create: `js/abstract-validation-utils.mjs`, `js/abstract-utils.mjs`
- Test: `test/abstract-validation-utils.test.mjs`, `test/abstract-utils.test.mjs`

**Interfaces:**
- Consumes: `LIMITS`, `ABSTRACT_TYPES` from `js/config.mjs`.
- Produces from `js/abstract-validation-utils.mjs`: `parseAffiliations(text): string[]`, `parseAffiliationIndexes(input): number[]`, `validateAbstract(input, opts): {valid: boolean, errors: string[]}` where `opts` is `{now?: Date, submissionsOpen?: boolean, deadline?: Date|string|null}`.
- Produces from `js/abstract-utils.mjs`: `authorLineParts(authors): {name, marks, presenting}[]`, `nextPosterNumber(publicAbstracts): number`, `filterAbstracts(list, term): object[]`, `sortPublicAbstracts(list): object[]`.

The canonical abstract shape, used everywhere from here on:

```javascript
{
  ownerUid: "uid",
  edition: "pints2026",
  title: "string",
  affiliations: ["ENS", "Sorbonne"],           // display order; index 0 is superscript 1
  authors: [{ name: "Alice Dupont", affiliationIndexes: [0], presenting: true }],
  body: "markdown string",
  type: "poster" | "talk",
  status: "submitted" | "accepted" | "rejected" | "withdrawn",
  createdAt, updatedAt
}
```

- [ ] **Step 1: Write the failing validation test**

Create `test/abstract-validation-utils.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAffiliationIndexes,
  parseAffiliations,
  validateAbstract,
} from "../js/abstract-validation-utils.mjs";

const good = (over = {}) => ({
  title: "Recurrent dynamics in mouse V1",
  affiliations: ["ENS", "Sorbonne"],
  authors: [
    { name: "Alice Dupont", affiliationIndexes: [0], presenting: true },
    { name: "Bob Martin", affiliationIndexes: [0, 1], presenting: false },
  ],
  body: "We recorded from mouse V1 and found *structure*.",
  type: "poster",
  ...over,
});

const openNow = { now: new Date("2026-09-01"), submissionsOpen: true, deadline: new Date("2026-10-01") };

test("parseAffiliations splits lines and drops blanks", () => {
  assert.deepEqual(parseAffiliations("ENS\n\n  Sorbonne  \n"), ["ENS", "Sorbonne"]);
  assert.deepEqual(parseAffiliations(""), []);
});

test("parseAffiliationIndexes converts 1-based input to 0-based indexes", () => {
  assert.deepEqual(parseAffiliationIndexes("1,2"), [0, 1]);
  assert.deepEqual(parseAffiliationIndexes(" 3 "), [2]);
  assert.deepEqual(parseAffiliationIndexes(""), []);
  assert.deepEqual(parseAffiliationIndexes("2 1"), [1, 0]);
});

test("a well-formed abstract validates", () => {
  assert.deepEqual(validateAbstract(good(), openNow), { valid: true, errors: [] });
});

test("title and body are required", () => {
  const { errors } = validateAbstract(good({ title: "   ", body: "" }), openNow);
  assert.ok(errors.some((e) => /Title is required/.test(e)));
  assert.ok(errors.some((e) => /body is required/i.test(e)));
});

test("title and body respect the configured limits", () => {
  const { errors } = validateAbstract(good({ title: "x".repeat(201), body: "y".repeat(2501) }), openNow);
  assert.ok(errors.some((e) => /Title must be 200/.test(e)));
  assert.ok(errors.some((e) => /2500/.test(e)));
});

test("at least one author is required and each needs a name", () => {
  assert.ok(validateAbstract(good({ authors: [] }), openNow)
    .errors.some((e) => /At least one author/.test(e)));
  assert.ok(validateAbstract(good({ authors: [{ name: "  ", presenting: true }] }), openNow)
    .errors.some((e) => /Author 1 needs a name/.test(e)));
});

test("an author cannot point at a non-existent affiliation", () => {
  const { errors } = validateAbstract(
    good({ authors: [{ name: "Alice", affiliationIndexes: [5], presenting: true }] }), openNow);
  assert.ok(errors.some((e) => /Author 1 refers to affiliation 6/.test(e)));
});

test("exactly one presenting author is required", () => {
  assert.ok(validateAbstract(good({
    authors: [{ name: "A", affiliationIndexes: [], presenting: false }],
  }), openNow).errors.some((e) => /Mark one presenting author/.test(e)));

  assert.ok(validateAbstract(good({
    authors: [
      { name: "A", affiliationIndexes: [], presenting: true },
      { name: "B", affiliationIndexes: [], presenting: true },
    ],
  }), openNow).errors.some((e) => /only one presenting author/i.test(e)));
});

test("the presentation type must be poster or talk", () => {
  assert.ok(validateAbstract(good({ type: "keynote" }), openNow)
    .errors.some((e) => /poster or talk/.test(e)));
});

test("submissions closed and passed deadlines are rejected", () => {
  assert.ok(validateAbstract(good(), { ...openNow, submissionsOpen: false })
    .errors.some((e) => /closed/i.test(e)));
  assert.ok(validateAbstract(good(), { ...openNow, now: new Date("2026-10-02") })
    .errors.some((e) => /deadline/i.test(e)));
});

test("too many authors or affiliations is rejected", () => {
  const authors = Array.from({ length: 21 }, (_, i) => ({ name: `A${i}`, affiliationIndexes: [], presenting: i === 0 }));
  assert.ok(validateAbstract(good({ authors }), openNow).errors.some((e) => /20 authors/.test(e)));
  const affiliations = Array.from({ length: 11 }, (_, i) => `Lab ${i}`);
  assert.ok(validateAbstract(good({ affiliations }), openNow).errors.some((e) => /10 affiliations/.test(e)));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../js/abstract-validation-utils.mjs'`

- [ ] **Step 3: Create `js/abstract-validation-utils.mjs`**

```javascript
import { ABSTRACT_TYPES, LIMITS } from "./config.mjs";

/** One affiliation per line; blanks dropped. */
export function parseAffiliations(text) {
  return String(text ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
}

/** "1,2" (what the author types) -> [0,1] (what we store). */
export function parseAffiliationIndexes(input) {
  return String(input ?? "").trim()
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((token) => Number(token) - 1);
}

/**
 * Validate an abstract before writing it. The rules enforce the same limits
 * server-side; this exists to give people a readable list of problems.
 */
export function validateAbstract(input, { now = new Date(), submissionsOpen = true, deadline = null } = {}) {
  const errors = [];
  const title = String(input?.title ?? "").trim();
  const body = String(input?.body ?? "").trim();
  const authors = Array.isArray(input?.authors) ? input.authors : [];
  const affiliations = Array.isArray(input?.affiliations) ? input.affiliations : [];

  if (!submissionsOpen) errors.push("Submissions are closed.");
  if (deadline && now > new Date(deadline)) errors.push("The submission deadline has passed.");

  if (!title) errors.push("Title is required.");
  else if (title.length > LIMITS.title) errors.push(`Title must be ${LIMITS.title} characters or fewer.`);

  if (!body) errors.push("Abstract body is required.");
  else if (body.length > LIMITS.body) errors.push(`Abstract must be ${LIMITS.body} characters or fewer.`);

  if (affiliations.length > LIMITS.affiliations) errors.push(`No more than ${LIMITS.affiliations} affiliations.`);

  if (authors.length === 0) errors.push("At least one author is required.");
  else if (authors.length > LIMITS.authors) errors.push(`No more than ${LIMITS.authors} authors.`);

  authors.forEach((author, i) => {
    if (!String(author?.name ?? "").trim()) errors.push(`Author ${i + 1} needs a name.`);
    for (const index of author?.affiliationIndexes ?? []) {
      if (!Number.isInteger(index) || index < 0 || index >= affiliations.length) {
        errors.push(`Author ${i + 1} refers to affiliation ${index + 1}, which does not exist.`);
      }
    }
  });

  const presenting = authors.filter((a) => a?.presenting).length;
  if (presenting === 0) errors.push("Mark one presenting author.");
  else if (presenting > 1) errors.push("There can be only one presenting author.");

  if (!ABSTRACT_TYPES.includes(input?.type)) errors.push("Presentation type must be poster or talk.");

  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the display helpers**

Create `test/abstract-utils.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import {
  authorLineParts,
  filterAbstracts,
  nextPosterNumber,
  sortPublicAbstracts,
} from "../js/abstract-utils.mjs";

test("authorLineParts renders 1-based affiliation marks", () => {
  assert.deepEqual(
    authorLineParts([
      { name: " Alice Dupont ", affiliationIndexes: [0], presenting: true },
      { name: "Bob Martin", affiliationIndexes: [0, 1], presenting: false },
      { name: "Cleo Ba", affiliationIndexes: [], presenting: false },
    ]),
    [
      { name: "Alice Dupont", marks: "1", presenting: true },
      { name: "Bob Martin", marks: "1,2", presenting: false },
      { name: "Cleo Ba", marks: "", presenting: false },
    ],
  );
});

test("authorLineParts tolerates missing input", () => {
  assert.deepEqual(authorLineParts(undefined), []);
});

test("nextPosterNumber starts at 1 and fills after the highest", () => {
  assert.equal(nextPosterNumber([]), 1);
  assert.equal(nextPosterNumber([{ posterNumber: 1 }, { posterNumber: 4 }]), 5);
  assert.equal(nextPosterNumber([{ posterNumber: null }, { posterNumber: 2 }]), 3);
});

test("filterAbstracts matches title, author names, and body, case-insensitively", () => {
  const list = [
    { title: "Recurrent dynamics", body: "V1 recordings", authors: [{ name: "Alice Dupont" }] },
    { title: "Dendritic computation", body: "modelling", authors: [{ name: "Bob Martin" }] },
  ];
  assert.equal(filterAbstracts(list, "recurrent").length, 1);
  assert.equal(filterAbstracts(list, "DUPONT").length, 1);
  assert.equal(filterAbstracts(list, "modelling").length, 1);
  assert.equal(filterAbstracts(list, "").length, 2);
  assert.equal(filterAbstracts(list, "   ").length, 2);
  assert.equal(filterAbstracts(list, "nothing here").length, 0);
});

test("sortPublicAbstracts puts talks before posters, then orders by poster number", () => {
  const sorted = sortPublicAbstracts([
    { type: "poster", posterNumber: 2, title: "B" },
    { type: "talk", posterNumber: null, title: "Z" },
    { type: "poster", posterNumber: 1, title: "A" },
    { type: "talk", posterNumber: null, title: "A" },
  ]);
  assert.deepEqual(sorted.map((a) => `${a.type}:${a.title}`),
    ["talk:A", "talk:Z", "poster:A", "poster:B"]);
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../js/abstract-utils.mjs'`

- [ ] **Step 7: Create `js/abstract-utils.mjs`**

```javascript
const collator = new Intl.Collator("en", { sensitivity: "base" });

/** Author names with their 1-based affiliation superscript marks. */
export function authorLineParts(authors) {
  return (authors ?? []).map((author) => ({
    name: String(author?.name ?? "").trim(),
    marks: (author?.affiliationIndexes ?? []).map((i) => i + 1).join(","),
    presenting: Boolean(author?.presenting),
  }));
}

/** The next free poster board number. */
export function nextPosterNumber(publicAbstracts) {
  const used = (publicAbstracts ?? [])
    .map((a) => a?.posterNumber)
    .filter((n) => Number.isInteger(n));
  return used.length ? Math.max(...used) + 1 : 1;
}

/** Free-text search over title, author names, and body. */
export function filterAbstracts(list, term) {
  const needle = String(term ?? "").trim().toLowerCase();
  if (!needle) return [...list];
  return list.filter((a) => {
    const haystack = [
      a?.title ?? "",
      a?.body ?? "",
      ...(a?.authors ?? []).map((au) => au?.name ?? ""),
      ...(a?.affiliations ?? []),
    ].join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}

/** Talks first, then posters by board number; ties broken on title. */
export function sortPublicAbstracts(list) {
  const rank = (a) => (a?.type === "talk" ? 0 : 1);
  return [...list].sort((a, b) =>
    rank(a) - rank(b) ||
    (a?.posterNumber ?? Number.MAX_SAFE_INTEGER) - (b?.posterNumber ?? Number.MAX_SAFE_INTEGER) ||
    collator.compare(String(a?.title ?? ""), String(b?.title ?? "")));
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npm test`
Expected: PASS — all unit suites green.

- [ ] **Step 9: Commit**

```bash
git add js/abstract-validation-utils.mjs js/abstract-utils.mjs test/abstract-validation-utils.test.mjs test/abstract-utils.test.mjs
git commit -m "feat: abstract validation and display helpers"
```

---

### Task 12: Abstract security rules

**Files:**
- Modify: `firestore.rules`
- Create: `test/rules/abstracts.rules.test.mjs`

**Interfaces:**
- Consumes: the helper functions already in `firestore.rules`.
- Produces: the enforced shape of `abstracts/{uid}`, `abstracts_public/{uid}`, `abstract_reviews/{uid}`.

- [ ] **Step 1: Write the failing tests**

Create `test/rules/abstracts.rules.test.mjs`:

```javascript
import test, { after, before, beforeEach } from "node:test";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { asAnon, asUser, makeTestEnv, seed, seedAdmin } from "./helpers.mjs";

let env;
before(async () => { env = await makeTestEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const FUTURE = new Date(Date.now() + 30 * 864e5);
const PAST = new Date(Date.now() - 864e5);

const openSubmissions = (deadline = FUTURE) =>
  seed(env, (fs) => setDoc(doc(fs, "config", "site"),
    { submissionsOpen: true, submissionDeadline: deadline, edition: "pints2026" }));

const closedSubmissions = () =>
  seed(env, (fs) => setDoc(doc(fs, "config", "site"),
    { submissionsOpen: false, submissionDeadline: FUTURE, edition: "pints2026" }));

const abstract = (over = {}) => ({
  ownerUid: "alice",
  edition: "pints2026",
  title: "Recurrent dynamics in mouse V1",
  affiliations: ["ENS"],
  authors: [{ name: "Alice Dupont", affiliationIndexes: [0], presenting: true }],
  body: "We recorded from V1.",
  type: "poster",
  status: "submitted",
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

test("a verified owner can submit while the window is open", async () => {
  await openSubmissions();
  await assertSucceeds(setDoc(doc(asUser(env, "alice"), "abstracts", "alice"), abstract()));
});

test("an unverified user cannot submit", async () => {
  await openSubmissions();
  const fs = asUser(env, "alice", { verified: false });
  await assertFails(setDoc(doc(fs, "abstracts", "alice"), abstract()));
});

test("an anonymous visitor cannot submit", async () => {
  await openSubmissions();
  await assertFails(setDoc(doc(asAnon(env), "abstracts", "alice"), abstract()));
});

test("nobody can submit once submissions are toggled closed", async () => {
  await closedSubmissions();
  await assertFails(setDoc(doc(asUser(env, "alice"), "abstracts", "alice"), abstract()));
});

test("nobody can submit once the deadline has passed, even if the toggle was forgotten", async () => {
  await openSubmissions(PAST);
  await assertFails(setDoc(doc(asUser(env, "alice"), "abstracts", "alice"), abstract()));
});

test("a user cannot submit under another user's document id", async () => {
  await openSubmissions();
  await assertFails(setDoc(doc(asUser(env, "alice"), "abstracts", "bob"), abstract({ ownerUid: "bob" })));
});

test("a user cannot self-accept", async () => {
  await openSubmissions();
  await assertFails(setDoc(doc(asUser(env, "alice"), "abstracts", "alice"), abstract({ status: "accepted" })));
});

test("oversized fields and unknown keys are rejected", async () => {
  await openSubmissions();
  const fs = asUser(env, "alice");
  await assertFails(setDoc(doc(fs, "abstracts", "alice"), abstract({ title: "x".repeat(201) })));
  await assertFails(setDoc(doc(fs, "abstracts", "alice"), abstract({ body: "y".repeat(2501) })));
  await assertFails(setDoc(doc(fs, "abstracts", "alice"), abstract({ posterNumber: 3 })));
  await assertFails(setDoc(doc(fs, "abstracts", "alice"), abstract({ type: "keynote" })));
});

test("an owner can edit their abstract while it is still submitted", async () => {
  await openSubmissions();
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "alice"), abstract()));
  await assertSucceeds(setDoc(doc(asUser(env, "alice"), "abstracts", "alice"),
    abstract({ title: "A better title" })));
});

test("an owner CANNOT edit or delete once accepted", async () => {
  await openSubmissions();
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "alice"), abstract({ status: "accepted" })));
  const fs = asUser(env, "alice");
  await assertFails(setDoc(doc(fs, "abstracts", "alice"), abstract({ status: "accepted", title: "Sneaky" })));
  await assertFails(setDoc(doc(fs, "abstracts", "alice"), abstract({ status: "submitted", title: "Sneaky" })));
  await assertFails(deleteDoc(doc(fs, "abstracts", "alice")));
});

// Only `accepted` may be frozen. Freezing every non-submitted status would
// trap a rejected participant with a document they can neither revise, delete,
// nor replace — for the rest of the edition.
test("an owner can revise and resubmit after a rejection", async () => {
  await openSubmissions();
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "alice"), abstract({ status: "rejected" })));
  await assertSucceeds(setDoc(doc(asUser(env, "alice"), "abstracts", "alice"),
    abstract({ status: "submitted", title: "Revised after review" })));
});

test("an owner can resubmit after an admin withdrawal", async () => {
  await openSubmissions();
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "alice"), abstract({ status: "withdrawn" })));
  await assertSucceeds(setDoc(doc(asUser(env, "alice"), "abstracts", "alice"),
    abstract({ status: "submitted", title: "Back again" })));
});

test("an owner can delete a rejected abstract to start over", async () => {
  await openSubmissions();
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "alice"), abstract({ status: "rejected" })));
  await assertSucceeds(deleteDoc(doc(asUser(env, "alice"), "abstracts", "alice")));
});

test("an owner can withdraw while still submitted", async () => {
  await openSubmissions();
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "alice"), abstract()));
  await assertSucceeds(deleteDoc(doc(asUser(env, "alice"), "abstracts", "alice")));
});

test("an owner reads only their own abstract; anonymous reads none", async () => {
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "bob"), abstract({ ownerUid: "bob" })));
  await assertFails(getDoc(doc(asUser(env, "alice"), "abstracts", "bob")));
  await assertFails(getDoc(doc(asAnon(env), "abstracts", "bob")));
});

test("only an admin can list all abstracts", async () => {
  await seedAdmin(env, "boss", setDoc, doc);
  await assertFails(getDocs(collection(asUser(env, "alice"), "abstracts")));
  await assertSucceeds(getDocs(collection(asUser(env, "boss"), "abstracts")));
});

test("an admin can change status after the deadline", async () => {
  await openSubmissions(PAST);
  await seedAdmin(env, "boss", setDoc, doc);
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "alice"), abstract()));
  await assertSucceeds(updateDoc(doc(asUser(env, "boss"), "abstracts", "alice"), { status: "accepted" }));
});

test("review notes are admin-only, even for the abstract's owner", async () => {
  await seedAdmin(env, "boss", setDoc, doc);
  await seed(env, (fs) => setDoc(doc(fs, "abstract_reviews", "alice"), { note: "weak methods" }));
  await assertFails(getDoc(doc(asUser(env, "alice"), "abstract_reviews", "alice")));
  await assertFails(getDoc(doc(asAnon(env), "abstract_reviews", "alice")));
  await assertSucceeds(getDoc(doc(asUser(env, "boss"), "abstract_reviews", "alice")));
});

test("published abstracts are world-readable but admin-write only", async () => {
  await seedAdmin(env, "boss", setDoc, doc);
  await seed(env, (fs) => setDoc(doc(fs, "abstracts_public", "alice"), { title: "T", posterNumber: 1 }));
  await assertSucceeds(getDocs(collection(asAnon(env), "abstracts_public")));
  await assertFails(setDoc(doc(asUser(env, "alice"), "abstracts_public", "alice"), { title: "Mine now" }));
  await assertSucceeds(setDoc(doc(asUser(env, "boss"), "abstracts_public", "alice"), { title: "T2" }));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:rules`
Expected: FAIL — the abstract collections are still denied by the catch-all.

- [ ] **Step 3: Add the rules**

Add these helpers alongside the existing ones in `firestore.rules`:

```
    function submissionWindowOpen() {
      let cfg = get(/databases/$(database)/documents/config/site).data;
      return cfg.submissionsOpen == true && request.time < cfg.submissionDeadline;
    }
    function validAbstract(data, uid) {
      return data.keys().hasOnly(['ownerUid', 'edition', 'title', 'affiliations', 'authors',
                                  'body', 'type', 'status', 'createdAt', 'updatedAt'])
        && data.keys().hasAll(['ownerUid', 'edition', 'title', 'affiliations', 'authors',
                               'body', 'type', 'status'])
        && data.ownerUid == uid
        && data.edition is string
        && str(data.title, 200)
        && str(data.body, 2500)
        && data.type in ['poster', 'talk']
        && data.authors is list && data.authors.size() > 0 && data.authors.size() <= 20
        && data.affiliations is list && data.affiliations.size() <= 10;
    }
```

And these blocks above the catch-all:

```
    // One abstract per participant: the document id IS the owner's uid, so the
    // owner reads it with a direct get() and needs no list permission at all.
    match /abstracts/{uid} {
      allow get: if isOwner(uid) || isAdmin();
      allow list: if isAdmin();
      allow create: if isOwner(uid) && isVerified() && submissionWindowOpen()
        && validAbstract(request.resource.data, uid)
        && request.resource.data.status == 'submitted';
      // Frozen on acceptance ONLY: an edit after acceptance would leave
      // abstracts_public stale and a withdrawal would orphan the published copy.
      // Rejected and withdrawn abstracts must stay editable, or a rejected
      // participant is stuck with a document they can neither revise, delete,
      // nor replace (the doc id is their uid, so there is no second slot).
      allow update: if isOwner(uid) && isVerified() && submissionWindowOpen()
        && resource.data.status in ['submitted', 'rejected', 'withdrawn']
        && request.resource.data.status == 'submitted'
        && validAbstract(request.resource.data, uid);
      allow delete: if isOwner(uid) && resource.data.status != 'accepted';
      allow write: if isAdmin();
    }

    // Admin-only decisions. A separate document because rules cannot hide a
    // field from a document's owner.
    match /abstract_reviews/{uid} {
      allow read, write: if isAdmin();
    }

    // Public projection, written by the admin console on acceptance.
    match /abstracts_public/{uid} {
      allow read: if true;
      allow write: if isAdmin();
    }
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm run test:rules`
Expected: PASS — all rules suites green.

- [ ] **Step 5: Deploy and commit**

```bash
npx firebase deploy --only firestore:rules
git add firestore.rules test/rules/abstracts.rules.test.mjs
git commit -m "feat: abstract security rules with a submission window and acceptance freeze"
```

---

### Task 13: The submission form

**Files:**
- Modify: `js/db.js`, `js/page-account.js`, `account.html`
- Create: `js/abstract-form.js`

**Interfaces:**
- Consumes: `validateAbstract`, `parseAffiliations`, `parseAffiliationIndexes` from `js/abstract-validation-utils.mjs`; `renderAbstractHtml` from `js/markdown.js`; `CURRENT_EDITION`, `ABSTRACT_TYPES` from `js/config.mjs`.
- Produces from `js/db.js`: `getSiteConfig(): Promise<object|null>`, `getMyAbstract(uid): Promise<object|null>`, `saveAbstract(uid, data): Promise<void>`, `withdrawAbstract(uid): Promise<void>`.
- Produces from `js/abstract-form.js`: `mountAbstractForm(host, {user, verified}): Promise<void>`.

- [ ] **Step 1: Add the Firestore calls to `js/db.js`**

Add `setDoc` to the existing Firestore import list (`deleteDoc` is already imported from Task 9 — re-adding it throws `SyntaxError: Identifier 'deleteDoc' has already been declared`). Then append:

```javascript
export async function getSiteConfig() {
  const snap = await getDoc(doc(db, "config", "site"));
  return snap.exists() ? snap.data() : null;
}

export async function getMyAbstract(uid) {
  const snap = await getDoc(doc(db, "abstracts", uid));
  return snap.exists() ? snapData(snap) : null;
}

/** Create or replace the participant's single abstract. */
export async function saveAbstract(uid, { title, affiliations, authors, body, type }) {
  await setDoc(doc(db, "abstracts", uid), {
    ownerUid: uid,
    edition: CURRENT_EDITION,
    title: title.trim(),
    affiliations,
    authors,
    body: body.trim(),
    type,
    status: "submitted",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export const withdrawAbstract = (uid) => deleteDoc(doc(db, "abstracts", uid));
```

`setDoc` without `merge` is deliberate: the rules validate the whole document on every write, so a full replace is simpler than reasoning about partial updates. `createdAt` is reset on each save, which is acceptable — `abstract_reviews` carries the review timeline.

- [ ] **Step 2: Create `js/abstract-form.js`**

```javascript
import { ABSTRACT_TYPES } from "./config.mjs";
import {
  parseAffiliationIndexes,
  parseAffiliations,
  validateAbstract,
} from "./abstract-validation-utils.mjs";
import { renderAbstractHtml } from "./markdown.js";
import { getMyAbstract, getSiteConfig, saveAbstract, withdrawAbstract } from "./db.js";

const TEMPLATE = `
  <h2>Poster / talk abstract</h2>
  <p id="window-note" class="muted"></p>
  <div id="abs-msg" class="msg" role="status" aria-live="polite"></div>
  <div id="abs-status"></div>

  <form id="abs-form" novalidate>
    <label for="abs-title">Title</label>
    <input id="abs-title" type="text" maxlength="200" required>

    <label for="abs-affiliations">Affiliations
      <span class="hint">One per line. Author numbers below refer to these, starting at 1.</span>
    </label>
    <textarea id="abs-affiliations" rows="3"></textarea>

    <label>Authors
      <span class="hint">Affiliation numbers are comma-separated, e.g. <code>1,2</code>.</span>
    </label>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Name</th><th>Affiliations</th><th>Presenting</th><th></th></tr></thead>
        <tbody id="abs-authors"></tbody>
      </table>
    </div>
    <p><button type="button" id="abs-add-author" class="secondary">Add author</button></p>

    <label for="abs-type">Presentation type</label>
    <select id="abs-type"></select>

    <label for="abs-body">Abstract
      <span class="hint">Plain text with <code>*italic*</code> and <code>**bold**</code>.
        Maximum 2500 characters. <span id="abs-count"></span></span>
    </label>
    <textarea id="abs-body" maxlength="2500" required></textarea>

    <h3>Preview</h3>
    <div id="abs-preview" class="card"></div>

    <div class="actions">
      <button type="submit" id="abs-save">Submit abstract</button>
      <button type="button" id="abs-withdraw" class="danger" hidden>Withdraw</button>
    </div>
  </form>
`;

function authorRow({ name = "", marks = "", presenting = false } = {}) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="text" class="a-name" maxlength="120"></td>
    <td><input type="text" class="a-marks" size="6" inputmode="numeric"></td>
    <td><input type="radio" name="presenting" class="a-presenting"></td>
    <td><button type="button" class="secondary a-remove" aria-label="Remove author">Remove</button></td>`;
  tr.querySelector(".a-name").value = name;
  tr.querySelector(".a-marks").value = marks;
  tr.querySelector(".a-presenting").checked = presenting;
  tr.querySelector(".a-remove").addEventListener("click", () => tr.remove());
  return tr;
}

export async function mountAbstractForm(host, { user, verified }) {
  host.hidden = false;
  host.innerHTML = TEMPLATE;

  const msg = host.querySelector("#abs-msg");
  const statusBox = host.querySelector("#abs-status");
  const note = host.querySelector("#window-note");
  const form = host.querySelector("#abs-form");
  const titleEl = host.querySelector("#abs-title");
  const affEl = host.querySelector("#abs-affiliations");
  const authorsEl = host.querySelector("#abs-authors");
  const typeEl = host.querySelector("#abs-type");
  const bodyEl = host.querySelector("#abs-body");
  const previewEl = host.querySelector("#abs-preview");
  const countEl = host.querySelector("#abs-count");
  const saveBtn = host.querySelector("#abs-save");
  const withdrawBtn = host.querySelector("#abs-withdraw");

  for (const type of ABSTRACT_TYPES) {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = type === "poster" ? "Poster" : "Contributed talk";
    typeEl.append(option);
  }

  const say = (text, kind = "ok") => {
    msg.className = `msg ${kind}`;
    msg.replaceChildren(document.createTextNode(text));
  };

  const sayErrors = (errors) => {
    msg.className = "msg err";
    const ul = document.createElement("ul");
    for (const e of errors) {
      const li = document.createElement("li");
      li.textContent = e;
      ul.append(li);
    }
    msg.replaceChildren(document.createTextNode("Please fix the following:"), ul);
  };

  const config = await getSiteConfig();
  const deadline = config?.submissionDeadline?.toDate?.() ?? null;
  const submissionsOpen = Boolean(config?.submissionsOpen);
  const windowOpen = submissionsOpen && (!deadline || new Date() < deadline);

  note.textContent = windowOpen
    ? `Submissions are open${deadline ? ` until ${deadline.toLocaleString("en-GB")}` : ""}.`
    : "Submissions are closed.";

  const existing = await getMyAbstract(user.uid);
  if (existing) {
    titleEl.value = existing.title ?? "";
    affEl.value = (existing.affiliations ?? []).join("\n");
    bodyEl.value = existing.body ?? "";
    typeEl.value = existing.type ?? "poster";
    for (const author of existing.authors ?? []) {
      authorsEl.append(authorRow({
        name: author.name,
        marks: (author.affiliationIndexes ?? []).map((i) => i + 1).join(","),
        presenting: author.presenting,
      }));
    }
    saveBtn.textContent = "Save changes";
    const pill = document.createElement("p");
    pill.innerHTML = `Status: <span class="pill"></span>`;
    pill.querySelector(".pill").textContent = existing.status;
    statusBox.append(pill);
  } else {
    authorsEl.append(authorRow({ name: "", marks: "1", presenting: true }));
  }

  // Only an accepted abstract is locked, matching the rules: its public copy
  // would otherwise go stale. Rejected and withdrawn stay editable so the
  // participant can revise and resubmit before the deadline.
  const frozen = existing?.status === "accepted";
  const editable = verified && windowOpen && !frozen;

  if (!verified) say("Verify your email address before submitting.", "warn");
  else if (frozen) say("This abstract has been accepted. Contact the organizers to change it.", "warn");
  else if (!windowOpen) say("Submissions are closed. You can still read your abstract.", "warn");
  else if (existing?.status === "rejected") say("This abstract was not accepted. You can revise and resubmit it before the deadline.", "warn");
  else if (existing?.status === "withdrawn") say("This abstract was withdrawn by the organizers. You can revise and resubmit it before the deadline.", "warn");

  for (const field of form.querySelectorAll("input, textarea, select, button")) {
    if (!editable) field.disabled = true;
  }
  withdrawBtn.hidden = !(existing && editable);

  const refreshPreview = () => {
    previewEl.innerHTML = renderAbstractHtml(bodyEl.value);
    countEl.textContent = `${bodyEl.value.length} / 2500`;
  };
  bodyEl.addEventListener("input", refreshPreview);
  refreshPreview();

  host.querySelector("#abs-add-author").addEventListener("click", () => authorsEl.append(authorRow()));

  const collect = () => ({
    title: titleEl.value,
    affiliations: parseAffiliations(affEl.value),
    authors: [...authorsEl.querySelectorAll("tr")].map((tr) => ({
      name: tr.querySelector(".a-name").value.trim(),
      affiliationIndexes: parseAffiliationIndexes(tr.querySelector(".a-marks").value),
      presenting: tr.querySelector(".a-presenting").checked,
    })),
    body: bodyEl.value,
    type: typeEl.value,
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const draft = collect();
    const { valid, errors } = validateAbstract(draft, { submissionsOpen, deadline });
    if (!valid) return sayErrors(errors);
    saveBtn.disabled = true;
    try {
      await saveAbstract(user.uid, draft);
      say("Abstract saved. You can edit it until the deadline.", "ok");
      withdrawBtn.hidden = false;
      saveBtn.textContent = "Save changes";
    } catch (err) {
      say("Could not save your abstract. Please try again.", "err");
      console.error("[pints] saveAbstract", err);
    } finally {
      saveBtn.disabled = false;
    }
  });

  withdrawBtn.addEventListener("click", async () => {
    if (!confirm("Withdraw your abstract? This cannot be undone.")) return;
    try {
      await withdrawAbstract(user.uid);
      location.reload();
    } catch (err) {
      say("Could not withdraw the abstract.", "err");
      console.error("[pints] withdrawAbstract", err);
    }
  });
}
```

`confirm()` is a browser dialog, deliberately used only here for a destructive action.

- [ ] **Step 3: Mount it from `js/page-account.js`**

Replace the final `export { user, verified };` line with:

```javascript
const { mountAbstractForm } = await import("./abstract-form.js");
await mountAbstractForm(document.getElementById("abstract-section"), { user, verified });
```

- [ ] **Step 4: Verify manually**

Run: `npm run serve` → sign in with a **verified** account → `account.html`.
Expected: the abstract section appears; adding authors works; the live preview renders `*italic*` and strips a pasted `<script>`; submitting writes `abstracts/<uid>`; reloading repopulates the form; withdrawing deletes the document. With an **unverified** account the form is disabled with the warning. **Critical check:** verify the email, return to the tab, reload once, and submit — it must succeed, not `PERMISSION_DENIED`.

- [ ] **Step 5: Commit**

```bash
git add js/db.js js/abstract-form.js js/page-account.js account.html
git commit -m "feat: abstract submission form with live preview and withdraw"
```

---

### Task 14: Admin console shell and abstract review

**Files:**
- Modify: `admin.html`, `js/db.js`
- Create: `js/page-admin.js`, `js/admin-abstracts.js`

**Interfaces:**
- Consumes: `requireUser`, `checkIsAdmin` from `js/auth.js`; `authorLineParts`, `nextPosterNumber` from `js/abstract-utils.mjs`; `renderAbstractHtml` from `js/markdown.js`.
- Produces from `js/db.js`: `listAbstracts(): Promise<object[]>`, `listPublicAbstracts(): Promise<object[]>`, `getReview(uid): Promise<object|null>`, `saveReview(uid, {note, decidedBy}): Promise<void>`, `publishAbstract(uid, abstract, posterNumber): Promise<void>`, `unpublishAbstract(uid): Promise<void>`, `setAbstractStatus(uid, status): Promise<void>`.
- Produces from `js/admin-abstracts.js`: `mountAbstractsTab(host, {adminUid}): Promise<void>`. Every other tab module in Phase 2/3 follows the same `mountXTab(host, ctx)` signature.

- [ ] **Step 1: Add the admin Firestore calls to `js/db.js`**

```javascript
export async function listAbstracts() {
  const q = query(collection(db, "abstracts"), where("edition", "==", CURRENT_EDITION));
  return (await getDocs(q)).docs.map(snapData);
}

export async function listPublicAbstracts() {
  const q = query(collection(db, "abstracts_public"), where("edition", "==", CURRENT_EDITION));
  return (await getDocs(q)).docs.map(snapData);
}

export async function getReview(uid) {
  const snap = await getDoc(doc(db, "abstract_reviews", uid));
  return snap.exists() ? snap.data() : null;
}

export async function saveReview(uid, { note, decidedBy }) {
  await setDoc(doc(db, "abstract_reviews", uid),
    { note: note ?? "", decidedBy, decidedAt: serverTimestamp() }, { merge: true });
}

export const setAbstractStatus = (uid, status) =>
  updateDoc(doc(db, "abstracts", uid), { status, updatedAt: serverTimestamp() });

/** Accept: flip the private status and write the public projection together. */
export async function publishAbstract(uid, abstract, posterNumber) {
  const batch = writeBatch(db);
  batch.update(doc(db, "abstracts", uid), { status: "accepted", updatedAt: serverTimestamp() });
  batch.set(doc(db, "abstracts_public", uid), {
    title: abstract.title,
    affiliations: abstract.affiliations ?? [],
    authors: abstract.authors ?? [],
    body: abstract.body,
    type: abstract.type,
    posterNumber: abstract.type === "poster" ? posterNumber : null,
    edition: CURRENT_EDITION,
    acceptedAt: serverTimestamp(),
  });
  await batch.commit();
}

/** Withdraw a published abstract: remove the public copy and mark it withdrawn. */
export async function unpublishAbstract(uid) {
  const batch = writeBatch(db);
  batch.update(doc(db, "abstracts", uid), { status: "withdrawn", updatedAt: serverTimestamp() });
  batch.delete(doc(db, "abstracts_public", uid));
  await batch.commit();
}
```

Add `updateDoc` to the Firestore import list at the top of `js/db.js`.

- [ ] **Step 2: Replace the body of `admin.html`**

```html
<main class="wrap">
  <h1>Admin console</h1>
  <div id="guard" class="msg warn">Checking your permissions…</div>
  <div id="console" hidden>
    <div class="tabs" role="tablist">
      <button role="tab" data-tab="abstracts" aria-selected="true">Abstracts</button>
      <button role="tab" data-tab="schedule" aria-selected="false">Schedule</button>
      <button role="tab" data-tab="participants" aria-selected="false">Participants</button>
      <button role="tab" data-tab="settings" aria-selected="false">Settings</button>
    </div>
    <section id="panel-abstracts" role="tabpanel"></section>
    <section id="panel-schedule" role="tabpanel" hidden></section>
    <section id="panel-participants" role="tabpanel" hidden></section>
    <section id="panel-settings" role="tabpanel" hidden></section>
  </div>
</main>
```

Set the script tag to `<script type="module" src="js/page-admin.js"></script>`.

- [ ] **Step 3: Create `js/page-admin.js`**

```javascript
import { mountLayout, setAuthLink } from "./layout.js";
import { checkIsAdmin, requireUser } from "./auth.js";

mountLayout();

const guard = document.getElementById("guard");
const consoleEl = document.getElementById("console");

const user = await requireUser();
const isAdmin = await checkIsAdmin(user.uid);
setAuthLink({ signedIn: true, isAdmin });

if (!isAdmin) {
  guard.className = "msg err";
  guard.textContent = "You are not an organizer. If that is wrong, ask an existing admin to add you.";
} else {
  guard.hidden = true;
  consoleEl.hidden = false;

  const loaders = {
    abstracts: () => import("./admin-abstracts.js").then((m) => m.mountAbstractsTab),
    schedule: () => import("./admin-schedule.js").then((m) => m.mountScheduleTab),
    participants: () => import("./admin-participants.js").then((m) => m.mountParticipantsTab),
    settings: () => import("./admin-settings.js").then((m) => m.mountSettingsTab),
  };
  const mounted = new Set();

  async function show(name) {
    for (const tab of document.querySelectorAll("[role=tab]")) {
      tab.setAttribute("aria-selected", String(tab.dataset.tab === name));
    }
    for (const panel of document.querySelectorAll("[role=tabpanel]")) {
      panel.hidden = panel.id !== `panel-${name}`;
    }
    if (!mounted.has(name)) {
      mounted.add(name);
      const mount = await loaders[name]();
      await mount(document.getElementById(`panel-${name}`), { adminUid: user.uid });
    }
  }

  for (const tab of document.querySelectorAll("[role=tab]")) {
    tab.addEventListener("click", () => show(tab.dataset.tab));
  }
  await show("abstracts");
}
```

Tabs are lazily imported, so Phase 2 only needs `admin-abstracts.js` to exist. Create the other three as one-line stubs now so a click never throws:

```javascript
// js/admin-schedule.js — replaced in Phase 3
export async function mountScheduleTab(host) {
  host.innerHTML = `<p class="msg warn">The schedule editor lands in Phase 3.</p>`;
}
```

Create `js/admin-participants.js` (`mountParticipantsTab`) and `js/admin-settings.js` (`mountSettingsTab`) the same way; both are filled in Tasks 16 and 19.

- [ ] **Step 4: Create `js/admin-abstracts.js`**

```javascript
import { authorLineParts, nextPosterNumber, sortPublicAbstracts } from "./abstract-utils.mjs";
import { renderAbstractHtml } from "./markdown.js";
import {
  getReview,
  listAbstracts,
  listPublicAbstracts,
  publishAbstract,
  saveReview,
  setAbstractStatus,
  unpublishAbstract,
} from "./db.js";

function authorsLine(abstract) {
  const span = document.createElement("span");
  const parts = authorLineParts(abstract.authors);
  parts.forEach((part, i) => {
    if (i) span.append(document.createTextNode(", "));
    const name = document.createElement(part.presenting ? "strong" : "span");
    name.textContent = part.name;
    span.append(name);
    if (part.marks) {
      const sup = document.createElement("sup");
      sup.textContent = part.marks;
      span.append(sup);
    }
  });
  return span;
}

export async function mountAbstractsTab(host, { adminUid }) {
  host.innerHTML = `
    <div id="adm-msg" class="msg" role="status" aria-live="polite"></div>
    <p id="adm-summary" class="muted"></p>
    <div id="adm-list"></div>`;

  const msg = host.querySelector("#adm-msg");
  const listEl = host.querySelector("#adm-list");
  const summary = host.querySelector("#adm-summary");

  const say = (text, kind = "ok") => {
    msg.className = `msg ${kind}`;
    msg.textContent = text;
  };

  async function render() {
    listEl.replaceChildren();
    const [abstracts, published] = await Promise.all([listAbstracts(), listPublicAbstracts()]);
    const counts = abstracts.reduce((acc, a) => ({ ...acc, [a.status]: (acc[a.status] ?? 0) + 1 }), {});
    summary.textContent = `${abstracts.length} submitted · ${counts.accepted ?? 0} accepted · ` +
      `${counts.rejected ?? 0} rejected · ${counts.withdrawn ?? 0} withdrawn`;

    for (const abstract of abstracts) {
      const card = document.createElement("article");
      card.className = "card";

      const h3 = document.createElement("h3");
      h3.textContent = abstract.title ?? "(untitled)";
      const byline = document.createElement("p");
      byline.className = "byline";
      byline.append(authorsLine(abstract));
      const affil = document.createElement("p");
      affil.className = "byline";
      affil.textContent = (abstract.affiliations ?? [])
        .map((a, i) => `${i + 1}. ${a}`).join("   ");

      const meta = document.createElement("p");
      const typePill = document.createElement("span");
      typePill.className = "pill";
      typePill.textContent = abstract.type;
      const statusPill = document.createElement("span");
      statusPill.className = "pill";
      statusPill.textContent = abstract.status;
      meta.append(typePill, " ", statusPill);

      const body = document.createElement("div");
      body.innerHTML = renderAbstractHtml(abstract.body);

      const noteLabel = document.createElement("label");
      noteLabel.textContent = "Reviewer note (never visible to the submitter)";
      const note = document.createElement("textarea");
      note.rows = 2;
      note.value = (await getReview(abstract.id))?.note ?? "";

      const actions = document.createElement("div");
      actions.className = "actions";

      const posterInput = document.createElement("input");
      posterInput.type = "number";
      posterInput.min = "1";
      posterInput.style.maxWidth = "6rem";
      posterInput.value = String(
        published.find((p) => p.id === abstract.id)?.posterNumber ?? nextPosterNumber(published));
      if (abstract.type !== "poster") posterInput.hidden = true;

      const accept = document.createElement("button");
      accept.textContent = abstract.status === "accepted" ? "Re-publish" : "Accept & publish";
      accept.addEventListener("click", async () => {
        await saveReview(abstract.id, { note: note.value, decidedBy: adminUid });
        await publishAbstract(abstract.id, abstract, Number(posterInput.value));
        say(`Published “${abstract.title}”.`, "ok");
        await render();
      });

      const reject = document.createElement("button");
      reject.className = "secondary";
      reject.textContent = "Reject";
      reject.addEventListener("click", async () => {
        await saveReview(abstract.id, { note: note.value, decidedBy: adminUid });
        await setAbstractStatus(abstract.id, "rejected");
        say(`Rejected “${abstract.title}”.`, "warn");
        await render();
      });

      const pull = document.createElement("button");
      pull.className = "danger";
      pull.textContent = "Withdraw from the public list";
      pull.hidden = abstract.status !== "accepted";
      pull.addEventListener("click", async () => {
        await unpublishAbstract(abstract.id);
        say(`Withdrew “${abstract.title}”.`, "warn");
        await render();
      });

      const saveNote = document.createElement("button");
      saveNote.className = "secondary";
      saveNote.textContent = "Save note";
      saveNote.addEventListener("click", async () => {
        await saveReview(abstract.id, { note: note.value, decidedBy: adminUid });
        say("Note saved.", "ok");
      });

      actions.append(posterInput, accept, reject, saveNote, pull);
      card.append(h3, byline, affil, meta, body, noteLabel, note, actions);
      listEl.append(card);
    }

    if (!abstracts.length) say("No abstracts have been submitted yet.", "warn");
  }

  try {
    await render();
  } catch (err) {
    say("Could not load abstracts.", "err");
    console.error("[pints] admin abstracts", err);
  }
}
```

- [ ] **Step 5: Verify manually**

Make yourself an admin per the README, then open `admin.html`.
Expected: a non-admin sees the refusal message and no data; an admin sees every submitted abstract with its rendered body; accepting writes `abstracts_public/<uid>` and flips the private status to `accepted`; the submitter can then no longer edit it (the rules test already proves this — confirm the UI reflects it); "Withdraw from the public list" removes the public document.

- [ ] **Step 6: Commit**

```bash
git add admin.html js/page-admin.js js/admin-abstracts.js js/admin-schedule.js js/admin-participants.js js/admin-settings.js js/db.js
git commit -m "feat: admin console with abstract review, publishing, and private reviewer notes"
```

---

### Task 15: The public abstract and poster list

**Files:**
- Create: `js/page-abstracts.js`
- Modify: `abstracts.html`

**Interfaces:**
- Consumes: `listPublicAbstracts` from `js/db.js`; `filterAbstracts`, `sortPublicAbstracts`, `authorLineParts` from `js/abstract-utils.mjs`; `renderAbstractHtml` from `js/markdown.js`; `renderPageHtml` from `js/markdown.js` for the guidelines block.

- [ ] **Step 1: Replace the body of `abstracts.html`**

```html
<main class="wrap">
  <h1>Abstracts</h1>
  <div class="prose" data-markdown="content/poster-guidelines.md"></div>
  <p>
    <label for="q">Search
      <span class="hint">Matches titles, authors, affiliations, and abstract text.</span>
    </label>
    <input id="q" type="text" autocomplete="off">
  </p>
  <p id="count" class="muted"></p>
  <div id="msg" class="msg" role="status" aria-live="polite"></div>
  <div id="list"></div>
</main>
```

Set the script tag to `<script type="module" src="js/page-abstracts.js"></script>`.

- [ ] **Step 2: Create `js/page-abstracts.js`**

```javascript
import { mountLayout, setAuthLink } from "./layout.js";
import { onUser } from "./auth.js";
import { listPublicAbstracts } from "./db.js";
import { authorLineParts, filterAbstracts, sortPublicAbstracts } from "./abstract-utils.mjs";
import { renderAbstractHtml, renderPageHtml } from "./markdown.js";

mountLayout();
onUser(({ user, isAdmin }) => setAuthLink({ signedIn: Boolean(user), isAdmin }));

for (const host of document.querySelectorAll("[data-markdown]")) {
  const res = await fetch(host.getAttribute("data-markdown"), { cache: "no-cache" });
  if (res.ok) host.innerHTML = renderPageHtml(await res.text());
}

const listEl = document.getElementById("list");
const countEl = document.getElementById("count");
const msg = document.getElementById("msg");
const queryEl = document.getElementById("q");

function card(abstract) {
  const article = document.createElement("article");
  article.className = "card";

  const h3 = document.createElement("h3");
  if (abstract.type === "poster" && abstract.posterNumber) {
    const number = document.createElement("span");
    number.className = "poster-no";
    number.textContent = `P${abstract.posterNumber} `;
    h3.append(number);
  } else if (abstract.type === "talk") {
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = "talk";
    h3.append(pill, " ");
  }
  h3.append(document.createTextNode(abstract.title ?? ""));

  const byline = document.createElement("p");
  byline.className = "byline";
  authorLineParts(abstract.authors).forEach((part, i) => {
    if (i) byline.append(document.createTextNode(", "));
    const name = document.createElement(part.presenting ? "strong" : "span");
    name.textContent = part.name;
    byline.append(name);
    if (part.marks) {
      const sup = document.createElement("sup");
      sup.textContent = part.marks;
      byline.append(sup);
    }
  });

  const affil = document.createElement("p");
  affil.className = "byline";
  affil.textContent = (abstract.affiliations ?? []).map((a, i) => `${i + 1}. ${a}`).join("   ");

  const body = document.createElement("div");
  body.innerHTML = renderAbstractHtml(abstract.body);

  article.append(h3, byline, affil, body);
  return article;
}

let all = [];

function draw() {
  const shown = filterAbstracts(all, queryEl.value);
  countEl.textContent = `${shown.length} of ${all.length} shown.`;
  listEl.replaceChildren(...shown.map(card));
}

try {
  all = sortPublicAbstracts(await listPublicAbstracts());
  if (!all.length) {
    msg.className = "msg warn";
    msg.textContent = "No abstracts have been accepted yet.";
  }
  draw();
  queryEl.addEventListener("input", draw);
} catch (err) {
  msg.className = "msg err";
  msg.textContent = "Could not load the abstract list.";
  console.error("[pints] abstracts", err);
}
```

Only `abstract.body` uses `innerHTML`, and only through `renderAbstractHtml`, whose allowlist is unit-tested. Titles, names, and affiliations use `textContent`.

- [ ] **Step 3: Verify manually**

Expected: signed-out visitors see accepted abstracts with talks first then posters by board number; search narrows the list live; a submitted-but-not-accepted abstract does **not** appear; the poster guidelines block renders above the list.

- [ ] **Step 4: Commit**

```bash
git add abstracts.html js/page-abstracts.js
git commit -m "feat: public abstract and poster list with live search"
```

---

### Task 16: Participant admin tab and CSV export

**Files:**
- Create: `js/csv-utils.mjs`
- Modify: `js/admin-participants.js`, `js/db.js`
- Test: `test/csv-utils.test.mjs`

**Interfaces:**
- Consumes: `sortParticipants` from `js/participant-utils.mjs`.
- Produces from `js/csv-utils.mjs`: `csvCell(value): string`, `toCsv(rows, columns): string` where `columns` is `{key, label}[]`.
- Produces from `js/db.js`: `listUsers(): Promise<object[]>`.

This is the standing-in-for-requirement-7 deliverable: organizers export consented addresses and paste them into whatever mailing tool they already use. Real sending needs Blaze and is out of scope.

- [ ] **Step 1: Write the failing test**

Create `test/csv-utils.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { csvCell, toCsv } from "../js/csv-utils.mjs";

test("csvCell passes plain values through", () => {
  assert.equal(csvCell("Alice"), "Alice");
  assert.equal(csvCell(42), "42");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
});

test("csvCell quotes commas, quotes, and newlines", () => {
  assert.equal(csvCell("Dupont, Alice"), '"Dupont, Alice"');
  assert.equal(csvCell('She said "hi"'), '"She said ""hi"""');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
});

test("csvCell neutralises spreadsheet formula injection", () => {
  assert.equal(csvCell("=1+1"), "'=1+1");
  assert.equal(csvCell("+SUM(A1)"), "'+SUM(A1)");
  assert.equal(csvCell("-2"), "'-2");
  assert.equal(csvCell("@import"), "'@import");
});

test("csvCell quotes AND escapes a hostile value", () => {
  assert.equal(csvCell('=cmd|"/c calc"'), `"'=cmd|""/c calc"""`);
});

test("toCsv writes a header row and CRLF line endings", () => {
  const csv = toCsv(
    [{ name: "Alice", email: "a@x.org" }, { name: "Bob", email: "b@x.org" }],
    [{ key: "name", label: "Name" }, { key: "email", label: "Email" }],
  );
  assert.equal(csv, "Name,Email\r\nAlice,a@x.org\r\nBob,b@x.org\r\n");
});

test("toCsv emits just the header for an empty list", () => {
  assert.equal(toCsv([], [{ key: "name", label: "Name" }]), "Name\r\n");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../js/csv-utils.mjs'`

- [ ] **Step 3: Create `js/csv-utils.mjs`**

```javascript
// A leading =, +, -, @, tab, or CR makes Excel and Sheets treat the cell as a
// formula. Prefixing an apostrophe forces it back to text.
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\n\r]/;

export function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  if (NEEDS_QUOTES.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** `columns` is [{key, label}]. Always emits a header and CRLF endings. */
export function toCsv(rows, columns) {
  const lines = [columns.map((c) => csvCell(c.label)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c.key])).join(","));
  return `${lines.join("\r\n")}\r\n`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Add `listUsers` to `js/db.js`**

```javascript
export async function listUsers() {
  const q = query(collection(db, "users"), where("edition", "==", CURRENT_EDITION));
  return (await getDocs(q)).docs.map(snapData);
}
```

- [ ] **Step 6: Replace `js/admin-participants.js`**

```javascript
import { listUsers } from "./db.js";
import { sortParticipants } from "./participant-utils.mjs";
import { toCsv } from "./csv-utils.mjs";

const COLUMNS = [
  { key: "displayName", label: "Name" },
  { key: "affiliation", label: "Affiliation" },
  { key: "email", label: "Email" },
  { key: "showPublicly", label: "Listed publicly" },
];

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function mountParticipantsTab(host) {
  host.innerHTML = `
    <div id="p-msg" class="msg" role="status" aria-live="polite"></div>
    <p id="p-summary" class="muted"></p>
    <div class="actions">
      <button id="p-export-all" class="secondary">Export all registrations (CSV)</button>
      <button id="p-export-consented" class="secondary">Export mailing list (consented only)</button>
    </div>
    <div class="table-scroll">
      <table><thead><tr><th>Name</th><th>Affiliation</th><th>Email</th><th>Listed</th></tr></thead>
      <tbody id="p-rows"></tbody></table>
    </div>`;

  const msg = host.querySelector("#p-msg");
  try {
    const users = sortParticipants(await listUsers());
    const consented = users.filter((u) => u.showPublicly);
    host.querySelector("#p-summary").textContent =
      `${users.length} registered · ${consented.length} listed publicly`;

    const rows = host.querySelector("#p-rows");
    for (const user of users) {
      const tr = document.createElement("tr");
      for (const value of [user.displayName, user.affiliation, user.email, user.showPublicly ? "yes" : "no"]) {
        const td = document.createElement("td");
        td.textContent = value ?? "";
        tr.append(td);
      }
      rows.append(tr);
    }

    host.querySelector("#p-export-all").addEventListener("click", () =>
      download("pints-registrations.csv", toCsv(users, COLUMNS)));
    host.querySelector("#p-export-consented").addEventListener("click", () =>
      download("pints-mailing-list.csv", toCsv(consented, COLUMNS)));
  } catch (err) {
    msg.className = "msg err";
    msg.textContent = "Could not load registrations.";
    console.error("[pints] admin participants", err);
  }
}
```

The public consent flag doubles as the mailing-list consent. Say so on the account page if organizers want the two separated later.

- [ ] **Step 7: Verify manually**

Expected: the Participants tab lists every registration with emails (admin-only, per the rules); both export buttons download a CSV that opens correctly in a spreadsheet; a display name of `=1+1` exports as `'=1+1` and does not evaluate.

- [ ] **Step 8: Commit**

```bash
git add js/csv-utils.mjs js/admin-participants.js js/db.js test/csv-utils.test.mjs
git commit -m "feat: participant admin tab with injection-safe CSV export"
```

---

# Phase 3 — The schedule

Satisfies requirement 4: an editable timetable that replaces the spreadsheet screenshot.

### Task 17: Schedule domain logic

**Files:**
- Create: `js/schedule-utils.mjs`
- Test: `test/schedule-utils.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseTime(hhmm): number|null` (minutes since midnight), `formatTimeRange(start, end): string`, `sortDayItems(items): object[]`, `groupByDay(items): {day: string, items: object[]}[]`, `formatDayHeading(isoDay, locale?): string`.

The canonical schedule item shape:

```javascript
{
  edition: "pints2026",
  day: "2026-11-12",        // ISO date, sorts lexicographically
  start: "09:30",           // 24-hour HH:MM
  end: "10:30",             // may be empty
  title: "Opening keynote",
  speaker: "Julijana Gjorgjieva",
  affiliation: "TU Munich",
  kind: "keynote",          // one of SCHEDULE_KINDS
  location: "Amphi A",
  order: 0                  // tie-break within the same start time
}
```

- [ ] **Step 1: Write the failing test**

Create `test/schedule-utils.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import {
  formatDayHeading,
  formatTimeRange,
  groupByDay,
  parseTime,
  sortDayItems,
} from "../js/schedule-utils.mjs";

test("parseTime converts HH:MM to minutes", () => {
  assert.equal(parseTime("00:00"), 0);
  assert.equal(parseTime("09:30"), 570);
  assert.equal(parseTime("23:59"), 1439);
});

test("parseTime rejects malformed input", () => {
  for (const bad of ["", "9:30", "24:00", "12:60", "noon", null, undefined, "1230"]) {
    assert.equal(parseTime(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

test("formatTimeRange joins start and end with an en dash", () => {
  assert.equal(formatTimeRange("09:30", "10:30"), "09:30–10:30");
  assert.equal(formatTimeRange("09:30", ""), "09:30");
  assert.equal(formatTimeRange("09:30", "bogus"), "09:30");
  assert.equal(formatTimeRange("bogus", "10:30"), "");
});

test("sortDayItems orders by start time then by explicit order", () => {
  const sorted = sortDayItems([
    { title: "Late", start: "14:00", order: 0 },
    { title: "Second", start: "09:00", order: 1 },
    { title: "First", start: "09:00", order: 0 },
  ]);
  assert.deepEqual(sorted.map((i) => i.title), ["First", "Second", "Late"]);
});

test("sortDayItems pushes items with unparseable times to the end", () => {
  const sorted = sortDayItems([{ title: "No time" }, { title: "Timed", start: "10:00" }]);
  assert.deepEqual(sorted.map((i) => i.title), ["Timed", "No time"]);
});

test("sortDayItems does not mutate its input", () => {
  const input = [{ start: "12:00" }, { start: "09:00" }];
  sortDayItems(input);
  assert.deepEqual(input.map((i) => i.start), ["12:00", "09:00"]);
});

test("groupByDay groups, orders days chronologically, and sorts within each day", () => {
  const grouped = groupByDay([
    { day: "2026-11-13", start: "09:00", title: "Day2 first" },
    { day: "2026-11-12", start: "14:00", title: "Day1 second" },
    { day: "2026-11-12", start: "09:00", title: "Day1 first" },
  ]);
  assert.deepEqual(grouped.map((g) => g.day), ["2026-11-12", "2026-11-13"]);
  assert.deepEqual(grouped[0].items.map((i) => i.title), ["Day1 first", "Day1 second"]);
});

test("groupByDay returns an empty array for no items", () => {
  assert.deepEqual(groupByDay([]), []);
});

test("formatDayHeading renders a readable date and falls back on bad input", () => {
  assert.match(formatDayHeading("2026-11-12"), /Thursday/);
  assert.match(formatDayHeading("2026-11-12"), /November/);
  assert.equal(formatDayHeading("not-a-date"), "not-a-date");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../js/schedule-utils.mjs'`

- [ ] **Step 3: Create `js/schedule-utils.mjs`**

```javascript
const LATEST = Number.MAX_SAFE_INTEGER;

/** "09:30" -> 570 minutes. Returns null for anything malformed. */
export function parseTime(hhmm) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm ?? ""));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function formatTimeRange(start, end) {
  if (parseTime(start) === null) return "";
  return parseTime(end) === null ? String(start) : `${start}–${end}`;
}

/** Start time, then the explicit order field. Returns a new array. */
export function sortDayItems(items) {
  return [...items].sort((a, b) =>
    (parseTime(a?.start) ?? LATEST) - (parseTime(b?.start) ?? LATEST) ||
    (a?.order ?? 0) - (b?.order ?? 0));
}

/** [{day, items}] in chronological day order, each day internally sorted. */
export function groupByDay(items) {
  const byDay = new Map();
  for (const item of items) {
    const day = item?.day ?? "";
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(item);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, entries]) => ({ day, items: sortDayItems(entries) }));
}

/** "2026-11-12" -> "Thursday, 12 November 2026". Fixed to UTC so the date never shifts. */
export function formatDayHeading(isoDay, locale = "en-GB") {
  const date = new Date(`${isoDay}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(isoDay);
  return date.toLocaleDateString(locale, {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS — every unit suite green.

- [ ] **Step 5: Commit**

```bash
git add js/schedule-utils.mjs test/schedule-utils.test.mjs
git commit -m "feat: schedule time parsing, ordering, and day grouping"
```

---

### Task 18: Schedule security rules

**Files:**
- Modify: `firestore.rules`
- Create: `test/rules/schedule.rules.test.mjs`

**Interfaces:**
- Consumes: the helpers already in `firestore.rules`.
- Produces: the enforced shape of `schedule/{itemId}`.

- [ ] **Step 1: Write the failing tests**

Create `test/rules/schedule.rules.test.mjs`:

```javascript
import test, { after, before, beforeEach } from "node:test";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { addDoc, collection, deleteDoc, doc, getDocs, setDoc } from "firebase/firestore";
import { asAnon, asUser, makeTestEnv, seed, seedAdmin } from "./helpers.mjs";

let env;
before(async () => { env = await makeTestEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const item = (over = {}) => ({
  edition: "pints2026",
  day: "2026-11-12",
  start: "09:30",
  end: "10:30",
  title: "Opening keynote",
  speaker: "Julijana Gjorgjieva",
  affiliation: "TU Munich",
  kind: "keynote",
  location: "Amphi A",
  order: 0,
  ...over,
});

test("anyone can read the schedule", async () => {
  await seed(env, (fs) => setDoc(doc(fs, "schedule", "s1"), item()));
  await assertSucceeds(getDocs(collection(asAnon(env), "schedule")));
});

test("a signed-in non-admin cannot add or delete schedule items", async () => {
  await assertFails(addDoc(collection(asUser(env, "alice"), "schedule"), item()));
  await seed(env, (fs) => setDoc(doc(fs, "schedule", "s1"), item()));
  await assertFails(deleteDoc(doc(asUser(env, "alice"), "schedule", "s1")));
});

test("an anonymous visitor cannot write the schedule", async () => {
  await assertFails(addDoc(collection(asAnon(env), "schedule"), item()));
});

test("an admin can add, edit, and delete schedule items", async () => {
  await seedAdmin(env, "boss", setDoc, doc);
  const fs = asUser(env, "boss");
  await assertSucceeds(setDoc(doc(fs, "schedule", "s1"), item()));
  await assertSucceeds(setDoc(doc(fs, "schedule", "s1"), item({ title: "Renamed" })));
  await assertSucceeds(deleteDoc(doc(fs, "schedule", "s1")));
});

test("an admin cannot write a malformed schedule item", async () => {
  await seedAdmin(env, "boss", setDoc, doc);
  const fs = asUser(env, "boss");
  await assertFails(setDoc(doc(fs, "schedule", "s1"), item({ kind: "banquet" })));
  await assertFails(setDoc(doc(fs, "schedule", "s1"), item({ title: "" })));
  await assertFails(setDoc(doc(fs, "schedule", "s1"), item({ surprise: true })));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:rules`
Expected: FAIL — `schedule` is still denied by the catch-all.

- [ ] **Step 3: Add the rules**

Add this helper next to the others in `firestore.rules`:

```
    function validScheduleItem(data) {
      return data.keys().hasOnly(['edition', 'day', 'start', 'end', 'title', 'speaker',
                                  'affiliation', 'kind', 'location', 'abstractUid', 'order'])
        && data.keys().hasAll(['edition', 'day', 'title', 'kind'])
        && data.edition is string
        && data.day is string
        && str(data.title, 200)
        && data.kind in ['keynote', 'talk', 'poster', 'break', 'lunch', 'social', 'other'];
    }
```

And this block above the catch-all:

```
    // The program. World-readable so the page works signed out.
    match /schedule/{itemId} {
      allow read: if true;
      allow create, update: if isAdmin() && validScheduleItem(request.resource.data);
      allow delete: if isAdmin();
    }
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm run test:rules`
Expected: PASS — every rules suite green.

- [ ] **Step 5: Deploy and commit**

```bash
npx firebase deploy --only firestore:rules
git add firestore.rules test/rules/schedule.rules.test.mjs
git commit -m "feat: schedule security rules with item validation"
```

---

### Task 19: Schedule editor and site settings

**Files:**
- Modify: `js/admin-schedule.js`, `js/admin-settings.js`, `js/db.js`

**Interfaces:**
- Consumes: `groupByDay`, `formatDayHeading`, `parseTime` from `js/schedule-utils.mjs`; `SCHEDULE_KINDS`, `CURRENT_EDITION` from `js/config.mjs`.
- Produces from `js/db.js`: `listSchedule(): Promise<object[]>`, `saveScheduleItem(id, data): Promise<string>` (`id` `null` creates; resolves to the document id), `deleteScheduleItem(id): Promise<void>`, `saveSiteConfig({submissionsOpen, submissionDeadline}): Promise<void>`, `addAdmin(uid, email, addedBy): Promise<void>`.

- [ ] **Step 1: Add the Firestore calls to `js/db.js`**

```javascript
export async function listSchedule() {
  const q = query(collection(db, "schedule"), where("edition", "==", CURRENT_EDITION));
  return (await getDocs(q)).docs.map(snapData);
}

export async function saveScheduleItem(id, data) {
  const payload = { ...data, edition: CURRENT_EDITION };
  if (id) {
    await setDoc(doc(db, "schedule", id), payload);
    return id;
  }
  const ref = await addDoc(collection(db, "schedule"), payload);
  return ref.id;
}

export const deleteScheduleItem = (id) => deleteDoc(doc(db, "schedule", id));

export const saveSiteConfig = ({ submissionsOpen, submissionDeadline }) =>
  setDoc(doc(db, "config", "site"),
    { submissionsOpen, submissionDeadline, edition: CURRENT_EDITION }, { merge: true });

export const addAdmin = (uid, email, addedBy) =>
  setDoc(doc(db, "admins", uid), { email, addedBy, addedAt: serverTimestamp() });
```

Add `addDoc` to the Firestore import list at the top of `js/db.js`.

- [ ] **Step 2: Replace `js/admin-schedule.js`**

```javascript
import { SCHEDULE_KINDS } from "./config.mjs";
import { formatDayHeading, formatTimeRange, groupByDay } from "./schedule-utils.mjs";
import { deleteScheduleItem, listSchedule, saveScheduleItem } from "./db.js";

const FIELDS = [
  { key: "day", label: "Day", type: "date", required: true },
  { key: "start", label: "Start", type: "time" },
  { key: "end", label: "End", type: "time" },
  { key: "title", label: "Title", type: "text", required: true },
  { key: "speaker", label: "Speaker", type: "text" },
  { key: "affiliation", label: "Affiliation", type: "text" },
  { key: "location", label: "Location", type: "text" },
  { key: "order", label: "Order", type: "number" },
];

export async function mountScheduleTab(host) {
  host.innerHTML = `
    <div id="s-msg" class="msg" role="status" aria-live="polite"></div>
    <h2 id="s-form-heading">Add an item</h2>
    <form id="s-form" novalidate></form>
    <h2>Current program</h2>
    <div id="s-list"></div>`;

  const msg = host.querySelector("#s-msg");
  const form = host.querySelector("#s-form");
  const heading = host.querySelector("#s-form-heading");
  const listEl = host.querySelector("#s-list");
  let editingId = null;

  const say = (text, kind = "ok") => {
    msg.className = `msg ${kind}`;
    msg.textContent = text;
  };

  for (const field of FIELDS) {
    const label = document.createElement("label");
    label.setAttribute("for", `s-${field.key}`);
    label.textContent = field.label;
    const input = document.createElement("input");
    input.id = `s-${field.key}`;
    input.type = field.type;
    if (field.required) input.required = true;
    if (field.key === "order") input.value = "0";
    form.append(label, input);
  }

  const kindLabel = document.createElement("label");
  kindLabel.setAttribute("for", "s-kind");
  kindLabel.textContent = "Kind";
  const kindSelect = document.createElement("select");
  kindSelect.id = "s-kind";
  for (const kind of SCHEDULE_KINDS) {
    const option = document.createElement("option");
    option.value = kind;
    option.textContent = kind;
    kindSelect.append(option);
  }
  form.append(kindLabel, kindSelect);

  const actions = document.createElement("div");
  actions.className = "actions";
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = "Add item";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary";
  cancel.textContent = "Cancel edit";
  cancel.hidden = true;
  actions.append(save, cancel);
  form.append(actions);

  const field = (key) => host.querySelector(`#s-${key}`);

  function resetForm() {
    editingId = null;
    for (const f of FIELDS) field(f.key).value = f.key === "order" ? "0" : "";
    kindSelect.value = "talk";
    heading.textContent = "Add an item";
    save.textContent = "Add item";
    cancel.hidden = true;
  }

  function loadIntoForm(item) {
    editingId = item.id;
    for (const f of FIELDS) field(f.key).value = item[f.key] ?? (f.key === "order" ? "0" : "");
    kindSelect.value = item.kind ?? "talk";
    heading.textContent = `Editing: ${item.title}`;
    save.textContent = "Save changes";
    cancel.hidden = false;
    form.scrollIntoView({ behavior: "smooth" });
  }

  async function render() {
    listEl.replaceChildren();
    const days = groupByDay(await listSchedule());
    if (!days.length) return say("The program is empty. Add the first item above.", "warn");

    for (const { day, items } of days) {
      const h3 = document.createElement("h3");
      h3.textContent = formatDayHeading(day);
      const wrap = document.createElement("div");
      wrap.className = "table-scroll";
      const table = document.createElement("table");
      table.innerHTML = `<thead><tr><th>Time</th><th>What</th><th>Who</th><th>Where</th><th></th></tr></thead>`;
      const tbody = document.createElement("tbody");

      for (const item of items) {
        const tr = document.createElement("tr");
        tr.className = `kind-${item.kind}`;

        const time = document.createElement("td");
        time.className = "time";
        time.textContent = formatTimeRange(item.start, item.end);

        const what = document.createElement("td");
        what.textContent = item.title ?? "";

        const who = document.createElement("td");
        who.textContent = [item.speaker, item.affiliation].filter(Boolean).join(" — ");

        const where = document.createElement("td");
        where.textContent = item.location ?? "";

        const tools = document.createElement("td");
        const edit = document.createElement("button");
        edit.className = "secondary";
        edit.textContent = "Edit";
        edit.addEventListener("click", () => loadIntoForm(item));
        const remove = document.createElement("button");
        remove.className = "danger";
        remove.textContent = "Delete";
        remove.addEventListener("click", async () => {
          if (!confirm(`Delete “${item.title}”?`)) return;
          await deleteScheduleItem(item.id);
          say("Item deleted.", "warn");
          await render();
        });
        tools.append(edit, " ", remove);

        tr.append(time, what, who, where, tools);
        tbody.append(tr);
      }
      table.append(tbody);
      wrap.append(table);
      listEl.append(h3, wrap);
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(FIELDS.map((f) => [f.key, field(f.key).value.trim()]));
    if (!data.day || !data.title) return say("Day and title are required.", "err");
    data.order = Number(data.order || 0);
    data.kind = kindSelect.value;
    try {
      await saveScheduleItem(editingId, data);
      say(editingId ? "Item updated." : "Item added.", "ok");
      resetForm();
      await render();
    } catch (err) {
      say("Could not save the item.", "err");
      console.error("[pints] saveScheduleItem", err);
    }
  });

  cancel.addEventListener("click", resetForm);
  resetForm();
  await render();
}
```

- [ ] **Step 3: Replace `js/admin-settings.js`**

```javascript
import { addAdmin, getSiteConfig, saveSiteConfig } from "./db.js";

export async function mountSettingsTab(host, { adminUid }) {
  host.innerHTML = `
    <div id="cfg-msg" class="msg" role="status" aria-live="polite"></div>
    <h2>Submission window</h2>
    <form id="cfg-form" novalidate>
      <div class="checkline">
        <input id="cfg-open" type="checkbox">
        <label for="cfg-open">Submissions are open</label>
      </div>
      <label for="cfg-deadline">Deadline
        <span class="hint">Enforced by the security rules as well as the form,
          so submissions close on time even if the checkbox is forgotten.</span>
      </label>
      <input id="cfg-deadline" type="datetime-local">
      <div class="actions"><button type="submit">Save settings</button></div>
    </form>

    <h2>Add an organizer</h2>
    <p class="muted">Find the person's UID under <strong>Authentication → Users</strong>
      in the Firebase console. They must already have an account.</p>
    <form id="adm-form" novalidate>
      <label for="adm-uid">User UID</label>
      <input id="adm-uid" type="text" required>
      <label for="adm-email">Their email (for the record)</label>
      <input id="adm-email" type="email" required>
      <div class="actions"><button type="submit">Grant admin rights</button></div>
    </form>`;

  const msg = host.querySelector("#cfg-msg");
  const openEl = host.querySelector("#cfg-open");
  const deadlineEl = host.querySelector("#cfg-deadline");

  const say = (text, kind = "ok") => {
    msg.className = `msg ${kind}`;
    msg.textContent = text;
  };

  const config = await getSiteConfig();
  openEl.checked = Boolean(config?.submissionsOpen);
  const deadline = config?.submissionDeadline?.toDate?.();
  if (deadline) {
    const offset = deadline.getTimezoneOffset() * 60000;
    deadlineEl.value = new Date(deadline.getTime() - offset).toISOString().slice(0, 16);
  }

  host.querySelector("#cfg-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!deadlineEl.value) return say("Set a deadline before saving.", "err");
    try {
      await saveSiteConfig({
        submissionsOpen: openEl.checked,
        submissionDeadline: new Date(deadlineEl.value),
      });
      say("Settings saved.", "ok");
    } catch (err) {
      say("Could not save settings.", "err");
      console.error("[pints] saveSiteConfig", err);
    }
  });

  host.querySelector("#adm-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const uid = host.querySelector("#adm-uid").value.trim();
    const email = host.querySelector("#adm-email").value.trim();
    if (!uid || !email) return say("Both the UID and the email are required.", "err");
    try {
      await addAdmin(uid, email, adminUid);
      say(`${email} is now an organizer.`, "ok");
    } catch (err) {
      say("Could not grant admin rights.", "err");
      console.error("[pints] addAdmin", err);
    }
  });
}
```

- [ ] **Step 4: Verify manually**

Expected: adding a schedule item makes it appear immediately in the grouped table; editing repopulates the form and updates in place; deleting asks for confirmation; toggling `submissionsOpen` off makes the account page report "Submissions are closed" and the rules reject a write; adding an admin by UID lets that person into the console.

- [ ] **Step 5: Commit**

```bash
git add js/admin-schedule.js js/admin-settings.js js/db.js
git commit -m "feat: admin schedule editor and site settings with organizer management"
```

---

### Task 20: The public program page

**Files:**
- Create: `js/page-program.js`
- Modify: `program.html`

**Interfaces:**
- Consumes: `listSchedule` from `js/db.js`; `groupByDay`, `formatDayHeading`, `formatTimeRange` from `js/schedule-utils.mjs`.

- [ ] **Step 1: Replace the body of `program.html`**

```html
<main class="wrap">
  <h1>Program</h1>
  <p class="muted">All times are local (Paris).</p>
  <div id="msg" class="msg" role="status" aria-live="polite"></div>
  <div id="program"></div>
</main>
```

Set the script tag to `<script type="module" src="js/page-program.js"></script>`.

- [ ] **Step 2: Create `js/page-program.js`**

```javascript
import { mountLayout, setAuthLink } from "./layout.js";
import { onUser } from "./auth.js";
import { listSchedule } from "./db.js";
import { formatDayHeading, formatTimeRange, groupByDay } from "./schedule-utils.mjs";

mountLayout();
onUser(({ user, isAdmin }) => setAuthLink({ signedIn: Boolean(user), isAdmin }));

const programEl = document.getElementById("program");
const msg = document.getElementById("msg");

function dayTable(items) {
  const wrap = document.createElement("div");
  wrap.className = "table-scroll";
  const table = document.createElement("table");
  table.innerHTML = `<thead><tr>
    <th scope="col">Time</th><th scope="col">Session</th>
    <th scope="col">Speaker</th><th scope="col">Room</th></tr></thead>`;
  const tbody = document.createElement("tbody");

  for (const item of items) {
    const tr = document.createElement("tr");
    tr.className = `kind-${item.kind ?? "other"}`;

    const time = document.createElement("td");
    time.className = "time";
    time.textContent = formatTimeRange(item.start, item.end);

    const what = document.createElement("td");
    what.textContent = item.title ?? "";
    if (item.kind === "keynote") {
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = "keynote";
      what.append(" ", pill);
    }
    if (item.kind === "poster") {
      const link = document.createElement("a");
      link.href = "abstracts.html";
      link.textContent = "see abstracts";
      what.append(" — ", link);
    }

    const who = document.createElement("td");
    who.textContent = [item.speaker, item.affiliation].filter(Boolean).join(" — ");

    const where = document.createElement("td");
    where.textContent = item.location ?? "";

    tr.append(time, what, who, where);
    tbody.append(tr);
  }
  table.append(tbody);
  wrap.append(table);
  return wrap;
}

try {
  const days = groupByDay(await listSchedule());
  if (!days.length) {
    msg.className = "msg warn";
    msg.textContent = "The program is not published yet. Check back soon.";
  }
  for (const { day, items } of days) {
    const h2 = document.createElement("h2");
    h2.textContent = formatDayHeading(day);
    programEl.append(h2, dayTable(items));
  }
} catch (err) {
  msg.className = "msg err";
  msg.textContent = "Could not load the program.";
  console.error("[pints] program", err);
}
```

- [ ] **Step 3: Verify manually**

Expected: the program renders grouped by day with a real table, works signed out, breaks and lunch render in the muted style, and the empty state shows before anything is scheduled.

- [ ] **Step 4: Commit**

```bash
git add program.html js/page-program.js
git commit -m "feat: public program page grouped by day"
```

---

### Task 21: Full-system verification and release

**Files:**
- Modify: `README.md`, `content/home.md`

**Interfaces:**
- Consumes: everything.
- Produces: a verified live site.

- [ ] **Step 1: Run the full test suite**

```bash
npm test && npm run test:rules
```

Expected: PASS on both. Do not proceed on a failure — fix it first.

- [ ] **Step 2: Walk the end-to-end scenario against the live site**

Use a fresh email address. Every step must pass before release:

1. Sign up. A verification email arrives.
2. **Before verifying**, open `account.html` — the abstract form is disabled with the "verify your email" warning.
3. Click the verification link, return to the tab, reload once, and **submit an abstract in the same session.** It must succeed. A `PERMISSION_DENIED` here means the `refreshVerification()` call in `js/page-account.js` is missing or ran too late.
4. Fill in name and affiliation, tick "show my name publicly", save. The name appears on `participants.html`.
5. Untick and save. The name disappears from `participants.html`.
6. Confirm the submitted abstract does **not** appear on `abstracts.html`.
7. As an admin, **reject** it with a reviewer note.
8. As the submitter, reload `account.html`. The form is **still editable** and explains that the abstract can be revised. Change the title and resubmit — it must succeed. A `PERMISSION_DENIED` here means the freeze rule is over-broad and has trapped the participant.
9. Confirm the reviewer note is nowhere in the page or in the network response — it lives in `abstract_reviews`, which the owner cannot read.
10. As an admin, accept it with a poster number. It appears on `abstracts.html` as `P<n>`.
11. As the submitter, reload `account.html`. The form is now read-only and reports `accepted`.
12. As an admin, "Withdraw from the public list". It disappears from `abstracts.html`, and the submitter can edit it again.
13. As an admin, add three schedule items across two days. `program.html` shows them grouped and ordered.
14. As an admin, export both CSVs and open them in a spreadsheet.
15. Sign out. `participants.html`, `abstracts.html`, and `program.html` all still render.

- [ ] **Step 3: Run the deployment checks**

- `.nojekyll` is present at the repo root.
- Every page loads over HTTPS with a clean browser console.
- No request 404s for `css/`, `js/`, `vendor/`, or `content/` — a 404 means an absolute path slipped in.
- The live host is listed under **Firebase → Authentication → Settings → Authorized domains**.
- `npx firebase deploy --only firestore:rules` reports no diff, meaning the deployed rules match `firestore.rules`.
- In the Firebase console, confirm the project is still on **Spark** and Cloud Storage is not enabled.

- [ ] **Step 4: Replace the remaining placeholders**

Fill in the real edition dates, venue, keynote, and organizer contact in `content/home.md`, `content/about.md`, `content/venue.md`, and the `<h1>`/hero block of `index.html`. Set `CURRENT_EDITION` in `js/config.mjs` if the edition slug differs from `pints2026`.

- [ ] **Step 5: Commit and push**

```bash
git add README.md content index.html js/config.mjs
git commit -m "docs: fill in edition details and release checklist results"
git push
```

---

## Self-Review

**Spec coverage.** Each numbered requirement maps to tasks:

| Requirement | Tasks |
|---|---|
| 1. Login with participant/admin rights | 6, 7, 8, 14 |
| 2. Abstract submission | 11, 12, 13, 14 |
| 3. Names of registered people | 9, 10 |
| 4. Editable schedule | 17, 18, 19, 20 |
| 5. Poster list with abstracts | 14, 15 |
| 6. Markdown standalone pages | 2, 4 |
| 7. Mailing list (bonus) | 16, partially — CSV export only; sending needs Blaze and is out of scope |

Both hard constraints from the spec are carried into rules and tested: projections rather than field-level rules (Tasks 9, 12), and no Storage or Functions anywhere. The three flagged traps each have a specific step: the token refresh (Task 8 Step 1, Task 9 Step 7, Task 21 Step 2.3), the acceptance freeze (Task 12), and the batch-without-`get()` consent write (Task 9 Step 3).

**Type consistency.** The abstract shape declared in Task 11 (`affiliationIndexes`, `presenting`, `affiliations`) is the one written by `saveAbstract` (Task 13), validated by the rules (Task 12), projected by `publishAbstract` (Task 14), and read by `authorLineParts` (Tasks 14, 15). The schedule shape declared in Task 17 matches `validScheduleItem` (Task 18), the editor's `FIELDS` (Task 19), and the program renderer (Task 20). Every admin tab module exports `mountXTab(host, ctx)`, matching the loader map in `js/page-admin.js`.

**Two additions beyond the original file-structure table**, both deliberate: `js/abstract-utils.mjs` (display helpers, kept separate from validation) and `js/abstract-form.js` / `js/admin-*.js` (page controllers split by responsibility rather than one large file).

**Known gaps, stated rather than hidden:**

- The edition dates, venue, and keynote are placeholders until organizers supply them (Task 21 Step 4).
- Mailing-list *sending* is not built. CSV export is the substitute.
- Firebase App Check is not enabled. Worth adding later; it is free and closes the residual abuse surface on authenticated writes.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-29-pints-website.md`. Two execution options:

**1. Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
