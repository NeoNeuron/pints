/**
 * Pure helpers for talking to the GitHub Contents API. Kept apart from
 * github.js so they can be tested under Node without a network or a token.
 */

/**
 * UTF-8 safe base64, which the Contents API requires for file bodies.
 *
 * btoa() alone throws on any character above U+00FF, so accented text — which
 * this site is full of — has to be encoded to bytes first. Chunked because
 * String.fromCharCode(...bytes) blows the argument limit on a large page.
 */
export function toBase64Utf8(text) {
  const bytes = new TextEncoder().encode(String(text ?? ""));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Decode what the Contents API returns, which is base64 with newlines in it. */
export function fromBase64Utf8(encoded) {
  const binary = atob(String(encoded ?? "").replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function contentsUrl({ owner, name, path }) {
  const segments = String(path).split("/").map(encodeURIComponent).join("/");
  return `https://api.github.com/repos/${encodeURIComponent(owner)}`
    + `/${encodeURIComponent(name)}/contents/${segments}`;
}

/** Commit subject in the repository's existing style: "content: ...". */
export function commitMessage(label, file) {
  return `content: update ${label} from the admin console\n\nEdited at admin.html and written back to ${file}.`;
}

/** Turn a GitHub API failure into something an organizer can act on. */
export function explainGithubError(status) {
  if (status === 401) return "GitHub rejected the token. It may be expired or mistyped.";
  if (status === 403) return "The token is valid but lacks permission. It needs Contents: Read and write on this repository.";
  if (status === 404) {
    return "GitHub could not find the file or the repository. A fine-grained token also reports 404 when it has no access at all.";
  }
  if (status === 409) return "The file changed on GitHub since this page loaded. Reload the tab and try again.";
  if (status === 422) return "GitHub rejected the commit as invalid.";
  return `GitHub returned an unexpected error (${status}).`;
}
