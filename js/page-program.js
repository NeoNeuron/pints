import { mountLayout, setAuthLink } from "./layout.js";
import { warnIfUnconfigured } from "./firebase.js";
import { onUser } from "./auth.js";
import { listSchedule } from "./db.js";
import { formatDayHeading, formatTimeRange, groupByDay } from "./schedule-utils.mjs";

mountLayout();
onUser(({ user, isAdmin }) => setAuthLink({ signedIn: Boolean(user), isAdmin }));

const programEl = document.getElementById("program");
const msg = document.getElementById("msg");

function dayTable(items) {
  const wrap = document.createElement("div");
  wrap.className = "table-scroll";
  const table = document.createElement("table");
  table.innerHTML = `<thead><tr>
    <th scope="col">Time</th><th scope="col">Session</th>
    <th scope="col">Speaker</th><th scope="col">Room</th></tr></thead>`;
  const tbody = document.createElement("tbody");

  for (const item of items) {
    const tr = document.createElement("tr");
    tr.className = `kind-${item.kind ?? "other"}`;

    const time = document.createElement("td");
    time.className = "time";
    time.textContent = formatTimeRange(item.start, item.end);

    const what = document.createElement("td");
    // textContent: organizer-entered, but still never trusted into innerHTML.
    what.textContent = item.title ?? "";
    if (item.kind === "keynote") {
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = "keynote";
      what.append(" ", pill);
    }
    if (item.kind === "poster") {
      const link = document.createElement("a");
      link.href = "abstracts.html";
      link.textContent = "see abstracts";
      what.append(" — ", link);
    }

    const who = document.createElement("td");
    who.textContent = [item.speaker, item.affiliation].filter(Boolean).join(" — ");

    const where = document.createElement("td");
    where.textContent = item.location ?? "";

    tr.append(time, what, who, where);
    tbody.append(tr);
  }
  table.append(tbody);
  wrap.append(table);
  return wrap;
}

if (!warnIfUnconfigured(msg)) {
  try {
    const days = groupByDay(await listSchedule());
    if (!days.length) {
      msg.className = "msg warn";
      msg.textContent = "The program is not published yet. Check back soon.";
    }
    for (const { day, items } of days) {
      const h2 = document.createElement("h2");
      h2.textContent = formatDayHeading(day);
      programEl.append(h2, dayTable(items));
    }
  } catch (err) {
    msg.className = "msg err";
    msg.textContent = "Could not load the program.";
    console.error("[pints] program", err);
  }
}
