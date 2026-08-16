import { LIMITS, PAGES, REPO } from "./config.mjs";
import { renderPageHtml } from "./markdown.js";
import { deletePage, getPage, savePage } from "./db.js";
import { commitPage, forgetToken, getToken, setToken } from "./github.js";

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
      <button type="button" id="pg-repo" class="secondary">Update in the repo</button>
      <button type="button" id="pg-revert" class="danger">Revert to the version in the repo</button>
    </div>

    <details id="pg-token-box">
      <summary>GitHub token for "Update in the repo"</summary>
      <p class="muted">Saving publishes to the website immediately; this button is
        separate, and writes the same markdown back to
        <code>${REPO.owner}/${REPO.name}</code> on <code>${REPO.branch}</code> so the
        git history and the fallback copy stay in step.</p>
      <p class="muted">It needs a <strong>fine-grained personal access token</strong> with
        <strong>Contents: Read and write</strong> on this repository and nothing else.
        The token is kept in this tab only, is forgotten when you close it, and is
        never stored in the repository. Anyone who can read this browser profile
        while the tab is open can read the token, so use a short expiry.</p>
      <label for="pg-token">Token</label>
      <input id="pg-token" type="password" autocomplete="off" spellcheck="false"
        placeholder="github_pat_...">
      <div class="actions">
        <button type="button" id="pg-token-save" class="secondary">Remember for this tab</button>
        <button type="button" id="pg-token-forget" class="secondary">Forget token</button>
      </div>
    </details>`;

  const msg = host.querySelector("#pg-msg");
  const select = host.querySelector("#pg-select");
  const source = host.querySelector("#pg-source");
  const text = host.querySelector("#pg-text");
  const preview = host.querySelector("#pg-preview");
  const count = host.querySelector("#pg-count");
  const saveBtn = host.querySelector("#pg-save");
  const repoBtn = host.querySelector("#pg-repo");
  const revertBtn = host.querySelector("#pg-revert");
  const tokenBox = host.querySelector("#pg-token-box");
  const tokenEl = host.querySelector("#pg-token");

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

  // --------------------------------------------------------------- GitHub

  tokenEl.value = getToken();

  host.querySelector("#pg-token-save").addEventListener("click", () => {
    if (!tokenEl.value.trim()) return say("Paste a token first.", "err");
    setToken(tokenEl.value);
    say("Token remembered for this tab only.", "ok");
  });

  host.querySelector("#pg-token-forget").addEventListener("click", () => {
    forgetToken();
    tokenEl.value = "";
    say("Token forgotten.", "warn");
  });

  repoBtn.addEventListener("click", async () => {
    const page = current();
    const token = tokenEl.value.trim() || getToken();
    if (!token) {
      tokenBox.open = true;
      return say("Add a GitHub token below before updating the repository.", "err");
    }
    if (!confirm(`Commit this text to ${page.file} on ${REPO.branch}?\n\n`
      + `${REPO.branch} is the branch GitHub Pages serves, so this also redeploys the site.`)) {
      return;
    }
    repoBtn.disabled = true;
    try {
      const commitUrl = await commitPage({
        token, path: page.file, markdown: text.value, label: page.label,
      });
      msg.className = "msg ok";
      msg.replaceChildren(document.createTextNode(`Committed to ${page.file}. `));
      if (commitUrl) {
        const link = document.createElement("a");
        link.href = commitUrl;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = "View the commit";
        msg.append(link);
      }
    } catch (err) {
      // Deliberately not console.error(err) with the request in scope: the
      // token must never reach the console or an error-reporting sink.
      say(err?.message ?? "Could not update the repository.", "err");
    } finally {
      repoBtn.disabled = false;
    }
  });

  await load();
}
