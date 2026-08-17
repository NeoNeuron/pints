import { mountLayout, setAuthLink } from "./layout.js";
import { onUser } from "./auth.js";
import { hydrateMarkdownHosts } from "./content-hydrate.js";
import { listGallery } from "./db.js";
import { mountSlideshow } from "./slideshow.js";

mountLayout();
onUser(({ user, isAdmin }) => setAuthLink({ signedIn: Boolean(user), isAdmin }));

// The page copy first, and on its own: the slideshow is an addition to this
// page, not the point of it. If the gallery read fails the archive still reads
// exactly as it did before there were any photographs.
await hydrateMarkdownHosts();

try {
  mountSlideshow(document.getElementById("gallery"), await listGallery());
} catch (err) {
  console.error("[pints] gallery", err);
}
