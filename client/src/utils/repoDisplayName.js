import { isLocalRepo as isLocalRepoShared } from '@baguette/shared/repo-origin.js';

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

/** True when the repo has no GitHub origin (local-only). Accepts a repo row or `full_name` string. */
export function isLocalRepo(fullNameOrRepo) {
  return isLocalRepoShared(fullNameOrRepo);
}

/** Auto-push only applies to GitHub-hosted repositories with a remote. */
export function autoPushEnabledForRepo(repoFullName, autoPush = true, repoRow = null) {
  const row = repoRow ?? undefined;
  if (isLocalRepo(row ?? repoFullName)) return false;
  return autoPush;
}

/** Owner/org for a GitHub `owner/repo`, or `"Local"` for path/name-only repos. */
export function repoOrg(fullName) {
  if (isLocalRepo(fullName)) return 'Local';
  return fullName.split('/')[0];
}

/** Display names that appear on more than one repo (needs org prefix to disambiguate). */
export function duplicateRepoDisplayNames(fullNames) {
  const counts = new Map();
  for (const fullName of fullNames) {
    if (!fullName) continue;
    const name = repoDisplayName(fullName);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const dupes = new Set();
  for (const [name, count] of counts) {
    if (count > 1) dupes.add(name);
  }
  return dupes;
}

/** Repo label for mixed lists: `org / name` only when the short name is duplicated. */
export function formatRepoLabel(fullName, duplicateDisplayNames) {
  if (!fullName) return '';
  const name = repoDisplayName(fullName);
  if (duplicateDisplayNames?.has(name)) {
    return `${repoOrg(fullName)} / ${name}`;
  }
  return name;
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
