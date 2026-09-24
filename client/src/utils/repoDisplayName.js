/** Display name for a repo full_name:
 *  - GitHub "owner/repo"    → "repo"
 *  - local path "/a/b/name" → "name"
 *  - local name "my-proj"   → "my-proj"
 */
export function repoDisplayName(fullName) {
  if (!fullName) return '';
  if (fullName.startsWith('/')) return fullName.split('/').filter(Boolean).pop() || fullName;
  if (fullName.includes('/')) return fullName.split('/')[1];
  return fullName;
}

/** True for repos not hosted on GitHub (brand-new or imported from local path). */
export function isLocalRepo(fullName) {
  return !fullName || fullName.startsWith('/') || !fullName.includes('/');
}

/** Owner/org for a GitHub `owner/repo`, or `"Local"` for path/name-only repos. */
export function repoOrg(fullName) {
  if (isLocalRepo(fullName)) return 'Local';
  return fullName.split('/')[0];
}

/** `org / name` for mixed session lists (All sessions). */
export function formatRepoLabel(fullName) {
  if (!fullName) return '';
  return `${repoOrg(fullName)} / ${repoDisplayName(fullName)}`;
}

/**
 * Group repositories by org, preserving first-seen org order. Local repos are a
 * trailing "Local" group. Repos inside a group keep their original order.
 */
export function groupReposByOrg(repos) {
  const groups = [];
  const byOrg = new Map();
  for (const repo of repos) {
    const org = repoOrg(repo.full_name);
    let group = byOrg.get(org);
    if (!group) {
      group = { org, repos: [] };
      byOrg.set(org, group);
      groups.push(group);
    }
    group.repos.push(repo);
  }
  const local = groups.filter((g) => g.org === 'Local');
  const hosted = groups.filter((g) => g.org !== 'Local');
  return [...hosted, ...local];
}
