import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_STEP,
  canContinueIdentityStep,
  clampOnboardingStepId,
  identityIsUsable,
  passkeyRequiredForIdentity,
  showGithubRepoPicker,
  visibleOnboardingSteps,
} from '../onboardingSteps.js';

const NO_APP_TAIL = [
  ONBOARDING_STEP.GIT_CREDENTIALS,
  ONBOARDING_STEP.REPOSITORIES,
  ONBOARDING_STEP.AGENTS,
];

const APP_TAIL = [ONBOARDING_STEP.REPOSITORIES, ONBOARDING_STEP.AGENTS];

describe('visibleOnboardingSteps', () => {
  it('shows GitHub App, identity, and git credentials for the first user when the App is not configured', () => {
    expect(
      visibleOnboardingSteps({
        githubConfigured: false,
        githubLinked: false,
        isFirstUser: true,
      })
    ).toEqual([ONBOARDING_STEP.GITHUB_APP, ONBOARDING_STEP.IDENTITY, ...NO_APP_TAIL]);
  });

  it('hides GitHub App and identity for later users when the App is not configured', () => {
    expect(
      visibleOnboardingSteps({
        githubConfigured: false,
        githubLinked: false,
        isFirstUser: false,
      })
    ).toEqual(NO_APP_TAIL);
  });

  it('shows mandatory GitHub sign-in then repos when the App is configured and the user is not linked', () => {
    expect(
      visibleOnboardingSteps({
        githubConfigured: true,
        githubLinked: false,
        isFirstUser: false,
      })
    ).toEqual([ONBOARDING_STEP.GITHUB_SIGNIN, ...APP_TAIL]);
  });

  it('skips App, sign-in, identity, and git credentials once GitHub is configured and linked', () => {
    expect(
      visibleOnboardingSteps({
        githubConfigured: true,
        githubLinked: true,
        isFirstUser: true,
      })
    ).toEqual(APP_TAIL);
  });
});

describe('passkeyRequiredForIdentity', () => {
  it('is required when there is no GitHub App', () => {
    expect(passkeyRequiredForIdentity({ githubConfigured: false })).toBe(true);
    expect(passkeyRequiredForIdentity({ githubConfigured: true })).toBe(false);
  });
});

describe('canContinueIdentityStep', () => {
  it('requires a registered passkey', () => {
    expect(canContinueIdentityStep(null)).toBe(false);
    expect(canContinueIdentityStep({ passkey_count: 0, github_linked: true })).toBe(false);
    expect(canContinueIdentityStep({ passkey_count: 1, github_linked: false })).toBe(true);
  });
});

describe('identityIsUsable', () => {
  it('requires a passkey with no App, or a linked GitHub account when the App is configured', () => {
    expect(identityIsUsable(null, { githubConfigured: false })).toBe(false);
    expect(
      identityIsUsable({ github_linked: true, passkey_count: 0 }, { githubConfigured: false })
    ).toBe(false);
    expect(
      identityIsUsable({ github_linked: true, passkey_count: 0 }, { githubConfigured: true })
    ).toBe(true);
    expect(
      identityIsUsable({ github_linked: false, passkey_count: 1 }, { githubConfigured: true })
    ).toBe(false);
    expect(
      identityIsUsable({ github_linked: false, passkey_count: 1 }, { githubConfigured: false })
    ).toBe(true);
  });
});

describe('showGithubRepoPicker', () => {
  it('shows when the App, a linked account, or a saved PAT is available', () => {
    expect(
      showGithubRepoPicker({ githubConfigured: true, githubLinked: false, hasGithubPat: false })
    ).toBe(true);
    expect(
      showGithubRepoPicker({ githubConfigured: false, githubLinked: true, hasGithubPat: false })
    ).toBe(true);
    expect(
      showGithubRepoPicker({ githubConfigured: false, githubLinked: false, hasGithubPat: true })
    ).toBe(true);
    expect(
      showGithubRepoPicker({ githubConfigured: false, githubLinked: false, hasGithubPat: false })
    ).toBe(false);
  });
});

describe('clampOnboardingStepId', () => {
  it('keeps the current step when it is still visible', () => {
    const steps = visibleOnboardingSteps({
      githubConfigured: true,
      githubLinked: false,
      isFirstUser: false,
    });
    expect(clampOnboardingStepId(ONBOARDING_STEP.GITHUB_SIGNIN, steps)).toBe(
      ONBOARDING_STEP.GITHUB_SIGNIN
    );
  });

  it('falls back to GitHub sign-in when identity or git credentials are skipped because the App is configured', () => {
    const steps = visibleOnboardingSteps({
      githubConfigured: true,
      githubLinked: false,
      isFirstUser: false,
    });
    expect(clampOnboardingStepId(ONBOARDING_STEP.IDENTITY, steps)).toBe(
      ONBOARDING_STEP.GITHUB_SIGNIN
    );
    expect(clampOnboardingStepId(ONBOARDING_STEP.GIT_CREDENTIALS, steps)).toBe(
      ONBOARDING_STEP.GITHUB_SIGNIN
    );
  });

  it('falls back to git credentials when a later user opens GitHub App or identity', () => {
    const steps = visibleOnboardingSteps({
      githubConfigured: false,
      githubLinked: false,
      isFirstUser: false,
    });
    expect(clampOnboardingStepId(ONBOARDING_STEP.GITHUB_APP, steps)).toBe(
      ONBOARDING_STEP.GIT_CREDENTIALS
    );
    expect(clampOnboardingStepId(ONBOARDING_STEP.IDENTITY, steps)).toBe(
      ONBOARDING_STEP.GIT_CREDENTIALS
    );
  });

  it('falls back to repositories when git credentials are skipped after GitHub is linked', () => {
    const steps = visibleOnboardingSteps({
      githubConfigured: true,
      githubLinked: true,
      isFirstUser: true,
    });
    expect(clampOnboardingStepId(ONBOARDING_STEP.GIT_CREDENTIALS, steps)).toBe(
      ONBOARDING_STEP.REPOSITORIES
    );
  });
});
