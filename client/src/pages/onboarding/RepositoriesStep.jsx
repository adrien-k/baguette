import { useState } from 'react';
import { reposService } from '../../feathers.js';
import { useRepoContext } from '../../context/RepoContext.jsx';
import { toastError } from '../../utils/toastError.jsx';
import RepoSearchInput from '../../components/RepoSearchInput.jsx';
import { GHOST_BUTTON_CLASS, PRIMARY_BUTTON_SIZED } from '../../utils/buttonStyles.js';
import { showGithubRepoPicker } from '../../utils/onboardingSteps.js';

export default function RepositoriesStep({
  user,
  githubConfigured,
  hasGithubPat,
  onBack,
  onContinue,
  showBack,
}) {
  const { repos, refetch: refetchRepos } = useRepoContext();
  const [selectedRepo, setSelectedRepo] = useState('');
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState(null);

  const githubPicker = showGithubRepoPicker({
    githubConfigured,
    githubLinked: Boolean(user?.github_linked),
    hasGithubPat,
  });
  const addedNames = new Set(repos.map((r) => r.full_name));

  const handleAddGithub = async (event) => {
    event.preventDefault();
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

  return (
    <div>
      <h1 className="text-2xl font-bold text-fg mb-2">Add GitHub repositories</h1>
      <p className="text-fg-muted text-sm mb-6">
        Link GitHub repositories to start coding sessions. You can skip and add repos later in
        Settings.
      </p>

      <div className="space-y-6">
        {githubPicker ? (
          <form onSubmit={handleAddGithub} className="space-y-4">
            <RepoSearchInput
              value={selectedRepo}
              onSelect={setSelectedRepo}
              addedNames={addedNames}
            />
            <button
              type="submit"
              className={`${PRIMARY_BUTTON_SIZED} w-full`}
              disabled={adding || !selectedRepo}
            >
              {adding ? 'Adding…' : 'Add repository'}
            </button>
          </form>
        ) : (
          <p className="text-xs text-faint">
            Sign in with GitHub or save a personal access token on the previous step to list GitHub
            repositories.
          </p>
        )}
      </div>

      {addResult ? (
        <p className="mt-3 text-sm text-success">Added {addResult.full_name ?? 'repository'}.</p>
      ) : null}
      {repos.length > 0 ? (
        <p className="mt-4 text-xs text-faint">{repos.length} repositories linked.</p>
      ) : null}

      <div className={`mt-8 flex gap-2 ${showBack ? 'justify-between' : 'justify-end'}`}>
        {showBack ? (
          <button type="button" className={GHOST_BUTTON_CLASS} onClick={onBack}>
            Back
          </button>
        ) : null}
        <button type="button" className={PRIMARY_BUTTON_SIZED} onClick={onContinue}>
          Continue
        </button>
      </div>
    </div>
  );
}
