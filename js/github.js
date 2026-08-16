import { REPO } from "./config.mjs";
import { commitMessage, contentsUrl, explainGithubError, toBase64Utf8 } from "./github-utils.mjs";

/**
 * Commit a page's markdown back to the repository from the browser.
 *
 * There is no server here, so the only way to write to GitHub is with a token
 * the organizer supplies themselves. That is a real trade-off and the UI says
 * so: the token lives in sessionStorage, so it is gone when the tab closes, and
 * "Forget token" removes it immediately. It is never written to the repository,
 * never logged, and never sent anywhere except api.github.com.
 *
 * Firestore remains the source of truth for what the site displays — this only
 * keeps content/*.md in step so the git history stays meaningful and the
 * fallback copy does not rot.
 */

const TOKEN_KEY = "pints.github.token";

export const getToken = () => sessionStorage.getItem(TOKEN_KEY) ?? "";
export const setToken = (token) => sessionStorage.setItem(TOKEN_KEY, token.trim());
export const forgetToken = () => sessionStorage.removeItem(TOKEN_KEY);

const headers = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

class GithubError extends Error {
  constructor(status) {
    super(explainGithubError(status));
    this.status = status;
  }
}

/**
 * The Contents API needs the blob sha of the file being replaced, so this is
 * always a read followed by a write. A missing file (404) is not fatal: it
 * means the page has no committed copy yet, and we create one.
 */
async function currentSha(url, token, branch) {
  const res = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, { headers: headers(token) });
  if (res.status === 404) return null;
  if (!res.ok) throw new GithubError(res.status);
  return (await res.json()).sha;
}

/** Resolves to the new commit's html_url. */
export async function commitPage({ token, path, markdown, label }) {
  const url = contentsUrl({ owner: REPO.owner, name: REPO.name, path });
  const sha = await currentSha(url, token, REPO.branch);

  const res = await fetch(url, {
    method: "PUT",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      message: commitMessage(label, path),
      content: toBase64Utf8(markdown),
      branch: REPO.branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) throw new GithubError(res.status);
  return (await res.json())?.commit?.html_url ?? null;
}
