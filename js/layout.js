import { NAV, SITE_NAME, SITE_TAGLINE } from "./config.mjs";
import { markActive } from "./nav-utils.mjs";
import { signOutNow } from "./auth.js";

function navLink({ href, label, active }) {
  const a = document.createElement("a");
  a.href = href;
  a.textContent = label;
  if (active) a.setAttribute("aria-current", "page");
  return a;
}

const NARROW = () => window.matchMedia("(max-width: 40rem)");

/**
 * The hamburger button that collapses `nav` into a dropdown panel below the
 * header on a narrow screen. Below the breakpoint CSS hides `nav` by default
 * and shows it as an absolutely-positioned panel once `nav[data-open]` is
 * set; above it, CSS hides this button entirely and `nav` is always the
 * normal flex row, so nothing here needs to special-case desktop width.
 */
function navToggle(nav) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "nav-toggle";
  button.setAttribute("aria-label", "Menu");
  button.setAttribute("aria-controls", nav.id);
  button.setAttribute("aria-expanded", "false");
  for (let i = 0; i < 3; i++) {
    const bar = document.createElement("span");
    bar.className = "nav-toggle-bar";
    button.append(bar);
  }

  const setOpen = (open) => {
    if (open) nav.setAttribute("data-open", "true");
    else nav.removeAttribute("data-open");
    button.setAttribute("aria-expanded", String(open));
  };

  button.addEventListener("click", () => setOpen(nav.getAttribute("data-open") !== "true"));

  // Closing on a link click matters even though every nav link navigates
  // away: without it, a page that restores scroll/DOM from the back-forward
  // cache would still show the panel open.
  nav.addEventListener("click", (e) => {
    if (e.target.closest("a")) setOpen(false);
  });

  document.addEventListener("click", (e) => {
    if (nav.getAttribute("data-open") === "true"
      && !nav.contains(e.target) && e.target !== button && !button.contains(e.target)) {
      setOpen(false);
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && nav.getAttribute("data-open") === "true") {
      setOpen(false);
      button.focus();
    }
  });
  // A resize back past the breakpoint leaves the panel's CSS inert (the
  // absolute-position rules are scoped to the same media query), but without
  // this the stale [data-open]/aria-expanded would show the panel already
  // open the next time the window narrows.
  NARROW().addEventListener("change", (e) => { if (!e.matches) setOpen(false); });

  return button;
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
    nav.id = "site-nav";
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

    wrap.append(brand, navToggle(nav), nav);
    header.replaceChildren(wrap);
  }

  const footer = document.getElementById("site-footer");
  if (footer) {
    footer.className = "site-footer";
    const wrap = document.createElement("div");
    wrap.className = "wrap";
    // Contact lives here rather than in NAV on purpose. The header already
    // carries seven items plus up to two auth links, and an eighth pushes the
    // nav onto a second row on a phone — the same crowding that cost the brand
    // its tagline. The home page hero carries a button, so the two places
    // somebody looks for it are both covered. Moving it into the header is one
    // entry in NAV if that turns out to be wrong; markActive() needs no change.
    const contact = document.createElement("a");
    contact.href = "contact.html";
    contact.textContent = "Contact us";
    wrap.append(
      document.createTextNode(`${SITE_NAME} — ${SITE_TAGLINE}. Logo by majab.com. `),
      contact,
      document.createTextNode("."),
    );
    footer.replaceChildren(wrap);
  }

  mountToTop();
}

// Half a viewport, so the button turns up once the header is well gone but
// before the page has to be two screens tall to ever show it — several pages
// here sit around 1.5 screens. Relative to the window rather than a pixel count
// that would be wrong on a phone.
const TO_TOP_AFTER = () => window.innerHeight / 2;

/**
 * The floating "back to top" control, bottom right.
 *
 * Here rather than in each page module because every page calls mountLayout()
 * and this is chrome like the header and the footer. 404.html is the one page
 * that does without: it is served from the requested path, so it cannot import
 * anything relative (see the comment in that file), and it is one screen long.
 */
