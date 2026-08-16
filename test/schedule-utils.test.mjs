import test from "node:test";
import assert from "node:assert/strict";
import {
  formatDayHeading,
  formatTimeRange,
  parseTime,
  sortScheduleItems,
} from "../js/schedule-utils.mjs";

test("parseTime converts HH:MM to minutes", () => {
  assert.equal(parseTime("00:00"), 0);
  assert.equal(parseTime("09:30"), 570);
  assert.equal(parseTime("23:59"), 1439);
});

test("parseTime rejects malformed input", () => {
  for (const bad of ["", "9:30", "24:00", "12:60", "noon", null, undefined, "1230", "09:30:00"]) {
    assert.equal(parseTime(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

test("formatTimeRange joins start and end with an en dash", () => {
  assert.equal(formatTimeRange("09:30", "10:30"), "09:30–10:30");
  assert.equal(formatTimeRange("09:30", ""), "09:30");
  assert.equal(formatTimeRange("09:30", "bogus"), "09:30");
  assert.equal(formatTimeRange("bogus", "10:30"), "");
});

test("sortScheduleItems orders by start time", () => {
  const sorted = sortScheduleItems([
    { title: "Afternoon", start: "14:00" },
    { title: "Lunch", start: "12:30" },
    { title: "Opening", start: "09:00" },
  ]);
  assert.deepEqual(sorted.map((i) => i.title), ["Opening", "Lunch", "Afternoon"]);
});

test("sortScheduleItems breaks a shared start time on the end time", () => {
  const sorted = sortScheduleItems([
    { title: "Long", start: "09:00", end: "10:00" },
    { title: "Short", start: "09:00", end: "09:15" },
  ]);
  assert.deepEqual(sorted.map((i) => i.title), ["Short", "Long"]);
});

test("sortScheduleItems falls back to the title when times are identical", () => {
  const sorted = sortScheduleItems([
    { title: "Beta", start: "09:00", end: "10:00" },
    { title: "Alpha", start: "09:00", end: "10:00" },
  ]);
  assert.deepEqual(sorted.map((i) => i.title), ["Alpha", "Beta"]);
});

test("sortScheduleItems pushes items with unparseable times to the end", () => {
  const sorted = sortScheduleItems([{ title: "No time" }, { title: "Timed", start: "10:00" }]);
  assert.deepEqual(sorted.map((i) => i.title), ["Timed", "No time"]);
});

test("sortScheduleItems does not mutate its input", () => {
  const input = [{ start: "12:00" }, { start: "09:00" }];
  sortScheduleItems(input);
  assert.deepEqual(input.map((i) => i.start), ["12:00", "09:00"]);
});

test("sortScheduleItems handles an empty program", () => {
  assert.deepEqual(sortScheduleItems([]), []);
});

test("formatDayHeading renders a readable date and falls back on bad input", () => {
  assert.match(formatDayHeading("2026-11-12"), /Thursday/);
  assert.match(formatDayHeading("2026-11-12"), /November/);
  assert.match(formatDayHeading("2026-11-12"), /2026/);
  assert.equal(formatDayHeading("not-a-date"), "not-a-date");
  assert.equal(formatDayHeading(""), "");
});

test("formatDayHeading is timezone-stable", () => {
  // Fixed to UTC so a late-evening local time cannot roll the date back a day.
  assert.match(formatDayHeading("2026-01-01"), /1 January 2026/);
});
