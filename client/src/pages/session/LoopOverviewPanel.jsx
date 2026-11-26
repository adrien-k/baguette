import { Loader2, Play } from 'lucide-react';
import { isSessionOwner } from '@baguette/shared/session-sharing.js';
import CollapsibleMarkdown from '../../components/chat/CollapsibleMarkdown.tsx';
import CardRepoBadge from '../../components/CardRepoBadge.jsx';
import LoopLastError from '../../components/LoopLastError.jsx';
import SessionCard from '../../components/SessionCard.jsx';
import SessionModelSelect from '../../components/SessionModelSelect.jsx';
import { useCurrentUser } from '../../context/CurrentUserContext.jsx';
import { useAgentConfigs } from '../../hooks/useAgentConfigs.js';
import { useAgentConfigModels } from '../../hooks/useAgentConfigModels.js';
import { useCursorModelPrefs } from '../../hooks/useAgentPreferences.js';
import { SECONDARY_BUTTON_CLASS } from '../../utils/buttonStyles.js';
import {
  describeSchedule,
  formatLoopRunSubtitle,
  loopDisplayTitle,
} from '../../utils/loopSchedule.js';
import { TEXT_FAINT, TEXT_SECONDARY } from '../../utils/ui.js';

function LoopOverviewModelRow({ loop }) {
  const { configOptions, loading: configsLoading } = useAgentConfigs();
  const { cursorModelPrefs } = useCursorModelPrefs();
  const configId = loop.agent_config_id;
  const hasConfigId = configId != null && configId !== '';
  const { models, stale: modelsStale } = useAgentConfigModels(configId, {
    enabled: hasConfigId,
  });

  const agentConfigKey = hasConfigId ? String(configId) : loop.agent_sdk || '';

  if (!agentConfigKey) {
    return <span className={TEXT_SECONDARY}>—</span>;
  }

  return (
    <SessionModelSelect
      agentConfigKey={agentConfigKey}
      model={loop.model || null}
      params={loop.model_params}
      models={models}
      cursorModelPrefs={cursorModelPrefs}
      agentConfigOptions={configOptions}
      configsLoading={configsLoading}
      modelsLoading={modelsStale && !models.length}
      className="min-w-0"
    />
  );
}

export default function LoopOverviewPanel({
  loop,
  showRepoDetails,
  runSessions,
  runsLoading,
  runsLoaded,
  suppressRepoBadge,
  onRunLoop,
  runningLoop = false,
}) {
  const { currentUser } = useCurrentUser();
  const showRunNow = isSessionOwner(loop, currentUser);
  const title = loopDisplayTitle(loop);
  const schedule = describeSchedule(loop);
  const runMeta = formatLoopRunSubtitle(loop);
  const promptMarkdown = loop.prompt?.trim() ?? '';

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:py-8">
      <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          {showRunNow && onRunLoop ? (
            <button
              type="button"
              disabled={!loop.enabled || runningLoop}
              onClick={onRunLoop}
              className={SECONDARY_BUTTON_CLASS}
              title={loop.enabled ? 'Run this loop now' : 'Enable the loop to run it manually'}
            >
              {runningLoop ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
              ) : (
                <Play className="w-3.5 h-3.5" aria-hidden />
              )}
              Run now
            </button>
          ) : null}
        </div>

        {(showRepoDetails || (!loop.is_global && loop.base_branch)) && (
          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            {showRepoDetails && (
              <div className={!loop.is_global && loop.base_branch ? undefined : 'sm:col-span-2'}>
                <dt className={`mb-1 font-medium ${TEXT_FAINT}`}>
                  {loop.is_global ? 'Scope' : 'Repository'}
                </dt>
                <dd>
                  <CardRepoBadge
                    show
                    isGlobal={!!loop.is_global}
                    repoFullName={loop.repo_full_name}
                  />
                </dd>
              </div>
            )}
            {!loop.is_global && loop.base_branch ? (
              <div>
                <dt className={`font-medium ${TEXT_FAINT}`}>Branch</dt>
                <dd className={TEXT_SECONDARY}>{loop.base_branch}</dd>
              </div>
            ) : null}
          </dl>
        )}

        <div>
          <p className={`mb-1 text-xs font-medium ${TEXT_FAINT}`}>Prompt</p>
          <div
            className={`rounded-md border border-line bg-page p-3 text-sm min-w-0 ${TEXT_SECONDARY}`}
          >
            {promptMarkdown ? (
              <CollapsibleMarkdown
                key={loop.id != null ? `loop-prompt-${loop.id}` : 'loop-prompt'}
                previewLines={12}
                simpleToggle
                hardBreaks
              >
                {promptMarkdown}
              </CollapsibleMarkdown>
            ) : (
              <p className="text-faint">No prompt</p>
            )}
          </div>
          <p className={`mb-1 mt-3 text-xs font-medium ${TEXT_FAINT}`}>Agent</p>
          <div className="min-w-0">
            <LoopOverviewModelRow loop={loop} />
          </div>
        </div>

        <dl className="grid gap-2 text-xs sm:grid-cols-2">
          <div>
            <dt className={`font-medium ${TEXT_FAINT}`}>Shared</dt>
            <dd className={TEXT_SECONDARY}>{loop.is_shared ? 'On' : 'Off'}</dd>
          </div>
          <div>
            <dt className={`font-medium ${TEXT_FAINT}`}>Enabled</dt>
            <dd>
              <span
                className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium border ${
                  loop.enabled
                    ? 'border-brand/30 bg-brand/10 text-accent'
                    : 'border-strong text-fg-muted'
                }`}
              >
                {loop.enabled ? 'On' : 'Off'}
              </span>
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className={`font-medium ${TEXT_FAINT}`}>Recurrence</dt>
            <dd className={TEXT_SECONDARY}>{schedule || '—'}</dd>
          </div>
          <div>
            <dt className={`font-medium ${TEXT_FAINT}`}>Single session</dt>
            <dd className={TEXT_SECONDARY}>{loop.single_session ? 'On' : 'Off'}</dd>
          </div>
          {!loop.is_global ? (
            <div>
              <dt className={`font-medium ${TEXT_FAINT}`}>Create new branch</dt>
              <dd className={TEXT_SECONDARY}>{loop.create_new_branch ? 'On' : 'Off'}</dd>
            </div>
          ) : null}
          {runMeta ? (
            <div className="sm:col-span-2">
              <dt className={`font-medium ${TEXT_FAINT}`}>Runs</dt>
              <dd className={TEXT_SECONDARY}>{runMeta}</dd>
            </div>
          ) : null}
        </dl>
        {loop.last_error && <LoopLastError message={loop.last_error} />}
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-faint">Past sessions</h3>
        {runsLoading && !runsLoaded && (
          <p className={`py-8 text-center text-xs ${TEXT_FAINT}`}>Loading sessions…</p>
        )}
        {runsLoaded && !runSessions.length && (
          <p className={`py-8 text-center text-xs ${TEXT_FAINT}`}>No runs yet.</p>
        )}
        {runSessions.map((s) => (
          <SessionCard key={s.id} session={s} suppressRepoBadge={suppressRepoBadge} />
        ))}
      </section>
    </div>
  );
}
