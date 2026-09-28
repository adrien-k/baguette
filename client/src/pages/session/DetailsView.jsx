import { useEffect, useState } from 'react';
import { isGlobalSession } from '@baguette/shared/session-scope.js';
import { sessionsService } from '../../feathers.js';
import { toastError } from '../../utils/toastError.jsx';
import MarkdownContent from '../../components/MarkdownContent.jsx';
import { CHAT_COLUMN_CLASS } from '../../components/ChatMessagesViewport.jsx';

const fieldClass =
  'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 disabled:opacity-60 disabled:cursor-not-allowed';

const readOnlyClass =
  'w-full rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-3 text-sm text-zinc-300 whitespace-pre-wrap break-words';

function Section({ title, description, children }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-zinc-200">{title}</h2>
        {description ? <p className="text-xs text-zinc-500 mt-1">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

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
    <div className="flex-1 min-h-0 overflow-auto bg-zinc-950">
      <div className={`${CHAT_COLUMN_CLASS} py-4 sm:py-6 space-y-6`}>
        <Section
          title="Session title"
          description="Shown in the header and session list. Does not change the GitHub pull request title unless you update the PR separately."
        >
          <input
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
            className={fieldClass}
          />
          {!readonly && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleSaveTitle}
                disabled={saving || !titleDirty}
                className="bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 text-zinc-950 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              {saved && <span className="text-sm text-emerald-400">Saved</span>}
            </div>
          )}
        </Section>

        <Section
          title="Initial prompt"
          description="The message used when this session was created."
        >
          {initialPrompt ? (
            <div className={readOnlyClass}>{initialPrompt}</div>
          ) : (
            <p className="text-sm text-zinc-500">No initial prompt recorded.</p>
          )}
        </Section>

        <Section
          title="PR description"
          description="Draft stored on this session (updated when the agent runs PrUpsert). May differ from GitHub until the PR is pushed."
        >
          {prDescription ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-3">
              <MarkdownContent>{prDescription}</MarkdownContent>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">No PR description yet.</p>
          )}
          {session?.pr_url && (
            <p className="text-xs text-zinc-500">
              Pull request:{' '}
              <a
                href={session.pr_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-400 hover:text-amber-300 underline"
              >
                {session.pr_url.replace(/^https?:\/\//, '')}
              </a>
            </p>
          )}
        </Section>
      </div>
    </div>
  );
}
