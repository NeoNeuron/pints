const LATEST = Number.MAX_SAFE_INTEGER;
const collator = new Intl.Collator("en", { sensitivity: "base" });

/** "09:30" -> 570 minutes. Returns null for anything malformed. */
export function parseTime(hhmm) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm ?? ""));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function formatTimeRange(start, end) {
  if (parseTime(start) === null) return "";
  return parseTime(end) === null ? String(start) : `${start}–${end}`;
}

/**
 * Start time, then end time, then title. Returns a new array.
 *
 * PINTS runs for a single day, so the start time is the whole ordering: there
 * is no manual rank field to tie-break on any more. Items with no usable start
 * time sort last rather than first, so a half-filled draft item does not jump
 * to the top of the published program.
 */
export function sortScheduleItems(items) {
  return [...items].sort((a, b) =>
    (parseTime(a?.start) ?? LATEST) - (parseTime(b?.start) ?? LATEST) ||
    (parseTime(a?.end) ?? LATEST) - (parseTime(b?.end) ?? LATEST) ||
    collator.compare(String(a?.title ?? ""), String(b?.title ?? "")));
}

/**
 * "2026-11-12" -> "Thursday, 12 November 2026".
 *
 * Parsed and formatted in UTC on purpose: with local time, a user east of
 * Greenwich late in the evening can see the heading roll back a day.
 */
export function formatDayHeading(isoDay, locale = "en-GB") {
  const date = new Date(`${isoDay}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(isoDay);
  return date.toLocaleDateString(locale, {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}
