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
  { href: "previous.html", label: "Previous editions" },
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
