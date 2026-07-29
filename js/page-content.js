import { mountLayout, setAuthLink } from "./layout.js";
import { renderPageHtml } from "./markdown.js";
import { onUser } from "./auth.js";

mountLayout();

// Keep the header's "Sign in" link in step with auth state on the static pages.
onUser(({ user, isAdmin }) => setAuthLink({ signedIn: Boolean(user), isAdmin }));

/** Fill every [data-markdown] element from its markdown file. */
for (const host of document.querySelectorAll("[data-markdown]")) {
  const src = host.getAttribute("data-markdown");
  try {
    const res = await fetch(src, { cache: "no-cache" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    host.innerHTML = renderPageHtml(await res.text());
  } catch (err) {
    host.innerHTML = "";
    const p = document.createElement("p");
    p.className = "msg err";
    p.textContent = `Could not load ${src}.`;
    host.append(p);
    console.error(`[pints] failed to load ${src}`, err);
  }
}
