import { getHeroPhotos, saveHeroPhotos } from "./db.js";
import { deleteFigure, uploadHeroPhoto } from "./storage.js";
import { heroPhotoId, heroPhotos, movePhoto } from "./hero-utils.mjs";
import { validateFigure } from "./figure-utils.mjs";
import { confirmChoice } from "./confirm-dialog.js";
import { HERO } from "./config.mjs";

/**
 * The photographs behind the home page hero.
 *
 * Uploaded here rather than committed to the repo, so that next year's
 * organizers can change the landing page without a git push. The order in this
 * list is the order they slide past in.
 *
 * Saving is explicit. Uploads are not: a file lands in Storage the moment it is
 * chosen, because a browser cannot hold a downscaled blob across a reload and
 * an organizer who picks eight photographs should not lose them to a stray
 * refresh. What Save writes is the list — order, alt text, and which
 * photographs are on it.
 */
export async function mountHeroTab(host, { adminUid }) {
  host.innerHTML = `
    <div id="hero-msg" class="msg" role="status" aria-live="polite"></div>
    <p class="muted">These photographs sit behind the logo on the
      <a href="index.html">home page</a>, sliding past one at a time. They are
      shown faded, as a tint over the burgundy band — wide shots of the room or
      the poster session read well that way; close-up portraits do not. Up to
      ${HERO.maxPhotos}; with none at all the hero is a plain band, which is
      what it was before.</p>

    <div class="actions">
      <!-- A button that opens the file input, rather than a <label for>. A label
           is not focusable, so styling one as a button puts a control on the
           page that no keyboard can reach; it also sizes differently from a real
           button inside .actions, which is a flex row. -->
      <button id="hero-add" type="button">Add photographs</button>
      <input id="hero-file" type="file" accept="image/png,image/jpeg,image/webp"
        multiple hidden>
      <button id="hero-save" type="button">Save</button>
    </div>

    <div id="hero-grid" class="archive-admin"></div>`;

  const msg = host.querySelector("#hero-msg");
  const grid = host.querySelector("#hero-grid");
  const fileEl = host.querySelector("#hero-file");
  const saveBtn = host.querySelector("#hero-save");
  host.querySelector("#hero-add").addEventListener("click", () => fileEl.click());

  const say = (text, kind = "ok") => {
    msg.className = `msg ${kind}`;
    msg.textContent = text;
  };

  // The list being edited. Read once on mount; every later change is local
  // until Save, so reordering four photographs is one write, not four.
  let photos = [];
  try {
    photos = heroPhotos(await getHeroPhotos());
  } catch (err) {
    say("Could not read the current photographs.", "err");
    console.error("[pints] getHeroPhotos", err);
  }

  /**
   * Objects uploaded during this visit that are not (or no longer) on the list.
   *
   * A photograph removed before Save has already been uploaded, and deleting it
   * from Storage immediately would be wrong: Save might never come, and the
   * saved list would then point at an object that is gone. So removal is
   * deferred to Save, which is also where the list itself becomes true.
   */
  const orphaned = new Set();

  function render() {
    grid.replaceChildren();
    if (!photos.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No photographs yet.";
      grid.append(empty);
    }

    for (const [at, photo] of photos.entries()) {
      const cell = document.createElement("div");

      const img = document.createElement("img");
      img.src = photo.url;
      img.alt = photo.alt || `Hero photograph ${at + 1}`;
      img.loading = "lazy";

      const alt = document.createElement("input");
      alt.type = "text";
      alt.maxLength = 200;
      alt.value = photo.alt ?? "";
      alt.placeholder = "Describe this photo";
      alt.setAttribute("aria-label", `Description of photograph ${at + 1}`);
      alt.addEventListener("input", () => { photo.alt = alt.value; });

      // Up and down rather than drag-and-drop: the list is at most twelve long,
      // and this works with a keyboard without a drag implementation.
      const row = document.createElement("div");
      row.className = "actions";
      row.append(
        moveButton("↑", `Move photograph ${at + 1} earlier`, at === 0,
          () => { photos = movePhoto(photos, at, at - 1); render(); }),
        moveButton("↓", `Move photograph ${at + 1} later`, at === photos.length - 1,
          () => { photos = movePhoto(photos, at, at + 1); render(); }),
      );

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "danger";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        if (photo.path) orphaned.add(photo.path);
        photos = photos.filter((entry) => entry !== photo);
        render();
        say("Removed from the list. Press Save to apply it.", "warn");
      });
      row.append(remove);

      cell.append(img, alt, row);
      grid.append(cell);
    }
  }

  fileEl.addEventListener("change", async () => {
    const chosen = [...fileEl.files];
    // Clear it now: picking the same file twice in a row must fire change both
    // times, and it will not if the input still holds it.
    fileEl.value = "";
    if (!chosen.length) return;

    const room = HERO.maxPhotos - photos.length;
    if (room <= 0) {
      return say(`That is already ${HERO.maxPhotos} photographs, which is the limit.`, "err");
    }
    const taking = chosen.slice(0, room);

    say(`Uploading ${taking.length} photograph${taking.length === 1 ? "" : "s"}…`);

    // Two different failures, kept apart. Reporting an upload that Storage
    // refused as "must be a PNG under 5 MB" sends the organizer off to
    // re-encode a file that was never the problem.
    const rejected = [];
    const broke = [];
    for (const file of taking) {
      const { valid, errors } = validateFigure({ type: file.type, size: file.size }, HERO);
      if (!valid) {
        rejected.push(file.name);
        console.warn("[pints] hero upload rejected", file.name, errors);
        continue;
      }
      try {
        const { url, path } = await uploadHeroPhoto(adminUid, heroPhotoId(), file);
        photos.push({ path, url, alt: "" });
        render();
      } catch (err) {
        broke.push(err);
        console.error("[pints] uploadHeroPhoto", file.name, err);
      }
    }

    const added = taking.length - rejected.length - broke.length;
    const skipped = chosen.length - taking.length;

    if (broke.length) {
      // storage/unauthorized is the one worth naming: it is what every upload
      // does until storage.rules has been deployed with the hero/ block, and it
      // looks exactly like a broken feature from in here.
      const denied = broke.some((err) => err?.code === "storage/unauthorized");
      say(denied
        ? `${added} added. ${broke.length} refused by Storage — the hero/ rule is `
          + "probably not deployed yet: run `firebase deploy --only storage`. "
          + "See “Photographs behind the home page hero” in the README."
        : `${added} added. ${broke.length} could not be uploaded: `
          + `${broke[0]?.code || broke[0]?.message || "the upload failed"}. `
          + "The browser console has the details.", "err");
    } else if (rejected.length) {
      say(`${added} added, ${rejected.length} rejected — a photo must be a PNG, `
        + `JPEG or WebP under ${Math.round(HERO.maxBytes / (1024 * 1024))} MB. `
        + `(${rejected.join(", ")}) Press Save to apply the list.`, "warn");
    } else if (skipped) {
      say(`${added} added; ${skipped} left out, because ${HERO.maxPhotos} is the limit. `
        + "Press Save to apply the list.", "warn");
    } else {
      say(`${added} added. Press Save to put ${added === 1 ? "it" : "them"} on the home page.`);
    }
  });

  saveBtn.addEventListener("click", async () => {
    if (!photos.length) {
      const choice = await confirmChoice({
        title: "Save an empty list",
        message: "The home page hero goes back to a plain burgundy band, with no "
          + "photographs behind the logo.",
        choices: [
          { value: "save", label: "Save", className: "danger" },
          { value: "cancel", label: "Cancel", className: "secondary" },
        ],
      });
      if (choice !== "save") return;
    }

    saveBtn.disabled = true;
    try {
      await saveHeroPhotos(photos.map(({ path, url, alt }) => ({
        path, url, alt: (alt ?? "").trim(),
      })), adminUid);

      // Only once the list is safely stored: until this write lands, a deleted
      // object is still the one the live home page is pointing at.
      for (const path of orphaned) {
        try {
          await deleteFigure(path);
        } catch (err) {
          // The list is already correct, so the photograph is off the home page
          // either way; this only leaves an unused object in the bucket.
          //
          // The common cause is not a fault: storage.rules keys hero objects on
          // the uploader's uid, so one organizer removing a photograph another
          // uploaded is refused the delete. Failing loudly here would report a
          // successful save as an error.
          console.error("[pints] deleteFigure", path, err);
        }
      }
      orphaned.clear();
      say(photos.length
        ? `Saved. ${photos.length} photograph${photos.length === 1 ? "" : "s"} on the home page.`
        : "Saved. The hero is a plain band again.", "ok");
    } catch (err) {
      say("Could not save the photographs.", "err");
      console.error("[pints] saveHeroPhotos", err);
    }
    saveBtn.disabled = false;
  });

  render();
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
