import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { toastError } from '../../utils/toastError.jsx';
import { apiFetch } from '../../api.js';
import { usersService, userReposService } from '../../feathers.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useRepoContext } from '../../context/RepoContext.jsx';
import {
  SettingsSection,
  SettingsTabHeader,
  SettingsSaveRow,
} from '../../components/SettingsSection.jsx';
import { RepoScopeAside } from './repoScopeDropdown.jsx';
import { INPUT_CLASS } from '../../utils/ui.js';

export default function PromptsSettingsTab({ settings, onSave }) {
  const { user } = useAuth();
  const { repos, refetch: refetchRepos } = useRepoContext();
  const { hash } = useLocation();
  const sessionCardRef = useRef(null);
  const reviewCardRef = useRef(null);

  const [promptsRepoId, setPromptsRepoId] = useState('');
  const [agentPrompt, setAgentPrompt] = useState('');
  const [reviewPrompt, setReviewPrompt] = useState('');
  const [fullSessionPrompt, setFullSessionPrompt] = useState('');
  const [fullReviewPrompt, setFullReviewPrompt] = useState('');
  const [promptsSaving, setPromptsSaving] = useState(false);
  const [promptsSaved, setPromptsSaved] = useState(false);

  const repoById = useCallback((id) => repos.find((r) => String(r.id) === String(id)), [repos]);

  const loadPromptFields = useCallback(() => {
    if (!settings) return;
    if (!promptsRepoId) {
      setAgentPrompt(settings.agent_prompt ?? '');
      setReviewPrompt(settings.review_prompt ?? '');
      return;
    }
    const r = repoById(promptsRepoId);
    setAgentPrompt(r?.agent_prompt ?? '');
    setReviewPrompt(r?.review_prompt ?? '');
  }, [settings, promptsRepoId, repoById]);

  useEffect(() => {
    loadPromptFields();
  }, [loadPromptFields]);

  useEffect(() => {
    if (!settings) return;
    const scrollReview = hash === '#settings-prompt-review';
    const scrollSession = hash === '#settings-prompt-session';
    if (!scrollReview && !scrollSession) return;
    const target = scrollReview ? reviewCardRef : sessionCardRef;
    const timer = window.setTimeout(() => {
      target.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [hash, settings]);

  useEffect(() => {
    apiFetch('/api/settings/prompt-templates')
      .then((d) => {
        setFullSessionPrompt(d.session || '');
        setFullReviewPrompt(d.review || '');
      })
      .catch(() => {});
  }, []);

  const flashSaved = (setSaved) => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSavePrompts = async () => {
    if (!user?.id) return;
    setPromptsSaving(true);
    setPromptsSaved(false);
    try {
      if (!promptsRepoId) {
        const updated = await usersService.patch(user.id, {
          agent_prompt: agentPrompt,
          review_prompt: reviewPrompt,
        });
        onSave(updated);
      } else {
        const r = repoById(promptsRepoId);
        if (!r?.user_repo_id) throw new Error('Repository not linked');
        await userReposService.patch(r.user_repo_id, {
          agent_prompt: agentPrompt,
          review_prompt: reviewPrompt,
        });
        await refetchRepos();
      }
      flashSaved(setPromptsSaved);
    } catch (err) {
      toastError('Failed to save prompts', err);
    } finally {
      setPromptsSaving(false);
    }
  };

  const sessionExtraLabel = promptsRepoId
    ? 'Repository session instructions'
    : 'Additional session instructions';
  const reviewExtraLabel = promptsRepoId
    ? 'Repository review instructions'
    : 'Additional review instructions';

  const scopedRepoName = promptsRepoId ? repoById(promptsRepoId)?.full_name : null;
  const sessionPlaceholder = scopedRepoName
    ? `Special instructions for ${scopedRepoName}…`
    : 'Special instructions for all your repos…';
  const reviewPlaceholder = scopedRepoName
    ? `Special review instructions for ${scopedRepoName}…`
    : 'Special review instructions for all your repos…';

  return (
    <div>
      <SettingsTabHeader title="Prompts">
        Extend built-in system prompts for session agents and code review. Scope defaults to all
        your repositories or a single linked repo.
      </SettingsTabHeader>

      <div className="flex justify-end mb-4">
        <RepoScopeAside
          id="prompts-repo-scope"
          value={promptsRepoId}
          onChange={setPromptsRepoId}
          repos={repos}
        />
      </div>

      <div className="space-y-4">
        <div ref={sessionCardRef} id="settings-prompt-session" className="scroll-mt-6">
          <SettingsSection title="Session agent">
            <div>
              <label className="block text-sm font-medium text-heading mb-1">
                Built-in session prompt
              </label>
              <textarea
                value={fullSessionPrompt}
                readOnly
                rows={20}
                className="w-full bg-page border border-line rounded-lg px-3 py-2 text-xs text-faint font-mono min-h-[28rem] cursor-default resize-y"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-heading mb-1">
                {sessionExtraLabel}
              </label>
              <textarea
                value={agentPrompt}
                onChange={(e) => setAgentPrompt(e.target.value)}
                rows={8}
                className={`${INPUT_CLASS} font-mono min-h-32`}
                placeholder={sessionPlaceholder}
              />
            </div>
          </SettingsSection>
        </div>

        <div ref={reviewCardRef} id="settings-prompt-review" className="scroll-mt-6">
          <SettingsSection title="Review">
            <div>
              <label className="block text-sm font-medium text-heading mb-1">
                Built-in review prompt
              </label>
              <textarea
                value={fullReviewPrompt}
                readOnly
                rows={20}
                className="w-full bg-page border border-line rounded-lg px-3 py-2 text-xs text-faint font-mono min-h-[28rem] cursor-default resize-y"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-heading mb-1">
                {reviewExtraLabel}
              </label>
              <textarea
                value={reviewPrompt}
                onChange={(e) => setReviewPrompt(e.target.value)}
                rows={8}
                className={`${INPUT_CLASS} font-mono min-h-32`}
                placeholder={reviewPlaceholder}
              />
            </div>
          </SettingsSection>
        </div>

        <SettingsSaveRow saving={promptsSaving} saved={promptsSaved} onSave={handleSavePrompts} />
      </div>
    </div>
  );
}
