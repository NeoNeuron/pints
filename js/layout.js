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

    // The mark only, no tagline and no date. With seven nav items plus up to two
    // auth links, the tagline pushed the whole nav onto a second row for
    // signed-in users. The full name still appears in every <title>, the home
    // hero, and the footer. The <img> alt is what names this link, so it stays
    // the site name rather than describing the artwork.
    const brand = document.createElement("a");
    brand.className = "brand";
    brand.href = "index.html";
    brand.title = SITE_TAGLINE;
    const mark = document.createElement("img");
    mark.src = "assets/pints-mark.svg";
    mark.alt = SITE_NAME;
    mark.width = 259;
    mark.height = 74;
    brand.append(mark);

    const nav = document.createElement("nav");
    nav.className = "site-nav";
    nav.setAttribute("aria-label", "Main");
    for (const item of markActive(NAV, location.pathname)) nav.append(navLink(item));

    // A container, not a single link: an organizer is also a participant and
    // needs both "My account" and "Admin".
    const authLinks = document.createElement("span");
    authLinks.className = "auth-links";
    authLinks.id = "auth-links";
    // Signed-out state renders immediately; setAuthLink() replaces it once
    // Firebase resolves, so the header is never blank.
    authLinks.append(authLink("login.html", "Sign in"));
    nav.append(authLinks);

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

function authLink(href, label) {
  const a = document.createElement("a");
  a.className = "auth-link";
  a.href = href;
  a.textContent = label;
  return a;
}

/**
 * Rebuild the header auth links once auth state is known.
 *
 * Admins get BOTH links. An organizer is also a participant: they need to set
 * their own display name and submit their own abstract, and with only an
 * "Admin" link there is no route to account.html at all.
 */
export function setAuthLink({ signedIn, isAdmin }) {
  const host = document.getElementById("auth-links");
  if (!host) return;
  if (!signedIn) {
    host.replaceChildren(authLink("login.html", "Sign in"));
  } else if (isAdmin) {
    host.replaceChildren(
      authLink("account.html", "My account"),
      authLink("admin.html", "Admin"),
    );
  } else {
    host.replaceChildren(authLink("account.html", "My account"));
  }
}
