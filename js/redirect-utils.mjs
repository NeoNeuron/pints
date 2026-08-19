// Where to send someone once they have signed in.
//
// The home page's "Submit an abstract" button points at a page that requires an
// account, so requireUser() has to carry the destination through login and
// registration and come back to it. That destination arrives as a query
// parameter, which means it arrives from whoever wrote the link — including a
// stranger's — so it is validated here rather than trusted.

// One page of this site, optionally with a fragment. Deliberately narrow: no
// scheme, no host, no slash, so "//evil.example" and "https://evil.example"
// both fail. An open redirect is not worth the convenience of a looser rule.
const TARGET = /^[a-z0-9-]+\.html(?:#[a-z0-9_-]+)?$/i;

/** The validated `next` target, or null if it is missing or not one of ours. */
export function safeNext(value) {
  const text = String(value ?? "").trim();
  return TARGET.test(text) ? text : null;
}

/**
 * Resolve where to go after signing in: the requested page if it survived
 * validation, otherwise the console the person belongs in.
 */
export function destinationAfterAuth(next, { isAdmin = false } = {}) {
  return safeNext(next) ?? (isAdmin ? "admin.html" : "account.html");
}

/**
 * The validated destination from a Firebase `continueUrl`, or null.
 *
 * Firebase hands this one back as an ABSOLUTE url — `returnToAccount()` in
 * auth.js builds it with `new URL(...).href` — so safeNext() rejects it by
 * design, and auth-action.html needs a way to say yes to our own pages without
 * saying yes to everybody's.
 *
 * It arrives in the query string of a link anyone can write, exactly like
 * `next`, so it gets the same treatment: resolve it, require the SAME ORIGIN,
 * and then hand the bare filename back to safeNext() rather than trusting the
 * parse. Two gates, because the value ends up in a navigation.
 *
 * `origin` is a parameter so this is testable off a browser; callers pass
 * nothing and get location.origin.
 */
export function safeContinueUrl(value, origin = globalThis.location?.origin) {
  const text = String(value ?? "").trim();
  if (!text || !origin) return null;
  let url;
  try {
    url = new URL(text, origin);
  } catch {
    return null;
  }
  // Catches "//evil.example" and "https://evil.example/account.html" alike:
  // both parse, and both parse to somewhere that is not us.
  if (url.origin !== origin) return null;
  // The site is flat, so any page of ours is a basename at the root. Dropping
  // the directory keeps the result inside the narrow shape safeNext() knows.
  //
  // The query is carried into that check rather than stripped first. We never
  // generate a continueUrl with one, so its presence means the link was written
  // by somebody else — and safeNext() already refuses a query. Handing it the
  // whole thing lets one rule decide, instead of quietly discarding the part
  // that made the url suspicious.
  return safeNext(url.pathname.replace(/^.*\//, "") + url.search + url.hash);
}

/** Build the `next` value for the page asking for a sign-in. `file` + `hash`. */
export function nextValue(file, hash = "") {
  return safeNext(`${file}${hash}`);
}

/** Append a validated `next` to a URL, dropping it when there is nothing to carry. */
export function withNext(href, next) {
  const clean = safeNext(next);
  return clean ? `${href}?next=${encodeURIComponent(clean)}` : href;
}
