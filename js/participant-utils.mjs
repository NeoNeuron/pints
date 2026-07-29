// Accent- and case-insensitive so "Émile" sorts with "Emile", which is what
// people expect from an academic name list.
const collator = new Intl.Collator("en", { sensitivity: "base", ignorePunctuation: true });

/** Surname key: the last whitespace-separated token of a display name. */
export function lastNameKey(displayName) {
  const parts = String(displayName ?? "").trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

/** Sort by surname, then by full name. Returns a new array. */
export function sortParticipants(list) {
  return [...list].sort((a, b) =>
    collator.compare(lastNameKey(a?.displayName), lastNameKey(b?.displayName)) ||
    collator.compare(String(a?.displayName ?? ""), String(b?.displayName ?? "")));
}
