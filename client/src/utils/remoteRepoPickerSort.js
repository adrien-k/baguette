/** Repos not yet linked to the account sort above already-added ones; names break ties. */
export function sortRemoteReposForPicker(repos, addedNames) {
  return [...repos].sort((a, b) => {
    const aAdded = addedNames.has(a.full_name);
    const bAdded = addedNames.has(b.full_name);
    if (aAdded !== bAdded) {
      return aAdded ? 1 : -1;
    }
    return a.full_name.localeCompare(b.full_name);
  });
}

const GITHUB_REPO_FULL_NAME_RE = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

/** Whether the query is long enough to search public repos on GitHub. */
export function isPublicRepoSearchQuery(query) {
  const q = query.trim();
  if (!q) return false;
  if (GITHUB_REPO_FULL_NAME_RE.test(q)) return true;
  return q.length >= 2;
}
