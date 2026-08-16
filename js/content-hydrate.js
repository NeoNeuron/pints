import { renderPageHtml } from "./markdown.js";
import { getPage } from "./db.js";

/** "content/about.md" -> "about". */
const slugFromSrc = (src) => String(src ?? "").split("/").pop().replace(/\.md$/, "");

/**
 * Fill every [data-markdown] element on the page.
 *
 * Firestore first, the committed content/*.md second. The repo file is both the
 * seed for a page nobody has edited on the site yet and the fallback when the
 * Firestore read fails — so a Firebase outage degrades to the last committed
 * copy rather than to a blank page.
 */
export async function hydrateMarkdownHosts(root = document) {
  await Promise.all([...root.querySelectorAll("[data-markdown]")].map(async (host) => {
    const src = host.getAttribute("data-markdown");
    const slug = host.dataset.page || slugFromSrc(src);

    let markdown = null;
    try {
      markdown = (await getPage(slug))?.markdown ?? null;
    } catch (err) {
      console.error(`[pints] could not read pages/${slug}; falling back to ${src}`, err);
    }

    if (markdown === null) {
      try {
        const res = await fetch(src, { cache: "no-cache" });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        markdown = await res.text();
      } catch (err) {
        host.innerHTML = "";
        const p = document.createElement("p");
        p.className = "msg err";
        p.textContent = `Could not load ${src}.`;
        host.append(p);
        console.error(`[pints] failed to load ${src}`, err);
        return;
      }
    }

    host.innerHTML = renderPageHtml(markdown);
  }));
}
