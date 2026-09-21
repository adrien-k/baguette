import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Git author identity for a Baguette user.
 * Prefers the stored email; otherwise a GitHub noreply address so GitHub can
 * still attribute the commit to that account.
 */
export function gitIdentityFromUser(user) {
  const name = user?.username || 'baguette';
  const email =
    user?.email ||
    (user?.github_id && user?.username
      ? `${user.github_id}+${user.username}@users.noreply.github.com`
      : 'baguette@users.noreply.github.com');
  return { name, email };
}

/** Env vars that override git config for author and committer. */
export function gitAuthorEnvFromUser(user) {
  const { name, email } = gitIdentityFromUser(user);
  return {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
  };
}

/**
 * Configure git user identity for a session worktree.
 *
 * Linked worktrees share the repository-level config file. Plain
 * `git config user.name` therefore overwrites identity for every session on
 * the same repo, so a later session would make earlier ones commit as the
 * wrong Baguette user. `extensions.worktreeConfig` + `--worktree` keeps
 * name/email on the worktree only.
 */
export async function configureWorktreeGitIdentity(worktreePath, user) {
  const { name, email } = gitIdentityFromUser(user);
  await execFileAsync('git', ['-C', worktreePath, 'config', 'extensions.worktreeConfig', 'true'], {
    stdio: 'pipe',
  });
  await execFileAsync('git', ['-C', worktreePath, 'config', '--worktree', 'user.name', name], {
    stdio: 'pipe',
  });
  await execFileAsync('git', ['-C', worktreePath, 'config', '--worktree', 'user.email', email], {
    stdio: 'pipe',
  });
}
