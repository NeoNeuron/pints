import test from "node:test";
import assert from "node:assert/strict";
import {
  formatDayHeading,
  formatTimeRange,
  groupByDay,
  parseTime,
  sortDayItems,
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

test("sortDayItems orders by start time then by explicit order", () => {
  const sorted = sortDayItems([
    { title: "Late", start: "14:00", order: 0 },
    { title: "Second", start: "09:00", order: 1 },
    { title: "First", start: "09:00", order: 0 },
  ]);
  assert.deepEqual(sorted.map((i) => i.title), ["First", "Second", "Late"]);
});

test("sortDayItems pushes items with unparseable times to the end", () => {
  const sorted = sortDayItems([{ title: "No time" }, { title: "Timed", start: "10:00" }]);
  assert.deepEqual(sorted.map((i) => i.title), ["Timed", "No time"]);
});

test("sortDayItems does not mutate its input", () => {
  const input = [{ start: "12:00" }, { start: "09:00" }];
  sortDayItems(input);
  assert.deepEqual(input.map((i) => i.start), ["12:00", "09:00"]);
});

test("groupByDay groups, orders days chronologically, and sorts within each day", () => {
  const grouped = groupByDay([
    { day: "2026-11-13", start: "09:00", title: "Day2 first" },
    { day: "2026-11-12", start: "14:00", title: "Day1 second" },
    { day: "2026-11-12", start: "09:00", title: "Day1 first" },
  ]);
  assert.deepEqual(grouped.map((g) => g.day), ["2026-11-12", "2026-11-13"]);
  assert.deepEqual(grouped[0].items.map((i) => i.title), ["Day1 first", "Day1 second"]);
  assert.deepEqual(grouped[1].items.map((i) => i.title), ["Day2 first"]);
});

test("groupByDay returns an empty array for no items", () => {
  assert.deepEqual(groupByDay([]), []);
});

test("groupByDay does not mutate its input", () => {
  const input = [{ day: "2026-11-12", start: "14:00" }, { day: "2026-11-12", start: "09:00" }];
  groupByDay(input);
  assert.deepEqual(input.map((i) => i.start), ["14:00", "09:00"]);
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
