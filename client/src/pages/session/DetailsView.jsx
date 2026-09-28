import { useEffect, useState } from 'react';
import { isGlobalSession } from '@baguette/shared/session-scope.js';
import { sessionsService } from '../../feathers.js';
import { toastError } from '../../utils/toastError.jsx';
import MarkdownContent from '../../components/MarkdownContent.jsx';
import TextInput from '../../components/TextInput.jsx';
import { SettingsSection, SettingsSaveRow } from '../../components/SettingsSection.jsx';
import { CHAT_COLUMN_CLASS } from '../../components/ChatMessagesViewport.jsx';

const readOnlyClass =
  'w-full rounded-lg border border-line bg-page/60 px-3 py-3 text-sm text-secondary whitespace-pre-wrap break-words';

export default function DetailsView({ session, readonly, onSessionUpdate }) {
  const defaultTitle =
    session?.label || (isGlobalSession(session) ? 'Global session' : session?.repo_full_name) || '';
  const [title, setTitle] = useState(session?.label ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setTitle(session?.label ?? '');
  }, [session?.id, session?.label]);

  const titleDirty = title.trim() !== (session?.label ?? '').trim();

  const handleSaveTitle = async () => {
    if (!session?.id || readonly || !titleDirty) return;
    setSaving(true);
    setSaved(false);
    try {
      const updated = await sessionsService.patch(session.id, {
        label: title.trim() || null,
      });
      onSessionUpdate?.(updated);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      toastError('Failed to update session title', err);
    } finally {
      setSaving(false);
    }
  };

  const initialPrompt = session?.initial_prompt?.trim();
  const prDescription = session?.pr_description?.trim();

  return (
    <div className="flex-1 min-h-0 overflow-auto bg-page">
      <div className={`${CHAT_COLUMN_CLASS} py-4 sm:py-6 space-y-6`}>
        <SettingsSection
          title="Session title"
          description="Shown in the header and session list. Does not change the GitHub pull request title unless you update the PR separately."
        >
          <TextInput
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSaveTitle();
              }
            }}
            disabled={readonly || saving}
            placeholder={defaultTitle}
          />
          {!readonly && (
            <SettingsSaveRow
              saving={saving}
              saved={saved}
              onSave={handleSaveTitle}
              disabled={!titleDirty}
            />
          )}
        </SettingsSection>

        <SettingsSection
          title="Initial prompt"
          description="The message used when this session was created."
        >
          {initialPrompt ? (
            <div className={readOnlyClass}>{initialPrompt}</div>
          ) : (
            <p className="text-sm text-faint">No initial prompt recorded.</p>
          )}
        </SettingsSection>

        <SettingsSection
          title="PR description"
          description="Draft stored on this session (updated when the agent runs PrUpsert). May differ from GitHub until the PR is pushed."
        >
          {prDescription ? (
            <div className="rounded-lg border border-line bg-page/60 px-3 py-3">
              <MarkdownContent>{prDescription}</MarkdownContent>
            </div>
          ) : (
            <p className="text-sm text-faint">No PR description yet.</p>
          )}
          {session?.pr_url && (
            <p className="text-xs text-faint">
              Pull request:{' '}
              <a
                href={session.pr_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:text-accent underline"
              >
                {session.pr_url.replace(/^https?:\/\//, '')}
              </a>
            </p>
          )}
        </SettingsSection>
      </div>
    </div>
  );
}
