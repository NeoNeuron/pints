import { SCHEDULE_KINDS } from "./config.mjs";
import { formatTimeRange, sortScheduleItems } from "./schedule-utils.mjs";
import { deleteScheduleItem, listSchedule, saveScheduleItem } from "./db.js";

// PINTS is one day in one venue, so there is no date, no room, and no manual
// rank: the start time is the whole ordering. The event date itself lives in
// config/site and is edited on the Settings tab.
// step 300 = five minutes. Sessions are never scheduled to the minute, and the
// coarser picker is much faster to operate than a free-typing time field.
const FIELDS = [
  { key: "start", label: "Start", type: "time", step: 300 },
  { key: "end", label: "End", type: "time", step: 300 },
  { key: "title", label: "Title", type: "text", required: true },
  { key: "speaker", label: "Speaker", type: "text" },
  { key: "affiliation", label: "Affiliation", type: "text" },
];

export async function mountScheduleTab(host) {
  host.innerHTML = `
    <div id="s-msg" class="msg" role="status" aria-live="polite"></div>
    <h2 id="s-form-heading">Add an item</h2>
    <form id="s-form" novalidate></form>
    <h2>Current program</h2>
    <div id="s-list"></div>`;

  const msg = host.querySelector("#s-msg");
  const form = host.querySelector("#s-form");
  const heading = host.querySelector("#s-form-heading");
  const listEl = host.querySelector("#s-list");
  let editingId = null;

  const say = (text, kind = "ok") => {
    msg.className = `msg ${kind}`;
    msg.textContent = text;
  };

  for (const spec of FIELDS) {
    const label = document.createElement("label");
    label.setAttribute("for", `s-${spec.key}`);
    label.textContent = spec.label;
    const input = document.createElement("input");
    input.id = `s-${spec.key}`;
    input.type = spec.type;
    if (spec.step) input.step = String(spec.step);
    if (spec.required) input.required = true;
    form.append(label, input);
  }

  const kindLabel = document.createElement("label");
  kindLabel.setAttribute("for", "s-kind");
  kindLabel.textContent = "Kind";
  const kindSelect = document.createElement("select");
  kindSelect.id = "s-kind";
  for (const kind of SCHEDULE_KINDS) {
    const option = document.createElement("option");
    option.value = kind;
    option.textContent = kind;
    kindSelect.append(option);
  }
  form.append(kindLabel, kindSelect);

  const actions = document.createElement("div");
  actions.className = "actions";
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = "Add item";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary";
  cancel.textContent = "Cancel edit";
  cancel.hidden = true;
  actions.append(save, cancel);
  form.append(actions);

  const field = (key) => host.querySelector(`#s-${key}`);

  function resetForm() {
    editingId = null;
    for (const spec of FIELDS) field(spec.key).value = "";
    kindSelect.value = "talk";
    heading.textContent = "Add an item";
    save.textContent = "Add item";
    cancel.hidden = true;
  }

  function loadIntoForm(item) {
    editingId = item.id;
    for (const spec of FIELDS) field(spec.key).value = item[spec.key] ?? "";
    kindSelect.value = item.kind ?? "talk";
    heading.textContent = `Editing: ${item.title}`;
    save.textContent = "Save changes";
    cancel.hidden = false;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function row(item, refresh) {
    const tr = document.createElement("tr");
    tr.className = `kind-${item.kind ?? "other"}`;

    const time = document.createElement("td");
    time.className = "time";
    time.textContent = formatTimeRange(item.start, item.end);

    const what = document.createElement("td");
    what.textContent = item.title ?? "";

    const who = document.createElement("td");
    who.textContent = [item.speaker, item.affiliation].filter(Boolean).join(" — ");

    const kind = document.createElement("td");
    kind.textContent = item.kind ?? "other";

    const tools = document.createElement("td");
    const edit = document.createElement("button");
    edit.className = "secondary";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => loadIntoForm(item));

    const remove = document.createElement("button");
    remove.className = "danger";
    remove.textContent = "Delete";
    remove.addEventListener("click", async () => {
      if (!confirm(`Delete “${item.title}”?`)) return;
      remove.disabled = true;
      try {
        await deleteScheduleItem(item.id);
        say("Item deleted.", "warn");
        await refresh();
      } catch (err) {
        say("Could not delete the item.", "err");
        console.error("[pints] deleteScheduleItem", err);
        remove.disabled = false;
      }
    });
    tools.append(edit, " ", remove);

    tr.append(time, what, who, kind, tools);
    return tr;
  }

  async function render() {
    const items = sortScheduleItems(await listSchedule());
    listEl.replaceChildren();
    if (!items.length) {
      say("The program is empty. Add the first item above.", "warn");
      return;
    }
    const wrap = document.createElement("div");
    wrap.className = "table-scroll";
    const table = document.createElement("table");
    table.innerHTML =
      "<thead><tr><th>Time</th><th>What</th><th>Who</th><th>Kind</th><th></th></tr></thead>";
    const tbody = document.createElement("tbody");
    for (const item of items) tbody.append(row(item, render));
    table.append(tbody);
    wrap.append(table);
    listEl.append(wrap);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(FIELDS.map((s) => [s.key, field(s.key).value.trim()]));
    if (!data.title) return say("A title is required.", "err");
    data.kind = kindSelect.value;

    save.disabled = true;
    try {
      await saveScheduleItem(editingId, data);
      say(editingId ? "Item updated." : "Item added.", "ok");
      resetForm();
      await render();
    } catch (err) {
      say("Could not save the item.", "err");
      console.error("[pints] saveScheduleItem", err);
    } finally {
      save.disabled = false;
    }
  });

  cancel.addEventListener("click", resetForm);
  resetForm();

  try {
    await render();
  } catch (err) {
    say("Could not load the program.", "err");
    console.error("[pints] listSchedule", err);
  }
}
