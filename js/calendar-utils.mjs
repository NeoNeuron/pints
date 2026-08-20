// Turns an EVENT-shaped object ({ title, description, location, start, end,
// url }, with start/end as offset ISO datetimes) into the links and file
// content behind the home page's "Add to calendar" menu. Pure and DOM-free so
// it can be unit-tested without a browser.

/** "2026-11-06T09:00:00+01:00" -> "20261106T080000Z", UTC so every calendar
 * app displays the event converted to the viewer's own timezone. */
function toUtcStamp(iso) {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function googleCalendarUrl(event) {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${toUtcStamp(event.start)}/${toUtcStamp(event.end)}`,
    details: event.description,
    location: event.location,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

export function outlookCalendarUrl(event) {
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: event.title,
    startdt: event.start,
    enddt: event.end,
    body: event.description,
    location: event.location,
  });
  return `https://outlook.office.com/calendar/0/deeplink/compose?${params}`;
}

// RFC 5545 §3.3.11: comma, semicolon and backslash are structural and must be
// escaped; a literal newline becomes the two-character \n sequence.
function escapeIcsText(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/[,;]/g, "\\$&").replace(/\n/g, "\\n");
}

export function icsContent(event) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PINTS//pints.fr//EN",
    "BEGIN:VEVENT",
    // Edition-scoped, not the event url: a shared UID across editions would
    // make next year's file read as an edit to this year's event in an
    // imported calendar rather than a new one.
    `UID:${event.uid}@pints.fr`,
    `DTSTAMP:${toUtcStamp(new Date().toISOString())}`,
    `DTSTART:${toUtcStamp(event.start)}`,
    `DTEND:${toUtcStamp(event.end)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(event.description)}`,
    `LOCATION:${escapeIcsText(event.location)}`,
    `URL:${event.url}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}
