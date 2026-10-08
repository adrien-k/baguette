import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usersService, reposService } from '../feathers.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { useRepoContext } from '../context/RepoContext.jsx';
import { toastError } from '../utils/toastError.jsx';
import AgentConfigsList from './settings/AgentConfigsList.jsx';
import RepoSearchInput from '../components/RepoSearchInput.jsx';
import BaguetteIcon from '../components/svg/BaguetteIcon.jsx';
import { GHOST_BUTTON_CLASS, PRIMARY_BUTTON_SIZED } from '../utils/buttonStyles.js';

const TOTAL_STEPS = 2;

function StepIndicator({ current }) {
  return (
    <div className="flex items-center gap-1.5 mb-8">
      {Array.from({ length: TOTAL_STEPS }, (_, i) => (
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

function StepLabel({ current }) {
  return (
    <p className="text-xs text-faint mb-2">
      Step {current} of {TOTAL_STEPS}
    </p>
  );
}

export default function Onboarding() {
  const { user, setUser } = useAuth();
  const { repos, refetch: refetchRepos } = useRepoContext();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  const [selectedRepo, setSelectedRepo] = useState('');
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState(null);
  const [completing, setCompleting] = useState(false);

  const handleAddRepo = async (e) => {
    e.preventDefault();
    if (!selectedRepo) return;
    setAdding(true);
    setAddResult(null);
    try {
      const result = await reposService.create({ fullName: selectedRepo });
      setSelectedRepo('');
      setAddResult(result);
      await refetchRepos();
    } catch (err) {
      toastError('Failed to add repository', err);
    } finally {
      setAdding(false);
    }
  };

  const handleComplete = async () => {
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

        <StepIndicator current={step} />

        {step === 1 && (
          <div>
            <StepLabel current={1} />
            <h1 className="text-2xl font-bold text-fg mb-2">Connect your agents</h1>
            <p className="text-fg-muted text-sm mb-8">
              Add at least one Claude, Cursor, or Pi configuration. You can edit these any time in
              Settings → Agent.
            </p>
            <AgentConfigsList />
            <div className="mt-8 flex justify-end">
              <button type="button" className={PRIMARY_BUTTON_SIZED} onClick={() => setStep(2)}>
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <StepLabel current={2} />
            <h1 className="text-2xl font-bold text-fg mb-2">Add a repository</h1>
            <p className="text-fg-muted text-sm mb-6">
              Link a GitHub repository to start coding sessions. You can skip and add repos later in
              Settings.
            </p>
            <form onSubmit={handleAddRepo} className="space-y-4">
              <RepoSearchInput value={selectedRepo} onChange={setSelectedRepo} />
              <button
                type="submit"
                className={`${PRIMARY_BUTTON_SIZED} w-full`}
                disabled={adding || !selectedRepo}
              >
                {adding ? 'Adding…' : 'Add repository'}
              </button>
            </form>
            {addResult ? (
              <p className="mt-3 text-sm text-success">
                Added {addResult.full_name ?? 'repository'}.
              </p>
            ) : null}
            {repos.length > 0 ? (
              <p className="mt-4 text-xs text-faint">{repos.length} repositories linked.</p>
            ) : null}
            <div className="mt-8 flex justify-between gap-2">
              <button type="button" className={GHOST_BUTTON_CLASS} onClick={() => setStep(1)}>
                Back
              </button>
              <button
                type="button"
                className={PRIMARY_BUTTON_SIZED}
                onClick={handleComplete}
                disabled={completing}
              >
                {completing ? 'Finishing…' : 'Finish setup'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
