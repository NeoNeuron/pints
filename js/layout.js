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
