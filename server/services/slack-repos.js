/** Which repository a Slack-started session should use. */
import { mentionsWord } from './slack-text.js';

const MIN_SHORT_NAME_LENGTH = 3;

const listNames = (repos) => repos.map((repo) => `\`${repo.full_name}\``).join(', ');

/** The user's repositories (not deleted). */
export async function userRepos(db, userId) {
  return db('repos')
    .join('user_repos', 'repos.id', 'user_repos.repo_id')
    .where('user_repos.user_id', userId)
    .whereNull('repos.deleted_at')
    .select('repos.id', 'repos.full_name', 'repos.default_branch');
}

/** Repos the text names: by full name, else by short name as a whole word. */
export function reposNamedInText(repos, text) {
  const lower = text.toLowerCase();
  const byFullName = repos.filter((repo) => lower.includes(repo.full_name.toLowerCase()));
  if (byFullName.length) return byFullName;
  return repos.filter((repo) => {
    const shortName = repo.full_name.split('/').pop();
    return shortName.length >= MIN_SHORT_NAME_LENGTH && mentionsWord(text, shortName);
  });
}

/**
 * Explicit `repo=` → a repo named in the message → the user's only repo → the repo of their
 * latest session. Returns `{ repo }` or `{ error }` with a message fit to show in Slack.
 */
export async function resolveRepo(db, userId, requested, text = '') {
  const repos = await userRepos(db, userId);
  if (!repos.length) return { error: 'You have no repositories in Baguette yet.' };

  if (requested) {
    const wanted = requested.toLowerCase();
    const match =
      repos.find((repo) => repo.full_name.toLowerCase() === wanted) ??
      repos.find((repo) => repo.full_name.toLowerCase().endsWith(`/${wanted}`));
    if (match) return { repo: match };
    return { error: `I couldn't find "${requested}". Your repos: ${listNames(repos)}.` };
  }

  if (repos.length === 1) return { repo: repos[0] };

  const named = reposNamedInText(repos, text);
  if (named.length === 1) return { repo: named[0] };
  if (named.length > 1) {
    return { error: `Which one — ${listNames(named)}? Add \`repo=owner/name\` to your message.` };
  }

  const latest = await db('sessions')
    .where({ user_id: userId })
    .whereIn(
      'repo_id',
      repos.map((repo) => repo.id)
    )
    .orderBy('id', 'desc')
    .first();
  const latestRepo = latest && repos.find((repo) => repo.id === latest.repo_id);
  if (latestRepo) return { repo: latestRepo };

  return {
    error: `Which repo? Add \`repo=owner/name\` to your message. Your repos: ${listNames(repos)}.`,
  };
}
