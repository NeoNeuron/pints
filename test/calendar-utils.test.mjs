import { strict as assert } from "node:assert";
import { test } from "node:test";
import { googleCalendarUrl, outlookCalendarUrl, icsContent } from "../js/calendar-utils.mjs";

const event = {
  title: "PINTS 2026",
  description: "Talks, posters; coffee.",
  location: "ENS, 48 Bd Jourdan, 75014 Paris",
  start: "2026-11-06T09:00:00+01:00",
  end: "2026-11-06T18:00:00+01:00",
  url: "https://pints.fr/",
  uid: "pints2026",
};

test("googleCalendarUrl carries UTC dates and the event's text fields", () => {
  const url = new URL(googleCalendarUrl(event));
  assert.equal(url.origin + url.pathname, "https://calendar.google.com/calendar/render");
  assert.equal(url.searchParams.get("action"), "TEMPLATE");
  assert.equal(url.searchParams.get("text"), "PINTS 2026");
  assert.equal(url.searchParams.get("dates"), "20261106T080000Z/20261106T170000Z");
  assert.equal(url.searchParams.get("location"), event.location);
});

test("outlookCalendarUrl carries offset-aware ISO start/end", () => {
  const url = new URL(outlookCalendarUrl(event));
  assert.equal(url.searchParams.get("startdt"), event.start);
  assert.equal(url.searchParams.get("enddt"), event.end);
  assert.equal(url.searchParams.get("subject"), "PINTS 2026");
});

test("icsContent produces a VEVENT with UTC DTSTART/DTEND", () => {
  const ics = icsContent(event);
  assert.match(ics, /BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /UID:pints2026@pints\.fr\r\n/);
  assert.match(ics, /DTSTART:20261106T080000Z\r\n/);
  assert.match(ics, /DTEND:20261106T170000Z\r\n/);
  assert.match(ics, /SUMMARY:PINTS 2026\r\n/);
  assert.match(ics, /END:VCALENDAR/);
});

test("icsContent scopes UID to the edition, so different editions never collide", () => {
  const ics2027 = icsContent({ ...event, uid: "pints2027" });
  assert.match(ics2027, /UID:pints2027@pints\.fr\r\n/);
});

test("icsContent escapes commas, semicolons and newlines in free text", () => {
  const ics = icsContent({ ...event, description: "Line one\nSee: A, B; C" });
  assert.match(ics, /DESCRIPTION:Line one\\nSee: A\\, B\\; C\r\n/);
});
