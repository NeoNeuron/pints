/** Resolve the served file name from a pathname, treating directories as index.html. */
export function currentPageFile(pathname) {
  const last = String(pathname ?? "").split("/").pop();
  return last === "" || last === undefined ? "index.html" : last;
}

/** Return a copy of `nav` with an `active` flag on the entry matching `pathname`. */
export function markActive(nav, pathname) {
  const file = currentPageFile(pathname);
  return nav.map((item) => ({ ...item, active: item.href === file }));
}
