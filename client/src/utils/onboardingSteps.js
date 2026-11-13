export const ONBOARDING_STEP = {
  GITHUB_APP: 'github_app',
  GITHUB_SIGNIN: 'github_signin',
  IDENTITY: 'identity',
  GIT_CREDENTIALS: 'git_credentials',
  AGENTS: 'agents',
  REPOSITORIES: 'repositories',
};

/** Identity (username + passkey) is only shown when there is no GitHub App. */
export function passkeyRequiredForIdentity({ githubConfigured } = {}) {
  return !githubConfigured;
}

/** True when the identity step can Continue — a registered passkey. */
export function canContinueIdentityStep(user) {
  if (!user) return false;
  return Number(user.passkey_count) >= 1;
}

/**
 * True when the user can finish onboarding.
 * No GitHub App: a passkey. With a GitHub App: a linked GitHub account.
 */
export function identityIsUsable(user, { githubConfigured } = {}) {
  if (!user) return false;
  if (githubConfigured) return Boolean(user.github_linked);
  return Number(user.passkey_count) >= 1;
}

/**
 * Visible wizard steps, skipping those already satisfied.
 * The first user sees GitHub App + identity when the App is not configured.
 * Later users never see those instance-setup steps (they already have a
 * passkey from invite, or GitHub from OAuth).
 * GitHub App configured → mandatory GitHub sign-in if not linked, then repos.
 * No GitHub App → git credentials (and identity only for the first user).
 */
export function visibleOnboardingSteps({ githubConfigured, githubLinked, isFirstUser }) {
  const steps = [];
  if (isFirstUser && !githubConfigured) {
    steps.push(ONBOARDING_STEP.GITHUB_APP);
    steps.push(ONBOARDING_STEP.IDENTITY);
    steps.push(ONBOARDING_STEP.GIT_CREDENTIALS);
  } else if (!githubConfigured) {
    steps.push(ONBOARDING_STEP.GIT_CREDENTIALS);
  } else if (!githubLinked) {
    steps.push(ONBOARDING_STEP.GITHUB_SIGNIN);
  }
  steps.push(ONBOARDING_STEP.REPOSITORIES);
  steps.push(ONBOARDING_STEP.AGENTS);
  return steps;
}

/** GitHub repo picker when the App, a linked GitHub account, or a saved PAT can list repos. */
export function showGithubRepoPicker({ githubConfigured, githubLinked, hasGithubPat }) {
  return Boolean(githubConfigured || githubLinked || hasGithubPat);
}

/** Keep the current step if it is still visible; otherwise the first remaining step. */
export function clampOnboardingStepId(stepId, steps) {
  if (steps.includes(stepId)) return stepId;
  return steps[0] ?? ONBOARDING_STEP.AGENTS;
}
