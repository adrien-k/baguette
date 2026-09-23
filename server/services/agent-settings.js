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

// The user-to-server token obtained from the GitHub App sign-in flow.
// Expects a user that has been fetched via the Feather service (plaintext secrets, no _encrypted fields).
export function getGithubToken(user) {
  return user?.access_token || null;
}
