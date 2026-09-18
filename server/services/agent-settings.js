export const SYSTEM_ALLOWED_COMMANDS = [
  'git commit',
  'git add',
  'git merge',
  'grep',
  'rg',
  'cat',
  'head',
  'tail',
  'find',
  'ls',
  'wc',
];

export function getAllowedCommandsFromUser(user) {
  let userCmds = [];
  if (user?.allowed_commands) {
    try {
      const parsed =
        typeof user.allowed_commands === 'string'
          ? JSON.parse(user.allowed_commands)
          : user.allowed_commands;
      if (Array.isArray(parsed)) userCmds = parsed;
    } catch {
      /* ignore */
    }
  }
  return [...SYSTEM_ALLOWED_COMMANDS, ...userCmds];
}

// Use PAT if set, otherwise fall back to OAuth access_token.
// Expects a user that has been fetched via the Feather service (plaintext secrets, no _encrypted fields).
export function getEffectiveGithubToken(user) {
  return user?.github_token || user?.access_token || null;
}