function mountToTop() {
  if (document.getElementById("to-top")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.id = "to-top";
  button.className = "to-top";
  // The glyph is decoration; aria-label is what names the button, so a screen
  // reader announces "Back to top" rather than "up arrow".
  button.textContent = "\u2191";
  button.setAttribute("aria-label", "Back to top");
  button.title = "Back to top";

  button.addEventListener("click", () => {
    // Read at click time, not at mount: turning reduced motion on should take
    // effect without a reload.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
    // Scrolling moves the viewport but not the caret. Without this a keyboard
    // user is taken to the top and then tabs on from the footer.
    document.querySelector(".brand")?.focus({ preventScroll: true });
  });

  document.body.append(button);

  let queued = false;
  const sync = () => {
    queued = false;
    button.classList.toggle("to-top-shown", window.scrollY > TO_TOP_AFTER());
  };
  // Coalesced through a frame so a fast scroll writes the class at most once per
  // frame; passive so it can never delay the scroll itself.
  window.addEventListener("scroll", () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(sync);
  }, { passive: true });
  window.addEventListener("resize", sync, { passive: true });

  // A page opened at an anchor, or restored by the back button, starts scrolled.
  sync();
}

function authLink(href, label) {
  const a = document.createElement("a");
  a.className = "auth-link";
  a.href = href;
  a.textContent = label;
  return a;
}

// Same query the CSS hover styles are gated behind. A touch screen has no
// :hover, so the first tap on the trigger has to open the panel rather than
// act -- otherwise a signed-in phone user could never reach "My account".
const hasHover = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;

/**
 * The signed-in nav item: a "Sign out" trigger, with "My account" tucked into
 * a dropdown rather than taking a nav slot of its own. A <button>, not a
 * link, since clicking it performs an action rather than navigating.
 *
 * On a mouse, hover already reveals "My account" (see CSS), so a click is an
 * unambiguous request to sign out. On touch there is no hover: the first tap
 * opens the panel instead of acting, so "My account" stays reachable; a
 * second tap on "Sign out" -- now that the panel is open -- signs out.
 */
function accountDropdown() {
  const wrap = document.createElement("span");
  wrap.className = "nav-dropdown";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "auth-link";
  trigger.textContent = "Sign out";
  trigger.setAttribute("aria-expanded", "false");
  trigger.addEventListener("click", async () => {
    if (!hasHover() && wrap.getAttribute("data-open") !== "true") {
      wrap.setAttribute("data-open", "true");
      trigger.setAttribute("aria-expanded", "true");
      return;
    }
    await signOutNow();
    location.href = "index.html";
  });

  const menu = document.createElement("div");
  menu.className = "nav-dropdown-menu";
  const panel = document.createElement("div");
  panel.className = "nav-dropdown-panel";
  panel.append(authLink("account.html", "My account"));
  menu.append(panel);

  // Tapping elsewhere closes an open panel on touch. Self-removing once this
  // dropdown leaves the document -- setAuthLink() rebuilds it on every
  // auth-state change, so this would otherwise leak one listener per rebuild.
  document.addEventListener("click", function onDocClick(e) {
    if (!document.contains(wrap)) {
      document.removeEventListener("click", onDocClick);
      return;
    }
    if (wrap.getAttribute("data-open") === "true" && !wrap.contains(e.target)) {
      wrap.removeAttribute("data-open");
      trigger.setAttribute("aria-expanded", "false");
    }
  });

  wrap.append(trigger, menu);
  return wrap;
}

/**
 * Rebuild the header auth links once auth state is known.
 *
 * Admins get BOTH the account dropdown and the "Admin" link. An organizer is
 * also a participant: they need to set their own display name and submit
 * their own abstract, and with only an "Admin" link there is no route to
 * account.html at all.
 */
export function setAuthLink({ signedIn, isAdmin }) {
  const host = document.getElementById("auth-links");
  if (!host) return;
  if (!signedIn) {
    host.replaceChildren(authLink("login.html", "Sign in"));
  } else if (isAdmin) {
    host.replaceChildren(accountDropdown(), authLink("admin.html", "Admin"));
  } else {
    host.replaceChildren(accountDropdown());
  }
}
