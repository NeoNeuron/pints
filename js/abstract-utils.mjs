const collator = new Intl.Collator("en", { sensitivity: "base" });

/** Author names with their 1-based affiliation superscript marks. */
export function authorLineParts(authors) {
  return (authors ?? []).map((author) => ({
    name: String(author?.name ?? "").trim(),
    marks: (author?.affiliationIndexes ?? []).map((i) => i + 1).join(","),
    presenting: Boolean(author?.presenting),
  }));
}

/** The next free poster board number. */
export function nextPosterNumber(publicAbstracts) {
  const used = (publicAbstracts ?? [])
    .map((a) => a?.posterNumber)
    .filter((n) => Number.isInteger(n));
  return used.length ? Math.max(...used) + 1 : 1;
}

/** Free-text search over title, body, author names, and affiliations. */
export function filterAbstracts(list, term) {
  const needle = String(term ?? "").trim().toLowerCase();
  if (!needle) return [...list];
  return list.filter((a) => {
    const haystack = [
      a?.title ?? "",
      a?.body ?? "",
      ...(a?.authors ?? []).map((author) => author?.name ?? ""),
      ...(a?.affiliations ?? []),
    ].join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}

/** Talks first, then posters by board number; ties broken on title. */
export function sortPublicAbstracts(list) {
  const rank = (a) => (a?.type === "talk" ? 0 : 1);
  return [...list].sort((a, b) =>
    rank(a) - rank(b) ||
    (a?.posterNumber ?? Number.MAX_SAFE_INTEGER) - (b?.posterNumber ?? Number.MAX_SAFE_INTEGER) ||
    collator.compare(String(a?.title ?? ""), String(b?.title ?? "")));
}
