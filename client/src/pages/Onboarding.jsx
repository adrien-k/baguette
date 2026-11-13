import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { usersService } from '../feathers.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { toastError } from '../utils/toastError.jsx';
import BaguetteIcon from '../components/svg/BaguetteIcon.jsx';
import {
  ONBOARDING_STEP,
  clampOnboardingStepId,
  identityIsUsable,
  visibleOnboardingSteps,
} from '../utils/onboardingSteps.js';
import GithubAppStep from './onboarding/GithubAppStep.jsx';
import GithubSignInStep from './onboarding/GithubSignInStep.jsx';
import IdentityStep from './onboarding/IdentityStep.jsx';
import GitCredentialsStep from './onboarding/GitCredentialsStep.jsx';
import AgentsStep from './onboarding/AgentsStep.jsx';
import RepositoriesStep from './onboarding/RepositoriesStep.jsx';

function StepIndicator({ current, total }) {
  return (
    <div className="flex items-center gap-1.5 mb-8">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-1 flex-1 rounded-full transition-colors ${
            i + 1 <= current ? 'bg-brand' : 'bg-control-hover'
          }`}
        />
      ))}
    </div>
  );
}

function StepLabel({ current, total }) {
  return (
    <p className="text-xs text-faint mb-2">
      Step {current} of {total}
    </p>
  );
}

function renderOnboardingStep(stepId, handlers) {
  switch (stepId) {
    case ONBOARDING_STEP.GITHUB_APP:
      return <GithubAppStep onSkip={handlers.goNext} />;
    case ONBOARDING_STEP.GITHUB_SIGNIN:
      return <GithubSignInStep onBack={handlers.goBack} showBack={handlers.showBack} />;
    case ONBOARDING_STEP.IDENTITY:
      return (
        <IdentityStep
          user={handlers.user}
          refreshAuth={handlers.refreshAuth}
          onContinue={handlers.goNext}
          onBack={handlers.goBack}
          showBack={handlers.showBack}
        />
      );
    case ONBOARDING_STEP.GIT_CREDENTIALS:
      return (
        <GitCredentialsStep
          user={handlers.user}
          onPatSaved={handlers.onPatSaved}
          onContinue={handlers.goNext}
          onBack={handlers.goBack}
          showBack={handlers.showBack}
        />
      );
    case ONBOARDING_STEP.REPOSITORIES:
      return (
        <RepositoriesStep
          user={handlers.user}
          githubConfigured={handlers.githubConfigured}
          hasGithubPat={handlers.hasGithubPat}
          onBack={handlers.goBack}
          onContinue={handlers.goNext}
          showBack={handlers.showBack}
        />
      );
    case ONBOARDING_STEP.AGENTS:
      return (
        <AgentsStep
          user={handlers.user}
          githubConfigured={handlers.githubConfigured}
          onBack={handlers.goBack}
          onFinish={handlers.onFinish}
          completing={handlers.completing}
          showBack={handlers.showBack}
        />
      );
    default:
      return null;
  }
}

export default function Onboarding() {
  const { user, github, setUser, refreshAuth } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [hasGithubPat, setHasGithubPat] = useState(false);
  const [completing, setCompleting] = useState(false);
  const didRefresh = useRef(false);

  useEffect(() => {
    if (didRefresh.current) return;
    didRefresh.current = true;
    refreshAuth().catch(() => {});
  }, [refreshAuth]);

  const githubConfigured = Boolean(github?.configured);
  const githubLinked = Boolean(user?.github_linked);
  const isFirstUser = Boolean(user?.is_first_user);
  const steps = useMemo(
    () => visibleOnboardingSteps({ githubConfigured, githubLinked, isFirstUser }),
    [githubConfigured, githubLinked, isFirstUser]
  );
  const currentStepId = clampOnboardingStepId(searchParams.get('step'), steps);
  const stepIndex = steps.indexOf(currentStepId);
  const stepNumber = stepIndex + 1;
  const showBack = stepIndex > 0;

  const setStepId = (id) => {
    setSearchParams(id ? { step: id } : {}, { replace: true });
  };

  const goNext = () => {
    const next = steps[stepIndex + 1];
    if (next) setStepId(next);
  };

  const goBack = () => {
    const prev = steps[stepIndex - 1];
    if (prev) setStepId(prev);
  };

  const handleComplete = async () => {
    if (!identityIsUsable(user, { githubConfigured })) {
      toastError(
        'Finish setup',
        new Error(githubConfigured ? 'Sign in with GitHub first.' : 'Register a passkey first.')
      );
      return;
    }
    setCompleting(true);
    try {
      await usersService.patch(user.id, { onboarding_completed: true });
      setUser((prev) => ({ ...prev, onboarding_completed: true }));
      navigate('/');
    } catch (err) {
      toastError('Failed to complete setup', err);
      setCompleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-page flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-3 mb-10">
          <BaguetteIcon className="w-7 h-7" />
          <span className="text-fg font-semibold font-display">Baguette</span>
        </div>

        <StepIndicator current={stepNumber} total={steps.length} />
        <StepLabel current={stepNumber} total={steps.length} />

        {renderOnboardingStep(currentStepId, {
          user,
          githubConfigured,
          hasGithubPat,
          completing,
          showBack,
          goNext,
          goBack,
          refreshAuth,
          onPatSaved: () => setHasGithubPat(true),
          onFinish: handleComplete,
        })}
      </div>
    </div>
  );
}
