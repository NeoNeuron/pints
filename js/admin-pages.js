import { LIMITS, PAGES } from "./config.mjs";
import { renderPageHtml } from "./markdown.js";
import { deletePage, getPage, savePage } from "./db.js";

/**
 * Edit page copy from the site instead of committing to GitHub.
 *
 * The markdown committed under content/ stays in the repo as the seed and the
 * fallback: "Revert" deletes the Firestore document, which makes the public
 * pages fall back to the committed file again. That is why revert is a delete
 * and not a copy — there is nothing to copy back to.
 */
export async function mountPagesTab(host, { adminUid }) {
  host.innerHTML = `
    <div id="pg-msg" class="msg" role="status" aria-live="polite"></div>

    <label for="pg-select">Page</label>
    <select id="pg-select"></select>
    <p id="pg-source" class="muted"></p>

    <label for="pg-text">Markdown
      <span class="hint">Headings, lists, links, tables, and images. Saving publishes
        immediately — there is no commit and no review. <span id="pg-count"></span></span>
    </label>
    <textarea id="pg-text" rows="20" style="min-height:24rem"></textarea>

    <h3>Preview</h3>
    <div id="pg-preview" class="prose card"></div>

    <div class="actions">
      <button type="button" id="pg-save">Save and publish</button>
      <button type="button" id="pg-revert" class="danger">Revert to the version in the repo</button>
    </div>`;

  const msg = host.querySelector("#pg-msg");
  const select = host.querySelector("#pg-select");
  const source = host.querySelector("#pg-source");
  const text = host.querySelector("#pg-text");
  const preview = host.querySelector("#pg-preview");
  const count = host.querySelector("#pg-count");
  const saveBtn = host.querySelector("#pg-save");
  const revertBtn = host.querySelector("#pg-revert");

  const say = (text_, kind = "ok") => {
    msg.className = `msg ${kind}`;
    msg.textContent = text_;
  };

  for (const page of PAGES) {
    const option = document.createElement("option");
    option.value = page.slug;
    option.textContent = page.label;
    select.append(option);
  }

  const current = () => PAGES.find((p) => p.slug === select.value) ?? PAGES[0];

  const refreshPreview = () => {
    preview.innerHTML = renderPageHtml(text.value);
    count.textContent = `${text.value.length} / ${LIMITS.pageMarkdown}`;
  };
  text.addEventListener("input", refreshPreview);

  async function load() {
    const page = current();
    text.value = "";
    source.textContent = "Loading…";
    try {
      const doc = await getPage(page.slug);
      if (doc?.markdown != null) {
        text.value = doc.markdown;
        source.textContent = `Edited on this site${
          doc.updatedAt?.toDate ? ` on ${doc.updatedAt.toDate().toLocaleString("en-GB")}` : ""}.`;
        revertBtn.hidden = false;
      } else {
        const res = await fetch(page.file, { cache: "no-cache" });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        text.value = await res.text();
        source.textContent = `Never edited here — showing ${page.file} from the repository.`;
        revertBtn.hidden = true;
      }
      say("", "ok");
    } catch (err) {
      source.textContent = "";
      say(`Could not load ${page.label}.`, "err");
      console.error("[pints] admin pages load", err);
    }
    refreshPreview();
  }

  select.addEventListener("change", load);

  saveBtn.addEventListener("click", async () => {
    const page = current();
    if (text.value.length > LIMITS.pageMarkdown) {
      return say(`That is longer than the ${LIMITS.pageMarkdown} character limit.`, "err");
    }
    saveBtn.disabled = true;
    try {
      await savePage(page.slug, text.value, adminUid);
      say(`${page.label} published. Reload the public page to see it.`, "ok");
      await load();
    } catch (err) {
      say("Could not save the page.", "err");
      console.error("[pints] savePage", err);
    } finally {
      saveBtn.disabled = false;
    }
  });

  revertBtn.addEventListener("click", async () => {
    const page = current();
    if (!confirm(`Discard the edits to “${page.label}” and go back to ${page.file}?`)) return;
    revertBtn.disabled = true;
    try {
      await deletePage(page.slug);
      say(`${page.label} reverted to the version in the repository.`, "warn");
      await load();
    } catch (err) {
      say("Could not revert the page.", "err");
      console.error("[pints] deletePage", err);
    } finally {
      revertBtn.disabled = false;
    }
  });

  await load();
}
