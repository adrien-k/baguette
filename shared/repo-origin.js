/** Canonical GitHub remote URL for a linked `owner/repo` full name. */
export function gitHubOriginFromFullName(fullName) {
  if (!fullName || fullName.startsWith('/') || !fullName.includes('/')) return null;
  return `https://github.com/${fullName}.git`;
}

/** Legacy name convention: local repos use a bare name or absolute path as `full_name`. */
export function isLocalRepoFullName(fullName) {
  return gitHubOriginFromFullName(fullName) == null;
}

/**
 * True when the repo has no remote origin (local-only in Baguette).
 * Accepts a repo row (`{ origin, full_name? }`), or a `full_name` string when no row is loaded.
 */
export function isLocalRepo(fullNameOrRepo) {
  if (fullNameOrRepo != null && typeof fullNameOrRepo === 'object') {
    if (fullNameOrRepo.origin) return false;
    if ('origin' in fullNameOrRepo) return true;
    if (fullNameOrRepo.full_name != null) return isLocalRepoFullName(fullNameOrRepo.full_name);
    return true;
  }
  return isLocalRepoFullName(fullNameOrRepo);
}
