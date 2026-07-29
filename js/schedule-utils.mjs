const LATEST = Number.MAX_SAFE_INTEGER;

/** "09:30" -> 570 minutes. Returns null for anything malformed. */
export function parseTime(hhmm) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm ?? ""));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function formatTimeRange(start, end) {
  if (parseTime(start) === null) return "";
  return parseTime(end) === null ? String(start) : `${start}–${end}`;
}

/** Start time, then the explicit order field. Returns a new array. */
export function sortDayItems(items) {
  return [...items].sort((a, b) =>
    (parseTime(a?.start) ?? LATEST) - (parseTime(b?.start) ?? LATEST) ||
    (a?.order ?? 0) - (b?.order ?? 0));
}

/** [{day, items}] in chronological day order, each day internally sorted. */
export function groupByDay(items) {
  const byDay = new Map();
  for (const item of items) {
    const day = item?.day ?? "";
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(item);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, entries]) => ({ day, items: sortDayItems(entries) }));
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
