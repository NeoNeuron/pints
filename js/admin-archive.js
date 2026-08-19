import {
  deleteGalleryYear,
  getGalleryYear,
  getHeroPhotos,
  listGallery,
  saveGalleryPhotos,
} from "./db.js";
import { syncDropboxGallery } from "./functions.js";
import { galleryYears } from "./slideshow-utils.mjs";
import { archivePhotoId, importedFromHero, movePhoto, ownsObject } from "./album-utils.mjs";
import { heroPhotos } from "./hero-utils.mjs";
import { deleteFigure, uploadArchivePhoto } from "./storage.js";
import { validateFigure } from "./figure-utils.mjs";
import { confirmChoice } from "./confirm-dialog.js";
import { ARCHIVE } from "./config.mjs";

/**
 * Photographs of previous editions, one album per edition.
 *
 * Two ways in, and they are not alternatives. Uploading puts a photograph in
 * Firebase Storage, which is the ordinary path and the only one that works
 * today; the Dropbox sync is for a year whose photographs already live in a
 * Dropbox folder, and its callable is not deployed. Captions are typed here
 * either way, and survive a later sync, matched by file name.
 *
 * Importing the home page photographs shares the objects rather than copying
 * them: the twelve behind the hero are already downscaled and already in the
 * bucket, and re-uploading them would put the same megabytes in twice. That is
 * why removing an imported photograph from an album leaves the object alone --
 * see ownsObject() in js/album-utils.mjs.
 */
