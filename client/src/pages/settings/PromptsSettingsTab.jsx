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
import MarkdownContent from '../../components/MarkdownContent.jsx';

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
  const [sessionSaving, setSessionSaving] = useState(false);
  const [sessionSaved, setSessionSaved] = useState(false);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewSaved, setReviewSaved] = useState(false);

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

  const patchPromptScope = async (fields) => {
    if (!user?.id) return;
    if (!promptsRepoId) {
      const updated = await usersService.patch(user.id, fields);
      onSave(updated);
      return;
    }
    const r = repoById(promptsRepoId);
    if (!r?.user_repo_id) throw new Error('Repository not linked');
    await userReposService.patch(r.user_repo_id, fields);
    await refetchRepos();
  };

  const handleSaveSessionPrompt = async () => {
    setSessionSaving(true);
    setSessionSaved(false);
    try {
      await patchPromptScope({ agent_prompt: agentPrompt });
      flashSaved(setSessionSaved);
    } catch (err) {
      toastError('Failed to save session instructions', err);
    } finally {
      setSessionSaving(false);
    }
  };

  const handleSaveReviewPrompt = async () => {
    setReviewSaving(true);
    setReviewSaved(false);
    try {
      await patchPromptScope({ review_prompt: reviewPrompt });
      flashSaved(setReviewSaved);
    } catch (err) {
      toastError('Failed to save review instructions', err);
    } finally {
      setReviewSaving(false);
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
              <div className="w-full bg-page border border-line rounded-lg px-3 py-2 min-h-[28rem] max-h-[50vh] overflow-auto cursor-default">
                {fullSessionPrompt ? (
                  <MarkdownContent>{fullSessionPrompt}</MarkdownContent>
                ) : (
                  <p className="text-xs text-faint">Loading…</p>
                )}
              </div>
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
            <SettingsSaveRow
              saving={sessionSaving}
              saved={sessionSaved}
              onSave={handleSaveSessionPrompt}
            />
          </SettingsSection>
        </div>

        <div ref={reviewCardRef} id="settings-prompt-review" className="scroll-mt-6">
          <SettingsSection title="Review">
            <div>
              <label className="block text-sm font-medium text-heading mb-1">
                Built-in review prompt
              </label>
              <div className="w-full bg-page border border-line rounded-lg px-3 py-2 min-h-[28rem] max-h-[50vh] overflow-auto cursor-default">
                {fullReviewPrompt ? (
                  <MarkdownContent>{fullReviewPrompt}</MarkdownContent>
                ) : (
                  <p className="text-xs text-faint">Loading…</p>
                )}
              </div>
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
            <SettingsSaveRow
              saving={reviewSaving}
              saved={reviewSaved}
              onSave={handleSaveReviewPrompt}
            />
          </SettingsSection>
        </div>
      </div>
    </div>
  );
}
