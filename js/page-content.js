import { mountLayout, setAuthLink } from "./layout.js";
import { onUser } from "./auth.js";
import { hydrateMarkdownHosts } from "./content-hydrate.js";
import { getHeroPhotos } from "./db.js";
import { mountHeroSlider } from "./hero-slider.js";
import { heroPhotos } from "./hero-utils.mjs";
import { withNext } from "./redirect-utils.mjs";

mountLayout();

// The home page's "Submit an abstract" button. Submitting requires an account
// with a confirmed address, so a signed-out visitor is sent to sign in and
// carried back here afterwards rather than bounced off submit.html on arrival.
//
// The static href stays `submit.html`, which is the correct destination for
// everybody else and the correct fallback for a click that lands before
// Firebase has resolved: submit.html redirects a signed-out visitor to exactly
// the same place. Nothing depends on this rewrite happening in time.
const submitCta = document.getElementById("submit-cta");

// Keep the header's "Sign in" link in step with auth state on the static pages.
onUser(({ user, isAdmin }) => {
  setAuthLink({ signedIn: Boolean(user), isAdmin });
  if (submitCta) {
    submitCta.href = user ? "submit.html" : withNext("login.html", "submit.html");
  }
});

await hydrateMarkdownHosts();

// The home page's hero photographs. This module is shared by several static
// pages and only index.html carries the element, hence the guard.
//
// The copy first, and the photographs second and in a try: they are decoration
// on top of a band that is already the right colour, so a Firestore outage
// leaves the hero looking exactly as it did before there were any photographs
// rather than leaving a hole in the landing page.
const heroHost = document.getElementById("hero-photos");
if (heroHost) {
  try {
    // The Archive link is part of the photographs, not part of the band, so it
    // hangs off the slider's own answer to "did any arrive?" rather than off a
    // second look at the list.
    if (mountHeroSlider(heroHost, heroPhotos(await getHeroPhotos()))) {
      document.getElementById("hero-link")?.removeAttribute("hidden");
    }
  } catch (err) {
    console.error("[pints] hero", err);
  }
}
