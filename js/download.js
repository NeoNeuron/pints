/**
 * Hand the browser a generated file.
 *
 * Shared by every CSV export so they cannot drift apart in how they build the
 * blob or clean up after it. An object URL that is never revoked keeps its blob
 * alive for the life of the document, which matters once a page can export
 * several times in a sitting.
 */
export function download(filename, text, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
