import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { usersService, reposService } from '../feathers.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { useRepoContext } from '../context/RepoContext.jsx';
import { toastError } from '../utils/toastError.jsx';
import MaskedSecretInput from '../components/MaskedSecretInput.jsx';
import ClaudeAuthFields from '../components/ClaudeAuthFields.jsx';
import RepoSearchInput from '../components/RepoSearchInput.jsx';
import BaguetteIcon from '../components/svg/BaguetteIcon.jsx';

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

/**
 * Collapsible section header for onboarding step 1: a toggle link with a rotating
 * chevron and an unsaved-changes dot when the section contains dirty fields.
 */
function AgentSectionToggle({ label, open, onToggle, hasChanges = false }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="group flex w-full items-center gap-1.5 text-left transition-colors"
    >
      <ChevronDown
        className={`w-4 h-4 text-faint transition-transform ${open ? '' : '-rotate-90'}`}
      />
      <span
        className={`text-sm font-medium transition-colors ${
          open ? 'text-heading' : 'text-secondary group-hover:text-heading'
        }`}
      >
        {label}
      </span>
      {hasChanges && !open ? (
        <span
          className="w-1.5 h-1.5 rounded-full bg-brand shrink-0"
          title="Unsaved changes in this section"
        />
      ) : null}
    </button>
  );
}

export default function Onboarding() {
  const { user, setUser } = useAuth();
  const { repos, refetch: refetchRepos } = useRepoContext();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  // Step 1: API keys — Claude fields (patch + dirty state) come from ClaudeAuthFields.
  // Sections stay mounted when collapsed so typed values are not lost.
  const [claudeOpen, setClaudeOpen] = useState(false);
  const [cursorOpen, setCursorOpen] = useState(false);
  const [claudeChange, setClaudeChange] = useState({ patch: {}, hasChanges: false });
  const [cursorApiKey, setCursorApiKey] = useState(null);
  const [cursorApiKeyDirty, setCursorApiKeyDirty] = useState(false);
  const [savingKeys, setSavingKeys] = useState(false);

  // Step 2: Repositories
  const [selectedRepo, setSelectedRepo] = useState('');
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState(null);
  const [completing, setCompleting] = useState(false);

  const handleSaveKeys = async (skip = false) => {
    if (!skip && (claudeChange.hasChanges || cursorApiKeyDirty)) {
      setSavingKeys(true);
      try {
        const patch = { ...claudeChange.patch };
        if (cursorApiKeyDirty) patch.cursor_api_key = cursorApiKey ?? '';
        await usersService.patch(user.id, patch);
      } catch (err) {
        toastError('Failed to save API keys', err);
        setSavingKeys(false);
        return;
      }
      setSavingKeys(false);
    }
    setStep(2);
  };

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
              Expand a provider below to configure it. You can update these any time in Settings →
              Agent.
            </p>

            <div className="space-y-5">
              <div>
                <AgentSectionToggle
                  label="Configure Claude Code"
                  open={claudeOpen}
                  onToggle={() => setClaudeOpen((v) => !v)}
                  hasChanges={claudeChange.hasChanges}
                />
                <div className={claudeOpen ? 'mt-4' : 'hidden'}>
                  <ClaudeAuthFields
                    onChange={(patch, hasChanges) => setClaudeChange({ patch, hasChanges })}
                  />
                </div>
              </div>

              <div>
                <AgentSectionToggle
                  label="Configure Cursor"
                  open={cursorOpen}
                  onToggle={() => setCursorOpen((v) => !v)}
                  hasChanges={cursorApiKeyDirty}
                />
                <div className={cursorOpen ? 'mt-4' : 'hidden'}>
                  <MaskedSecretInput
                    maskedValue={null}
                    placeholder="cursor-…"
                    onChange={(val, dirty) => {
                      setCursorApiKey(val);
                      setCursorApiKeyDirty(dirty);
                    }}
                  />
                  <p className="mt-1.5 text-xs text-faint">Required to use the Cursor agent SDK.</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-8">
              <button
                onClick={() => handleSaveKeys(false)}
                disabled={savingKeys}
                className="bg-brand hover:bg-brand-hover disabled:bg-disabled text-on-brand px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
              >
                {savingKeys ? 'Saving…' : 'Continue'}
              </button>
              <button
                onClick={() => handleSaveKeys(true)}
                disabled={savingKeys}
                className="text-sm text-faint hover:text-secondary px-2 py-2.5 transition-colors"
              >
                Skip for now
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <StepLabel current={2} />
            <h1 className="text-2xl font-bold text-fg mb-2">Add repositories</h1>
            <p className="text-fg-muted text-sm mb-8">
              Connect GitHub repositories to use as session targets. You can add more later in
              Settings.
            </p>

            <form onSubmit={handleAddRepo}>
              <RepoSearchInput
                value={selectedRepo}
                onSelect={setSelectedRepo}
                addedNames={new Set(repos.map((r) => r.full_name))}
                trailing={
                  <button
                    type="submit"
                    disabled={adding || !selectedRepo}
                    className="inline-flex items-center justify-center bg-brand hover:bg-brand-hover disabled:bg-disabled text-on-brand px-4 py-2.5 rounded-lg text-sm font-medium transition-colors shrink-0"
                  >
                    {adding ? 'Adding…' : 'Add'}
                  </button>
                }
              />
            </form>

            {addResult && !addResult.hasBaguetteConfig && (
              <div className="mt-4 bg-soft-accent/20 border border-warning rounded-xl px-4 py-3">
                <p className="text-sm text-warning">
                  <strong>{addResult.repo.full_name}</strong> doesn&apos;t have a Baguette
                  configuration yet. Start a session on this repo and the agent will offer to set it
                  up.
                </p>
              </div>
            )}

            {repos.length > 0 && (
              <div className="mt-4 bg-nav border border-line rounded-xl overflow-hidden">
                {repos.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center px-4 py-3 border-b border-line last:border-0"
                  >
                    <code className="text-sm text-fg font-medium">{r.full_name}</code>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-3 mt-8">
              <button
                onClick={handleComplete}
                disabled={completing}
                className="bg-brand hover:bg-brand-hover disabled:bg-disabled text-on-brand px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
              >
                {completing ? 'Setting up…' : 'Get started'}
              </button>
              {repos.length === 0 && (
                <button
                  onClick={handleComplete}
                  disabled={completing}
                  className="text-sm text-faint hover:text-secondary px-2 py-2.5 transition-colors"
                >
                  Skip for now
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
