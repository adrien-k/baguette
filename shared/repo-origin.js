/** Canonical GitHub remote URL for a linked `owner/repo` full name. */
export function gitHubOriginFromFullName(fullName) {
  if (!fullName || fullName.startsWith('/') || !fullName.includes('/')) return null;
  return `https://github.com/${fullName}.git`;
}

function stripGitSuffix(path) {
  if (path.endsWith('.git')) return path.slice(0, -4);
  return path;
}

/**
 * Parse a git remote origin. Accepts `git@host:path.git`, `ssh://git@host/path.git`,
 * and `https://host/path.git`. Returns `{ scheme, host, path, origin }` or null.
 */
export function parseGitRemoteOrigin(origin) {
  if (typeof origin !== 'string') return null;
  const trimmed = origin.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('ssh://')) {
    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      return null;
    }
    const host = parsed.hostname;
    const path = stripGitSuffix(parsed.pathname.replace(/^\/+/, ''));
    if (!host || !path) return null;
    return { scheme: 'ssh', host, path, origin: trimmed };
  }

  const scp = trimmed.match(/^([A-Za-z0-9._-]+)@([^:]+):(.+)$/);
  if (scp) {
    const path = stripGitSuffix(scp[3]);
    if (!path) return null;
    return { scheme: 'ssh', host: scp[2], path, origin: trimmed };
  }

  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      return null;
    }
    const path = stripGitSuffix(parsed.pathname.replace(/^\/+/, ''));
    if (!parsed.hostname || !path) return null;
    return {
      scheme: parsed.protocol.replace(':', ''),
      host: parsed.hostname,
      path,
      origin: trimmed,
    };
  }

  return null;
}

/** `org/repo` from an origin path when the path has at least two segments. */
export function inferFullNameFromOrigin(originOrParsed) {
  const parsed =
    typeof originOrParsed === 'string' ? parseGitRemoteOrigin(originOrParsed) : originOrParsed;
  if (!parsed?.path) return null;
  const parts = parsed.path.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

export function isGithubOriginHost(originOrParsed) {
  const parsed =
    typeof originOrParsed === 'string' ? parseGitRemoteOrigin(originOrParsed) : originOrParsed;
  if (!parsed?.host) return false;
  const host = parsed.host.toLowerCase();
  return host === 'github.com' || host === 'www.github.com';
}

/**
 * GitHub REST API is usable when the user has an App token or PAT and the remote
 * is hosted on github.com.
 */
export function githubApiAvailable({ token, origin } = {}) {
  if (!token) return false;
  return isGithubOriginHost(origin);
}

/** Auth object for git transport: `{ mode, token, userId }`. */
export function gitAuthFromRepo(repo, { token = null, userId = null } = {}) {
  if (isLocalRepo(repo)) {
    return { mode: 'local', token: null, userId };
  }
  return { mode: 'github', token: token || null, userId };
}

/** Legacy name convention: local repos use a bare name or absolute path as `full_name`. */
export function isLocalRepoFullName(fullName) {
  return gitHubOriginFromFullName(fullName) == null;
}

/**
 * True when the repo has no remote origin (local-only in Baguette).
 * Accepts a repo row (`{ origin, full_name?, access_mode? }`), or a `full_name` / origin string.
 */
export function isLocalRepo(fullNameOrRepo) {
  if (fullNameOrRepo != null && typeof fullNameOrRepo === 'object') {
    if (fullNameOrRepo.access_mode === 'local') return true;
    if (fullNameOrRepo.origin) return false;
    if ('origin' in fullNameOrRepo) return true;
    if (fullNameOrRepo.full_name != null) return isLocalRepoFullName(fullNameOrRepo.full_name);
    return true;
  }
  if (typeof fullNameOrRepo === 'string') {
    const parsed = parseGitRemoteOrigin(fullNameOrRepo);
    if (parsed?.scheme === 'ssh') return false;
  }
  return isLocalRepoFullName(fullNameOrRepo);
}

/** Auto-push only applies to repos with a remote (`github`); never local. */
export function autoPushEnabledForRepo(repoFullName, autoPush = true, repoRow = null) {
  if (isLocalRepo(repoRow ?? repoFullName)) return false;
  return autoPush;
}

/** Effective `github` | `local` for badges and transport. */
export function repoAccessMode(fullNameOrRepo) {
  if (fullNameOrRepo != null && typeof fullNameOrRepo === 'object') {
    const mode = fullNameOrRepo.access_mode;
    if (mode === 'github' || mode === 'local') return mode;
  }
  if (isLocalRepo(fullNameOrRepo)) return 'local';
  return 'github';
}

export function repoAccessModeLabel(fullNameOrRepo) {
  const mode = repoAccessMode(fullNameOrRepo);
  if (mode === 'local') return 'local';
  return 'GitHub';
}
