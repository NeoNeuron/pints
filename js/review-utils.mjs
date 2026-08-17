/**
 * Reviewer scores and notes.
 *
 * Every organizer holds their own score and their own note, stored as a map
 * keyed by reviewer uid inside abstract_reviews/{abstractId}. A map rather than
 * a subcollection because the console shows every review on every card, and a
 * subcollection would be one extra read per abstract for data that is never
 * fetched separately.
 *
 * Pure: no DOM, no Firestore. db.js owns the merge write that keeps two
 * organizers reviewing at once from overwriting each other.
 */

export const SCORE_MIN = 1;
export const SCORE_MAX = 10;

/** Scores are whole numbers 1–10. Anything else is treated as "not scored". */
export const isScore = (value) =>
  Number.isInteger(value) && value >= SCORE_MIN && value <= SCORE_MAX;

/** The 1–10 options, for building a <select>. */
export const scoreOptions = () =>
  Array.from({ length: SCORE_MAX - SCORE_MIN + 1 }, (_, i) => SCORE_MIN + i);

/**
 * Read one abstract's reviews map into something sortable and displayable.
 *
 * An entry with a note but no score still counts as a review — an organizer who
 * writes "conflict of interest, abstaining" has reviewed it — so `entries` and
 * `count` are deliberately different numbers.
 */
export function reviewStats(reviews) {
  const entries = Object.entries(reviews ?? {})
    .map(([uid, review]) => ({
      uid,
      score: isScore(review?.score) ? review.score : null,
      note: String(review?.note ?? ""),
    }))
    .filter((entry) => entry.score !== null || entry.note.trim() !== "")
    .sort((a, b) => a.uid.localeCompare(b.uid));

  const scored = entries.filter((entry) => entry.score !== null);
  const total = scored.reduce((sum, entry) => sum + entry.score, 0);
  return {
    entries,
    count: scored.length,
    // One decimal: a mean of 7.333… reads as false precision on a 1–10 scale
    // with three reviewers.
    mean: scored.length ? Math.round((total / scored.length) * 10) / 10 : null,
  };
}

/** "Mean 7.3 · 3 of 5 organizers scored" — or plain English when nobody has. */
export function describeReviewStats({ mean, count }, reviewerCount) {
  if (!count) return "Not scored yet.";
  return `Mean ${mean.toFixed(1)} · ${count} of ${reviewerCount} organizer`
    + `${reviewerCount === 1 ? "" : "s"} scored`;
}

/**
 * The whole committee's scores as a spreadsheet: one row per abstract, one
 * column per organizer, then the mean and how many scored it.
 *
 * `reviewers` fixes the column order, so a reviewer who has scored nothing
 * still gets a column — an empty column is a fact worth seeing when you are
 * chasing people for reviews.
 */
export function reviewScoreMatrix(annotated, { reviewsById = new Map(), reviewers = [] } = {}) {
  const columns = [
    { key: "title", label: "Title" },
    { key: "topic", label: "Topic" },
    { key: "status", label: "Status" },
    { key: "type", label: "Presentation" },
    { key: "submitter", label: "Submitted by" },
    ...reviewers.map((reviewer) => ({ key: `r:${reviewer.uid}`, label: reviewer.name })),
    { key: "mean", label: "Mean" },
    { key: "count", label: "Scores" },
  ];

  const rows = (annotated ?? []).map((abstract) => {
    const stats = reviewStats(reviewsById.get(abstract.id)?.reviews);
    const byUid = new Map(stats.entries.map((entry) => [entry.uid, entry.score]));
    const row = {
      title: abstract.title ?? "",
      topic: abstract.topic ?? "",
      status: abstract.status ?? "",
      type: abstract.publicType ?? "",
      submitter: abstract.submitterName ?? "",
      mean: stats.mean ?? "",
      count: stats.count,
    };
    for (const reviewer of reviewers) {
      row[`r:${reviewer.uid}`] = byUid.get(reviewer.uid) ?? "";
    }
    return row;
  });

  return { columns, rows };
}

/**
 * Who the score columns belong to.
 *
 * An organizer is normally a participant too, so their profile carries a real
 * name; fall back to the email on their admins document, and to the raw uid
 * only if neither exists. A column headed with a uid is useless but still
 * better than a column headed with nothing.
 */
export function reviewerList(adminDocs, usersById) {
  return (adminDocs ?? [])
    .map((admin) => ({
      uid: admin.id,
      name: usersById?.get(admin.id)?.displayName || admin.email || admin.id,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