export async function mountArchiveTab(host, { adminUid }) {
  host.innerHTML = `
    <div id="ar-msg" class="msg" role="status" aria-live="polite"></div>
    <p class="muted">Photographs appear in an album on the
      <a href="previous.html">Archive</a> page, under the heading that names
      their edition — "PINTS 2025" finds 2025. A year whose heading does not
      name it still shows, in a section at the foot of the page.</p>

    <form id="ar-upload">
      <div class="filters">
        <label class="filter">Year
          <input id="ar-up-year" type="number" min="2000" max="2100" required>
        </label>
        <button id="ar-add" type="submit">Add photographs</button>
        <input id="ar-file" type="file" accept="image/png,image/jpeg,image/webp"
          multiple hidden>
        <button id="ar-import" class="secondary" type="button">Import the home page photographs</button>
      </div>
    </form>

    <details id="ar-dropbox">
      <summary>Sync a year from Dropbox instead</summary>
      <p class="msg warn">The Dropbox sync is not switched on yet: its callable is
        not deployed, because it needs three Dropbox secrets that do not exist in
        the project. See “Setting up the Dropbox app” in the README. Photos
        already synced still show on the Archive page, and their captions can still
        be edited here — only Sync is inert.</p>
      <form id="ar-add-year">
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
    </details>

    <div id="ar-years"></div>`;

  const msg = host.querySelector("#ar-msg");
  const yearsEl = host.querySelector("#ar-years");
  const yearEl = host.querySelector("#ar-year");
  const urlEl = host.querySelector("#ar-url");
  const syncBtn = host.querySelector("#ar-sync");
  const upYearEl = host.querySelector("#ar-up-year");
  const fileEl = host.querySelector("#ar-file");
  const importBtn = host.querySelector("#ar-import");

  const say = (text, kind = "ok") => {
    msg.className = `msg ${kind}`;
    msg.textContent = text;
  };

  /** The year both top buttons work on, or null when the field is not a year. */
  function chosenYear() {
    const year = Number(upYearEl.value);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      say("Enter a four-digit year first.", "err");
      return null;
    }
    return year;
  }

  /** The album as it stands, so an upload extends it rather than replacing it. */
  async function currentAlbum(year) {
    const doc = await getGalleryYear(year);
    return { photos: doc?.photos ?? [], folderUrl: doc?.folderUrl ?? "" };
  }

  // ------------------------------------------------------------------ upload

  host.querySelector("#ar-upload").addEventListener("submit", (e) => {
    e.preventDefault();
    if (chosenYear() === null) return;
    fileEl.click();
  });

  fileEl.addEventListener("change", async () => {
    const chosen = [...fileEl.files];
    // Clear it now: picking the same file twice in a row must fire change both
    // times, and it will not if the input still holds it.
    fileEl.value = "";
    const year = chosenYear();
    if (!chosen.length || year === null) return;

    const { photos: existing, folderUrl } = await currentAlbum(year);
    const room = ARCHIVE.maxPhotos - existing.length;
    if (room <= 0) {
      return say(`${year} already holds ${ARCHIVE.maxPhotos} photographs, which is the limit.`, "err");
    }
    const taking = chosen.slice(0, room);
    say(`Uploading ${taking.length} photograph${taking.length === 1 ? "" : "s"}…`);

    // Two different failures, kept apart. Reporting an upload that Storage
    // refused as "must be a PNG under 5 MB" sends the organizer off to
    // re-encode a file that was never the problem.
    const rejected = [];
    const broke = [];
    const added = [];
    for (const file of taking) {
      const { valid, errors } = validateFigure({ type: file.type, size: file.size }, ARCHIVE);
      if (!valid) {
        rejected.push(file.name);
        console.warn("[pints] archive upload rejected", file.name, errors);
        continue;
      }
      try {
        const { url, path } = await uploadArchivePhoto(adminUid, archivePhotoId(), file);
        added.push({ name: file.name, url, caption: "", path });
      } catch (err) {
        broke.push(err);
        console.error("[pints] uploadArchivePhoto", file.name, err);
      }
    }

    // Saved here rather than left for a Save button: these objects are already
    // in the bucket, and a list that does not mention them is a leak.
    if (added.length) {
      try {
        await saveGalleryPhotos(year, folderUrl, [...existing, ...added], adminUid);
      } catch (err) {
        console.error("[pints] saveGalleryPhotos", err);
        return say(`Uploaded ${added.length}, but could not save the list for ${year}.`, "err");
      }
    }

    if (broke.length) {
      // storage/unauthorized is the one worth naming: it is what every upload
      // does until storage.rules has been deployed with the archive/ block, and
      // it looks exactly like a broken feature from in here.
      const denied = broke.some((err) => err?.code === "storage/unauthorized");
      say(denied
        ? `${added.length} added. ${broke.length} refused by Storage — the archive/ rule `
          + "is probably not deployed yet: run `firebase deploy --only storage`. "
          + "See “Photographs of previous editions” in the README."
        : `${added.length} added. ${broke.length} could not be uploaded: `
          + `${broke[0]?.code || broke[0]?.message || "the upload failed"}. `
          + "The browser console has the details.", "err");
    } else if (rejected.length) {
      say(`${added.length} added, ${rejected.length} rejected — a photo must be a PNG, `
        + `JPEG or WebP under ${Math.round(ARCHIVE.maxBytes / (1024 * 1024))} MB. `
        + `(${rejected.join(", ")})`, "warn");
    } else if (chosen.length > taking.length) {
      say(`${added.length} added to ${year}; ${chosen.length - taking.length} left out, `
        + `because ${ARCHIVE.maxPhotos} is the limit.`, "warn");
    } else {
      say(`${added.length} photograph${added.length === 1 ? "" : "s"} added to ${year}.`);
    }
    await render();
  });

  // ------------------------------------------------------------------ import

  importBtn.addEventListener("click", async () => {
    const year = chosenYear();
    if (year === null) return;

    importBtn.disabled = true;
    try {
      const hero = heroPhotos(await getHeroPhotos());
      if (!hero.length) {
        return say("There are no photographs on the home page to import. "
          + "Add them in the Home photos tab first.", "warn");
      }
      const { photos: existing, folderUrl } = await currentAlbum(year);
      const fresh = importedFromHero(hero, existing);
      if (!fresh.length) {
        return say(`All ${hero.length} home page photographs are already in ${year}.`, "warn");
      }
      await saveGalleryPhotos(year, folderUrl, [...existing, ...fresh], adminUid);
      say(`Added ${fresh.length} photograph${fresh.length === 1 ? "" : "s"} from the home `
        + `page to ${year}. They stay on the home page too — it is the same photograph `
        + "in both places, not a copy.");
      await render();
    } catch (err) {
      say("Could not import the home page photographs.", "err");
      console.error("[pints] import hero into gallery", err);
    } finally {
      importBtn.disabled = false;
    }
  });

  // ------------------------------------------------------------------ dropbox

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

  host.querySelector("#ar-add-year").addEventListener("submit", async (e) => {
    e.preventDefault();
    const year = Number(yearEl.value);
    if (!Number.isInteger(year)) return say("Enter a four-digit year.", "err");
    if (!urlEl.value.trim()) return say("Paste the Dropbox folder link.", "err");
    await sync(year, urlEl.value.trim(), syncBtn);
    syncBtn.disabled = false;
  });

  // ------------------------------------------------------------------ panels

  /** One edition: its photographs, their captions, their order. */
  function yearPanel(entry) {
    // Local until Save, so reordering four photographs is one write, not four.
    let photos = entry.photos.map((photo) => ({ ...photo }));

    /**
     * Objects dropped from the list that Save should also delete.
     *
     * Deferred for the reason the Home photos tab defers it: Save might never
     * come, and an object deleted early would leave the live page pointing at
     * nothing. Only what this tab uploaded goes in — an imported photograph is
     * still on the home page, and a Dropbox one was never ours.
     */
    const orphaned = new Set();

    const panel = document.createElement("div");
    panel.className = "panel";

    const head = document.createElement("div");
    head.className = "panel-head";

    const body = document.createElement("div");
    body.className = "panel-body";

    const source = document.createElement("p");
    source.className = "muted";
    source.textContent = entry.folderUrl || "Uploaded here, not synced from a folder.";

    const grid = document.createElement("div");
    grid.className = "archive-admin";

    const actions = document.createElement("div");
    actions.className = "actions";

    const save = document.createElement("button");
    save.textContent = "Save";

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
        message: `The ${photos.length} photographs of ${entry.year} stop appearing on the `
          + "Archive page, and their captions are gone for good. The photographs "
          + "themselves stay in Firebase Storage, so nothing is lost that cannot be "
          + "uploaded again.",
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

    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        await saveGalleryPhotos(entry.year, entry.folderUrl, photos.map((photo) => ({
          ...photo,
          caption: (photo.caption ?? "").trim(),
        })), adminUid);

        // Only once the list is safely stored: until this write lands, a deleted
        // object is still the one the live Archive page is pointing at.
        for (const path of orphaned) {
          try {
            await deleteFigure(path);
          } catch (err) {
            // The list is already correct, so the photograph is off the page
            // either way; this only leaves an unused object in the bucket. The
            // common cause is not a fault: storage.rules keys these objects on
            // the uploader's uid, so one organizer removing what another
            // uploaded is refused the delete.
            console.error("[pints] deleteFigure", path, err);
          }
        }
        orphaned.clear();
        say(`Saved ${entry.year}.`, "ok");
        await render();
      } catch (err) {
        say(`Could not save ${entry.year}.`, "err");
        console.error("[pints] saveGalleryPhotos", err);
        save.disabled = false;
      }
    });

    function draw() {
      head.textContent = `${entry.year} — ${photos.length} photo`
        + `${photos.length === 1 ? "" : "s"}`;
      grid.replaceChildren();

      if (!photos.length) {
        const empty = document.createElement("p");
        empty.className = "muted";
        empty.textContent = "No photographs left. Save to empty this edition.";
        grid.append(empty);
      }

      for (const [at, photo] of photos.entries()) {
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
        caption.addEventListener("input", () => { photo.caption = caption.value; });

        // Order is display order, so it is worth being able to change. Up and
        // down rather than drag-and-drop: it works with a keyboard without a
        // drag implementation.
        const row = document.createElement("div");
        row.className = "actions";
        row.append(
          moveButton("↑", `Move photograph ${at + 1} earlier`, at === 0,
            () => { photos = movePhoto(photos, at, at - 1); draw(); }),
          moveButton("↓", `Move photograph ${at + 1} later`, at === photos.length - 1,
            () => { photos = movePhoto(photos, at, at + 1); draw(); }),
        );

        const drop = document.createElement("button");
        drop.className = "danger";
        drop.textContent = "Remove";
        drop.addEventListener("click", () => {
          // Only what this tab uploaded. An imported photograph keeps its hero/
          // path and is still behind the home page logo; deleting the object
          // here would blank it there.
          if (ownsObject(photo.path)) orphaned.add(photo.path);
          photos = photos.filter((each) => each !== photo);
          draw();
          say("Removed from the list. Press Save to apply it.", "warn");
        });
        row.append(drop);

        cell.append(img, caption, row);
        grid.append(cell);
      }
    }

    actions.append(save, resync, remove);
    body.append(source, grid, actions);
    panel.append(head, body);
    draw();
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

    // Prefill the year with the album most likely to be worked on, which is the
    // newest one that exists. A first-ever upload types it, once.
    if (!upYearEl.value && years.length) upYearEl.value = String(years[0].year);

    if (!docs.length) {
      say("No photographs yet. Enter a year and press Add photographs, or import "
        + "the ones already on the home page.", "warn");
    }
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

function moveButton(glyph, label, disabled, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary";
  button.textContent = glyph;
  button.disabled = disabled;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.addEventListener("click", onClick);
  return button;
}
