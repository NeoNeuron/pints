// Single source of truth for edition-scoped and site-wide constants.
// Never hardcode any of these values elsewhere.

export const CURRENT_EDITION = "pints2026";
export const SITE_NAME = "PINTS";
export const SITE_TAGLINE = "Paris Île-de-France Neuroscience, Theory, and Systems";

export const NAV = [
  { href: "index.html", label: "Home" },
  { href: "program.html", label: "Program" },
  { href: "abstracts.html", label: "Abstracts" },
  { href: "participants.html", label: "Participants" },
  { href: "venue.html", label: "Venue" },
  { href: "previous.html", label: "Archive" },
  { href: "about.html", label: "About" },
];

export const LIMITS = {
  displayName: 80,
  affiliation: 120,
  title: 200,
  body: 2500,
  authors: 20,
  affiliations: 10,
  figureCaption: 300,
  pageMarkdown: 20000,
};

// The organizers' vocabulary, assigned when an abstract is accepted. Submitters
// no longer choose: everything is submitted as a poster, and the program
// committee promotes some of them to talks.
export const ABSTRACT_TYPES = ["poster", "talk"];
export const ABSTRACT_STATUSES = ["submitted", "accepted", "rejected", "withdrawn"];

export const ABSTRACT_TOPICS = ["cognitive", "systems", "computational"];
export const TOPIC_LABELS = {
  cognitive: "Cognitive",
  systems: "Systems",
  computational: "Computational",
};

export const SCHEDULE_KINDS = ["keynote", "talk", "poster", "break", "lunch", "social", "other"];

// Figure uploads. maxEdge is applied by the client before upload; maxBytes is
// the hard limit that storage.rules also enforces.
export const FIGURE = {
  maxBytes: 5 * 1024 * 1024,
  maxEdge: 1600,
  types: ["image/png", "image/jpeg", "image/webp"],
};

/**
 * Editable pages. `file` is the copy committed to the repo, which is both the
 * seed for a page that has never been edited on the site and the fallback when
 * the Firestore document is missing.
 */
export const PAGES = [
  { slug: "home", label: "Home", file: "content/home.md" },
  { slug: "about", label: "About", file: "content/about.md" },
  { slug: "venue", label: "Venue", file: "content/venue.md" },
  { slug: "previous-editions", label: "Archive", file: "content/previous-editions.md" },
  { slug: "poster-guidelines", label: "Poster guidelines", file: "content/poster-guidelines.md" },
];
