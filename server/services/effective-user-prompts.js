import { combinePromptExtensions } from '../../shared/agent-prompts.js';

async function userRepoRow(db, userId, repoId) {
  if (!userId || !repoId) return null;
  return db('user_repos').where({ user_id: userId, repo_id: repoId }).first();
}

export async function getEffectiveAgentPrompt(app, userId, repoId) {
  const db = app.get('db');
  const user = await db('users').where({ id: userId }).first();
  const ur = await userRepoRow(db, userId, repoId);
  return combinePromptExtensions(user?.agent_prompt ?? '', ur?.agent_prompt ?? '');
}

export async function getEffectiveReviewPrompt(app, userId, repoId) {
  const db = app.get('db');
  const user = await db('users').where({ id: userId }).first();
  const ur = await userRepoRow(db, userId, repoId);
  return combinePromptExtensions(user?.review_prompt ?? '', ur?.review_prompt ?? '');
}
