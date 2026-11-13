import GithubIcon from '../../components/svg/GithubIcon.jsx';
import { GHOST_BUTTON_CLASS } from '../../utils/buttonStyles.js';
import { ONBOARDING_STEP } from '../../utils/onboardingSteps.js';

const GITHUB_ONBOARDING_REDIRECT = `/auth/github?redirectTo=${encodeURIComponent(
  `/onboarding?step=${ONBOARDING_STEP.REPOSITORIES}`
)}`;

export default function GithubSignInStep({ onBack, showBack }) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-fg mb-2">Sign in with GitHub</h1>
      <p className="text-fg-muted text-sm mb-8">
        Link this account to GitHub so Baguette can list repositories and open pull requests.
      </p>
      <a
        href={GITHUB_ONBOARDING_REDIRECT}
        className="inline-flex items-center justify-center gap-3 bg-white text-black px-6 py-3 rounded-lg font-medium hover:bg-zinc-200 transition-colors w-full"
      >
        <GithubIcon className="w-5 h-5" />
        Sign in with GitHub
      </a>
      {showBack ? (
        <div className="mt-8 flex justify-start">
          <button type="button" className={GHOST_BUTTON_CLASS} onClick={onBack}>
            Back
          </button>
        </div>
      ) : null}
    </div>
  );
}
