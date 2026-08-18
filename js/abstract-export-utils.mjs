import { TOPIC_LABELS } from "./config.mjs";

/**
 * Flattening for the review console: joins, projections, and CSV shapes.
 *
 * Pure on purpose. Everything here is the kind of code that is wrong in a way
 * nobody notices until an organizer opens the spreadsheet the night before the
 * meeting and a column is off by one.
 */

/** A Firestore Timestamp, a Date, or nothing -> "YYYY-MM-DD" or "". */
export function isoDate(value) {
  const date = typeof value?.toDate === "function" ? value.toDate()
    : value instanceof Date ? value
    : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}

/**
 * Join each abstract to its published copy and its submitter, once.
 *
 * The console needs the presentation type to filter on, the board number to
 * show, and the submitter's name to display — all three from other collections.
 * Doing the join here means the cards, the filter and both exports read the
 * same fields and cannot disagree about them.
 */
export function annotateAbstracts(abstracts, { published = [], users = [] } = {}) {
  const publicById = new Map((published ?? []).map((p) => [p.id, p]));
  const userById = new Map((users ?? []).map((u) => [u.id, u]));
  return (abstracts ?? []).map((abstract) => {
    const live = publicById.get(abstract.id) ?? null;
    const submitter = userById.get(abstract.ownerUid) ?? null;
    return {
      ...abstract,
      publicType: live?.type ?? null,
      posterNumber: live?.posterNumber ?? null,
      acceptedAt: live?.acceptedAt ?? null,
      submitterName: submitter?.displayName ?? "",
      submitterEmail: submitter?.email ?? "",
    };
  });
}

/** "Alice Dupont (1), Bob Martin (1,2)" — the affiliation marks readers expect. */
export function authorsCell(authors) {
  return (authors ?? []).map((author) => {
    const marks = (author?.affiliationIndexes ?? []).map((i) => i + 1).join(",");
    return marks ? `${author?.name ?? ""} (${marks})` : String(author?.name ?? "");
  }).join("; ");
}

export const presentingAuthor = (authors) =>
  (authors ?? []).find((a) => a?.presenting)?.name ?? "";

export const ABSTRACT_EXPORT_COLUMNS = [
  { key: "title", label: "Title" },
  { key: "topic", label: "Topic" },
  { key: "status", label: "Status" },
  { key: "type", label: "Presentation" },
  { key: "posterNumber", label: "Poster number" },
  { key: "presenting", label: "Presenting author" },
  { key: "authors", label: "Authors" },
  { key: "affiliations", label: "Affiliations" },
  { key: "submitterName", label: "Submitted by" },
  { key: "submitterEmail", label: "Submitter email" },
  { key: "talkConsidered", label: "Considered for a talk" },
  { key: "figureCaption", label: "Figure caption" },
  { key: "figureUrl", label: "Figure URL" },
  { key: "createdAt", label: "Submitted on" },
  { key: "updatedAt", label: "Last edited" },
  { key: "body", label: "Abstract" },
];

/** One row per abstract, in the order ABSTRACT_EXPORT_COLUMNS declares. */
export function abstractExportRows(annotated) {
  return (annotated ?? []).map((a) => ({
    title: a.title ?? "",
    topic: TOPIC_LABELS[a.topic] ?? a.topic ?? "",
    status: a.status ?? "",
    // Blank, not "poster": everything is submitted as a poster, and printing
    // that for an undecided abstract would read as a decision nobody made.
    type: a.publicType ?? "",
    posterNumber: a.publicType === "poster" && a.posterNumber ? a.posterNumber : "",
    presenting: presentingAuthor(a.authors),
    authors: authorsCell(a.authors),
    affiliations: (a.affiliations ?? []).map((x, i) => `${i + 1}. ${x}`).join("; "),
    submitterName: a.submitterName ?? "",
    submitterEmail: a.submitterEmail ?? "",
    talkConsidered: a.talkConsidered === false ? "no" : "yes",
    figureCaption: a.figureCaption ?? "",
    figureUrl: a.figureUrl ?? "",
    createdAt: isoDate(a.createdAt),
    updatedAt: isoDate(a.updatedAt),
    body: a.body ?? "",
  }));
}
