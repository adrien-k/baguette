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

export function getAllowedCommandsFromUser() {
  return [...SYSTEM_ALLOWED_COMMANDS];
}

// Optional PAT overrides the GitHub App user-to-server token from sign-in.
// Expects a user fetched via the Feathers service (plaintext secrets, no _encrypted fields).
export function getGithubToken(user) {
  return user?.github_token || user?.access_token || null;
}
