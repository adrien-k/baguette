import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usersService, reposService } from '../feathers.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { useRepoContext } from '../context/RepoContext.jsx';
import { toastError } from '../utils/toastError.jsx';
import MaskedSecretInput from '../components/MaskedSecretInput.jsx';
import RepoSearchInput from '../components/RepoSearchInput.jsx';

const TOTAL_STEPS = 2;

function StepIndicator({ current }) {
  return (
    <div className="flex items-center gap-1.5 mb-8">
      {Array.from({ length: TOTAL_STEPS }, (_, i) => (
        <div
          key={i}
          className={`h-1 flex-1 rounded-full transition-colors ${
            i + 1 <= current ? 'bg-amber-500' : 'bg-zinc-800'
          }`}
        />
      ))}
    </div>
  );
}

function StepLabel({ current }) {
  return (
    <p className="text-xs text-zinc-600 mb-2">
      Step {current} of {TOTAL_STEPS}
    </p>
  );
}

export default function Onboarding() {
  const { user, setUser } = useAuth();
  const { repos, refetch: refetchRepos } = useRepoContext();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  // Step 1: API keys
  const [anthropicApiKey, setAnthropicApiKey] = useState(null);
  const [anthropicApiKeyDirty, setAnthropicApiKeyDirty] = useState(false);
  const [cursorApiKey, setCursorApiKey] = useState(null);
  const [cursorApiKeyDirty, setCursorApiKeyDirty] = useState(false);
  const [savingKeys, setSavingKeys] = useState(false);

  // Step 2: Repositories
  const [selectedRepo, setSelectedRepo] = useState('');
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState(null);
  const [completing, setCompleting] = useState(false);

  const handleSaveKeys = async (skip = false) => {
    if (!skip && (anthropicApiKeyDirty || cursorApiKeyDirty)) {
      setSavingKeys(true);
      try {
        const patch = {};
        if (anthropicApiKeyDirty) patch.anthropic_api_key = anthropicApiKey ?? '';
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
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-3 mb-10">
          <img src="/baguette.svg" alt="" className="w-7 h-7" />
          <span className="text-white font-semibold font-display">Baguette</span>
        </div>

        <StepIndicator current={step} />

        {step === 1 && (
          <div>
            <StepLabel current={1} />
            <h1 className="text-2xl font-bold text-white mb-2">Set up your API keys</h1>
            <p className="text-zinc-400 text-sm mb-8">
              Add your AI provider keys to get started. You can update these any time in Settings.
            </p>

            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                  Claude API Key
                </label>
                <MaskedSecretInput
                  maskedValue={null}
                  placeholder="sk-ant-…"
                  onChange={(val, dirty) => {
                    setAnthropicApiKey(val);
                    setAnthropicApiKeyDirty(dirty);
                  }}
                />
                <p className="mt-1.5 text-xs text-zinc-500">
                  Optional — leave empty to use Claude Code&apos;s default configuration.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                  Cursor API Key
                </label>
                <MaskedSecretInput
                  maskedValue={null}
                  placeholder="cursor-…"
                  onChange={(val, dirty) => {
                    setCursorApiKey(val);
                    setCursorApiKeyDirty(dirty);
                  }}
                />
                <p className="mt-1.5 text-xs text-zinc-500">Required to use the Cursor agent SDK.</p>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-8">
              <button
                onClick={() => handleSaveKeys(false)}
                disabled={savingKeys}
                className="bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 text-zinc-950 px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
              >
                {savingKeys ? 'Saving…' : 'Continue'}
              </button>
              <button
                onClick={() => handleSaveKeys(true)}
                disabled={savingKeys}
                className="text-sm text-zinc-500 hover:text-zinc-300 px-2 py-2.5 transition-colors"
              >
                Skip for now
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <StepLabel current={2} />
            <h1 className="text-2xl font-bold text-white mb-2">Add repositories</h1>
            <p className="text-zinc-400 text-sm mb-8">
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
                    className="inline-flex items-center justify-center bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 text-zinc-950 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors shrink-0"
                  >
                    {adding ? 'Adding…' : 'Add'}
                  </button>
                }
              />
            </form>

            {addResult && !addResult.hasBaguetteConfig && (
              <div className="mt-4 bg-amber-900/20 border border-amber-700 rounded-xl px-4 py-3">
                <p className="text-sm text-amber-200">
                  <strong>{addResult.repo.full_name}</strong> doesn&apos;t have a Baguette
                  configuration yet. Start a session on this repo and the agent will offer to set it
                  up.
                </p>
              </div>
            )}

            {repos.length > 0 && (
              <div className="mt-4 bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                {repos.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center px-4 py-3 border-b border-zinc-800 last:border-0"
                  >
                    <code className="text-sm text-white font-medium">{r.full_name}</code>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-3 mt-8">
              <button
                onClick={handleComplete}
                disabled={completing}
                className="bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 text-zinc-950 px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
              >
                {completing ? 'Setting up…' : 'Get started'}
              </button>
              {repos.length === 0 && (
                <button
                  onClick={handleComplete}
                  disabled={completing}
                  className="text-sm text-zinc-500 hover:text-zinc-300 px-2 py-2.5 transition-colors"
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
