const collator = new Intl.Collator("en", { sensitivity: "base" });

/** Author names with their 1-based affiliation superscript marks. */
export function authorLineParts(authors) {
  return (authors ?? []).map((author) => ({
    name: String(author?.name ?? "").trim(),
    marks: (author?.affiliationIndexes ?? []).map((i) => i + 1).join(","),
    presenting: Boolean(author?.presenting),
  }));
}

/**
 * The one name a collapsed list row shows: "Ana Ferreira et al."
 *
 * The presenting author, because they are who stands at the poster and who a
 * reader is looking for; the first author when nobody is marked, so a malformed
 * record still names somebody. "et al." counts *authors*, not presenters — two
 * people marked presenting is a data error, and swallowing the second one would
 * hide it. Empty string for no authors at all, so the caller can skip the line.
 */
export function summaryAuthorLine(authors) {
  const list = (authors ?? []).filter((a) => String(a?.name ?? "").trim());
  if (!list.length) return "";
  const lead = list.find((a) => a?.presenting) ?? list[0];
  const name = String(lead.name).trim();
  return list.length > 1 ? `${name} et al.` : name;
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
      a?.topic ?? "",
      ...(a?.authors ?? []).map((author) => author?.name ?? ""),
      ...(a?.affiliations ?? []),
    ].join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}

/**
 * Narrow the review pile.
 *
 * `type` is the PRESENTATION type, which lives only on the published copy, so
 * the caller annotates each abstract with `publicType` first (see
 * annotateAbstracts in abstract-export-utils.mjs). "unpublished" is a real
 * choice rather than an absence: "what have we not decided on yet" is the
 * question the committee actually asks.
 */
export function filterAdminAbstracts(
  list,
  { q = "", status = "", type = "", topic = "", talk = "" } = {},
) {
  const matched = (list ?? []).filter((a) =>
    (!status || a?.status === status)
    && (!topic || a?.topic === topic)
    && matchesType(a?.publicType ?? null, type)
    && matchesTalk(a?.talkConsidered, talk));
  return filterAbstracts(matched, q);
}

function matchesType(publicType, wanted) {
  if (!wanted) return true;
  if (wanted === "unpublished") return !publicType;
  return publicType === wanted;
}

/**
 * The submitter's talk opt-out, which is the committee's shortlist in reverse:
 * promoting somebody who ticked "not for a talk" is the one mistake this filter
 * exists to prevent.
 *
 * Only an explicit `false` is an opt-out. A missing field means the question was
 * never asked, and treating that as a refusal would hide abstracts from the very
 * list they belong on.
 */
function matchesTalk(talkConsidered, wanted) {
  if (!wanted) return true;
  return wanted === "optedout" ? talkConsidered === false : talkConsidered !== false;
}

/** Talks first, then posters by board number; ties broken on title. */
export function sortPublicAbstracts(list) {
  const rank = (a) => (a?.type === "talk" ? 0 : 1);
  return [...list].sort((a, b) =>
    rank(a) - rank(b) ||
    (a?.posterNumber ?? Number.MAX_SAFE_INTEGER) - (b?.posterNumber ?? Number.MAX_SAFE_INTEGER) ||
    collator.compare(String(a?.title ?? ""), String(b?.title ?? "")));
}

/**
 * Group abstracts by topic for the review console, in the order topics are
 * declared in config. Anything with an unrecognised or missing topic lands in a
 * final "Other" bucket rather than vanishing — an abstract the reviewers cannot
 * see is worse than an untidy heading. Empty topics are dropped.
 */
export function groupByTopic(list, topics) {
  const buckets = new Map(topics.map((topic) => [topic, []]));
  const other = [];
  for (const abstract of list ?? []) {
    const bucket = buckets.get(abstract?.topic);
    (bucket ?? other).push(abstract);
  }
  const groups = [...buckets.entries()]
    .filter(([, items]) => items.length)
    .map(([topic, items]) => ({ topic, items }));
  if (other.length) groups.push({ topic: null, items: other });
  return groups;
}

/**
 * A stable string standing in for the editable content of one draft.
 *
 * The account page has to know whether an open editor holds unsaved work before
 * it offers to save it, and the only honest answer is "does it still match what
 * was loaded". Comparing a fingerprint rather than the object keeps key order
 * out of it, so a draft rebuilt from the DOM compares equal to the one that
 * seeded it. Figure changes live outside the form fields and are tracked
 * separately by the caller.
 */
export function draftFingerprint(draft) {
  const authors = (draft?.authors ?? []).map((author) => [
    String(author?.name ?? "").trim(),
    (author?.affiliationIndexes ?? []).join(","),
    author?.presenting ? "1" : "0",
  ].join("␟"));
  return JSON.stringify([
    String(draft?.title ?? "").trim(),
    String(draft?.topic ?? ""),
    (draft?.affiliations ?? []).map((a) => String(a).trim()),
    authors,
    String(draft?.body ?? ""),
    draft?.talkConsidered !== false,
    String(draft?.figureCaption ?? "").trim(),
  ]);
}

/**
 * Where a submission stands, in words its author can act on.
 *
 * `status` is the private document's; `published` is the `abstracts_public`
 * copy, which is the only place the poster/talk decision and the board number
 * live. An accepted abstract with no public copy is a half-finished
 * acceptance in the console, so it says only "Accepted".
 *
 * Anything unrecognised reads as "In review" deliberately: a wrong label here
 * is a promise to a participant, and under-claiming is the safe direction.
 */
export function submissionStatusLabel(status, published = null) {
  if (status === "accepted") {
    if (published?.type === "talk") return "Accepted as a talk";
    if (published?.type === "poster") {
      return Number.isInteger(published.posterNumber)
        ? `Accepted as poster P${published.posterNumber}`
        : "Accepted as a poster";
    }
    return "Accepted";
  }
  if (status === "rejected") return "Not accepted";
  return "In review";
}

/**
 * Which of the three colours the status pill takes.
 *
 * Split from the label rather than returned with it so the label stays a plain
 * string for the dozen places that only want the words. The two agree by
 * construction: everything that is not a decision is "review", which is also
 * what a legacy `withdrawn` document lands on.
 */
export function submissionStatusTone(status) {
  if (status === "accepted") return "accepted";
  if (status === "rejected") return "rejected";
  return "review";
}
