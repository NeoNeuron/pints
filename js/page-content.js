import { mountLayout, setAuthLink } from "./layout.js";
import { onUser } from "./auth.js";
import { hydrateMarkdownHosts } from "./content-hydrate.js";

mountLayout();

// Keep the header's "Sign in" link in step with auth state on the static pages.
onUser(({ user, isAdmin }) => setAuthLink({ signedIn: Boolean(user), isAdmin }));

await hydrateMarkdownHosts();
