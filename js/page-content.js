import { mountLayout, setAuthLink } from "./layout.js";
import { onUser } from "./auth.js";
import { hydrateMarkdownHosts } from "./content-hydrate.js";
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
