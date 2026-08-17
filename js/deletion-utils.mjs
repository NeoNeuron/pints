// What a deletion is about to destroy, worked out before anything is destroyed.
//
// Deleting a participant reaches four collections and the storage bucket, and
// none of that is visible from the button you press. These functions turn the
// data the admin console already has into an explicit list, so the confirmation
// dialog can name the damage and the caller can act on the same list rather
// than recomputing it.

/**
 * Everything that removing `uid` takes with it.
 *
 * `abstracts` is the full private list and `published` the public projection;
 * both are already loaded by the admin console for its own rendering.
 */
export function participantDeletionPlan(uid, abstracts = [], published = []) {
  const owned = (abstracts ?? []).filter((a) => a?.ownerUid === uid);
  const ownedIds = new Set(owned.map((a) => a?.id));
  return {
    uid,
    abstractIds: owned.map((a) => a?.id).filter(Boolean),
    publishedIds: (published ?? []).map((p) => p?.id).filter((id) => ownedIds.has(id)),
    figurePaths: owned.map((a) => a?.figurePath).filter(Boolean),
  };
}

/** Everything that removing one abstract takes with it. */
export function abstractDeletionPlan(abstract, published = []) {
  const id = abstract?.id;
  return {
    abstractIds: id ? [id] : [],
    publishedIds: (published ?? []).some((p) => p?.id === id) ? [id] : [],
    figurePaths: abstract?.figurePath ? [abstract.figurePath] : [],
  };
}

/**
 * The sentence the confirmation dialog shows.
 *
 * It names the login explicitly because that is the part nobody expects: an
 * organizer thinks of this as removing a row from a list, and it also destroys
 * the person's ability to sign in.
 */
export function describeParticipantDeletion(name, plan) {
  const who = name?.trim() ? `“${name.trim()}”` : "this participant";
  const { abstractIds, publishedIds } = plan;

  let what;
  if (!abstractIds.length) {
    what = "their login";
  } else if (abstractIds.length === 1) {
    what = publishedIds.length
      ? "their abstract, which is published, and their login"
      : "their abstract and their login";
  } else {
    const published = publishedIds.length
      ? `, ${publishedIds.length} of them published,`
      : "";
    what = `their ${abstractIds.length} abstracts${published} and their login`;
  }

  return `Delete ${who}? This also deletes ${what}. It cannot be undone.`;
}

export function describeAbstractDeletion(title, plan) {
  const what = title?.trim() ? `“${title.trim()}”` : "this abstract";
  const published = plan.publishedIds.length
    ? " It is currently published, so it will disappear from the public list."
    : "";
  return `Delete ${what}?${published} This cannot be undone.`;
}
