import { deleteGalleryYear, listGallery, saveGalleryPhotos } from "./db.js";
import { syncDropboxGallery } from "./functions.js";
import { galleryYears } from "./slideshow-utils.mjs";
import { confirmChoice } from "./confirm-dialog.js";

/**
 * Photographs of previous editions, one Dropbox folder per year.
 *
 * The organizer's job here is to paste a folder link and press Sync; the
 * callable does the listing, because a browser cannot read a Dropbox folder
 * without a credential and there is nowhere on a static site to keep one.
 * Captions are typed here and survive the next sync, matched by file name.
 */
export async function mountArchiveTab(host, { adminUid }) {
  host.innerHTML = `
    <div id="ar-msg" class="msg" role="status" aria-live="polite"></div>
    <p class="msg warn">The Dropbox sync is not switched on yet: its callable is
      not deployed, because it needs three Dropbox secrets that do not exist in
      the project. See “Setting up the Dropbox app” in the README. Photos
      already synced still show on the Archive page, and their captions can still
      be edited here — only Sync is inert.</p>
    <p class="muted">Paste the “Anyone with the link” share link of a Dropbox
      folder of photographs, then press Sync. The photos appear in a slideshow on
      the <a href="previous.html">Archive</a> page, newest edition first.</p>

    <form id="ar-add">
      <div class="filters">
        <label class="filter">Year
          <input id="ar-year" type="number" min="2000" max="2100" required>
        </label>
        <label class="filter" style="flex:1 1 22rem">Dropbox folder link
          <input id="ar-url" type="url" placeholder="https://www.dropbox.com/scl/fo/…" required>
        </label>
        <button id="ar-sync" type="submit">Sync from Dropbox</button>
      </div>
    </form>

    <div id="ar-years"></div>`;

  const msg = host.querySelector("#ar-msg");
  const yearsEl = host.querySelector("#ar-years");
  const yearEl = host.querySelector("#ar-year");
  const urlEl = host.querySelector("#ar-url");
  const syncBtn = host.querySelector("#ar-sync");

  const say = (text, kind = "ok") => {
    msg.className = `msg ${kind}`;
    msg.textContent = text;
  };

  async function sync(year, folderUrl, button) {
    button.disabled = true;
    say("Reading the folder from Dropbox…", "ok");
    try {
      const { photos } = await syncDropboxGallery(year, folderUrl);
      say(photos
        ? `Synced ${photos} photo${photos === 1 ? "" : "s"} for ${year}.`
        : `That folder holds no images, so ${year} is empty.`, photos ? "ok" : "warn");
      await render();
    } catch (err) {
      // The callable's refusals name the actual problem — an unshared link, a
      // folder of a thousand files — and are worth far more than a generic one.
      say(err?.userFacing ? err.message : "Could not sync from Dropbox.", "err");
      console.error("[pints] syncDropboxGallery", err);
      button.disabled = false;
    }
  }

  host.querySelector("#ar-add").addEventListener("submit", async (e) => {
    e.preventDefault();
    const year = Number(yearEl.value);
    if (!Number.isInteger(year)) return say("Enter a four-digit year.", "err");
    if (!urlEl.value.trim()) return say("Paste the Dropbox folder link.", "err");
    await sync(year, urlEl.value.trim(), syncBtn);
    syncBtn.disabled = false;
  });

  /** One edition: its folder, its photos, and an editable caption per photo. */
  function yearPanel(entry) {
    const panel = document.createElement("div");
    panel.className = "panel";

    const head = document.createElement("div");
    head.className = "panel-head";
    head.textContent = `${entry.year} — ${entry.photos.length} photo`
      + `${entry.photos.length === 1 ? "" : "s"}`;

    const body = document.createElement("div");
    body.className = "panel-body";

    const source = document.createElement("p");
    source.className = "muted";
    source.textContent = entry.folderUrl || "No folder link recorded.";
    body.append(source);

    const grid = document.createElement("div");
    grid.className = "archive-admin";
    const captionInputs = new Map();

    for (const photo of entry.photos) {
      const cell = document.createElement("div");
      const img = document.createElement("img");
      img.src = photo.url;
      img.alt = photo.caption || photo.name;
      img.loading = "lazy";

      const caption = document.createElement("input");
      caption.type = "text";
      caption.maxLength = 200;
      caption.value = photo.caption ?? "";
      caption.placeholder = photo.name;
      caption.setAttribute("aria-label", `Caption for ${photo.name}`);
      captionInputs.set(photo.name, caption);

      cell.append(img, caption);
      grid.append(cell);
    }
    body.append(grid);

    const actions = document.createElement("div");
    actions.className = "actions";

    const save = document.createElement("button");
    save.textContent = "Save captions";
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        await saveGalleryPhotos(entry.year, entry.folderUrl, entry.photos.map((photo) => ({
          ...photo,
          caption: captionInputs.get(photo.name)?.value.trim() ?? photo.caption ?? "",
        })), adminUid);
        say(`Captions saved for ${entry.year}.`, "ok");
        await render();
      } catch (err) {
        say("Could not save the captions.", "err");
        console.error("[pints] saveGalleryPhotos", err);
        save.disabled = false;
      }
    });

    const resync = document.createElement("button");
    resync.className = "secondary";
    resync.textContent = "Sync again";
    resync.disabled = !entry.folderUrl;
    resync.title = entry.folderUrl
      ? "Re-read the folder. Captions are kept, matched by file name."
      : "No folder link recorded for this year.";
    resync.addEventListener("click", () => sync(entry.year, entry.folderUrl, resync));

    const remove = document.createElement("button");
    remove.className = "danger";
    remove.textContent = "Remove this year";
    remove.addEventListener("click", async () => {
      const choice = await confirmChoice({
        title: `Remove ${entry.year} from the archive`,
        message: `The ${entry.photos.length} photos of ${entry.year} stop appearing on `
          + "the Archive page. Nothing is deleted from Dropbox, so syncing the same "
          + "folder again brings them back — the captions, though, are gone for good.",
        choices: [
          { value: "delete", label: "Remove", className: "danger" },
          { value: "cancel", label: "Cancel", className: "secondary" },
        ],
      });
      if (choice !== "delete") return;
      remove.disabled = true;
      try {
        await deleteGalleryYear(entry.year);
        say(`Removed ${entry.year}.`, "warn");
        await render();
      } catch (err) {
        say("Could not remove that year.", "err");
        console.error("[pints] deleteGalleryYear", err);
        remove.disabled = false;
      }
    });

    actions.append(save, resync, remove);
    body.append(actions);
    panel.append(head, body);
    return panel;
  }

  async function render() {
    const docs = await listGallery();
    // Rendered from the same shaping the public page uses, so what an organizer
    // checks here is what a visitor sees — including which entries are dropped.
    const years = galleryYears(docs);

    yearsEl.replaceChildren();
    for (const entry of years) {
      yearsEl.append(yearPanel({ ...entry, folderUrl: byYear(docs, entry.year) }));
    }

    const empty = docs.filter((doc) => !(doc.photos ?? []).length);
    for (const doc of empty) {
      const note = document.createElement("p");
      note.className = "msg warn";
      note.textContent = `${doc.year} has a folder link but no photos in it.`;
      yearsEl.append(note);
    }

    if (!docs.length) say("No photos yet. Add a year above to get started.", "warn");
  }

  const byYear = (docs, year) =>
    docs.find((doc) => Number(doc.year) === year)?.folderUrl ?? "";

  try {
    await render();
  } catch (err) {
    say("Could not load the archive.", "err");
    console.error("[pints] admin archive", err);
  }
}
