import { renderPageHtml } from "./markdown.js";
import { getPage } from "./db.js";

/** "content/about.md" -> "about". */
const slugFromSrc = (src) => String(src ?? "").split("/").pop().replace(/\.md$/, "");

/**
 * Fill every [data-markdown] element on the page.
 *
 * The committed content/*.md first, Firestore second. The repo file is a
 * same-origin, browser-cached read that shows up well before a Firestore round
 * trip ever could, so the page's own text is never the thing visitors wait on.
 * Firestore — where an organizer's edit actually lives once one has been made —
 * then swaps its answer in behind the scenes, and this call returns without
 * waiting for that: nothing downstream (the hero slider, the abstract list)
 * needs to queue up behind a Firestore read of page copy. A Firebase outage
 * degrades to the last committed copy rather than to a blank page.
 */
export async function hydrateMarkdownHosts(root = document) {
  await Promise.all([...root.querySelectorAll("[data-markdown]")].map(async (host) => {
    const src = host.getAttribute("data-markdown");
    const slug = host.dataset.page || slugFromSrc(src);

    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      host.innerHTML = renderPageHtml(await res.text());
    } catch (err) {
      host.innerHTML = "";
      const p = document.createElement("p");
      p.className = "msg err";
      p.textContent = `Could not load ${src}.`;
      host.append(p);
      console.error(`[pints] failed to load ${src}`, err);
      return;
    }

    getPage(slug).then((doc) => {
      if (doc?.markdown != null) host.innerHTML = renderPageHtml(doc.markdown);
    }).catch((err) => {
      console.error(`[pints] could not read pages/${slug}; showing ${src}`, err);
    });
  }));
}
