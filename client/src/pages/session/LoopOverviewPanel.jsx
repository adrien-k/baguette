import { Loader2, Play } from 'lucide-react';
import { formatAgentSdkDisplayName } from '@baguette/shared/agent-sdk-display.js';
import { isSessionOwner } from '@baguette/shared/session-sharing.js';
import AgentConfigLogo from '../../components/AgentConfigLogo.jsx';
import CardRepoBadge from '../../components/CardRepoBadge.jsx';
import LoopLastError from '../../components/LoopLastError.jsx';
import SessionCard from '../../components/SessionCard.jsx';
import Tooltip from '../../components/Tooltip.jsx';
import { useCurrentUser } from '../../context/CurrentUserContext.jsx';
import { useAgentConfigContext } from '../../context/AgentConfigContext.jsx';
import { useAgentConfigModels } from '../../hooks/useAgentConfigModels.js';
import { SECONDARY_BUTTON_CLASS } from '../../utils/buttonStyles.js';
import { messageModelLabel, messageModelParamsText } from '../../utils/messageModelLabel.js';
import {
  describeSchedule,
  formatLoopRunSubtitle,
  loopDisplayTitle,
} from '../../utils/loopSchedule.js';
import { TEXT_FAINT, TEXT_SECONDARY } from '../../utils/ui.js';

function LoopOverviewModelRow({ loop }) {
  const { getConfig } = useAgentConfigContext();
  const configId = loop.agent_config_id;
  const { models } = useAgentConfigModels(configId, {
    enabled: configId != null && configId !== '',
  });
  const config = getConfig(configId);
  const sdk = config?.sdk ?? loop.agent_sdk;
  const providerLabel = config?.label ?? (sdk ? formatAgentSdkDisplayName(sdk) : null);

  if (!providerLabel) {
    return <span className={TEXT_SECONDARY}>—</span>;
  }

  const fullModelLabel = messageModelLabel({
    model: loop.model,
    modelParams: loop.model_params,
    models,
  });
  const paramsText = messageModelParamsText(loop.model_params, models, loop.model);
  const hasTooltip = Boolean(fullModelLabel) || Boolean(paramsText);

  const inline = (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0">
      {config ? (
        <AgentConfigLogo
          sdk={config.sdk}
          logo={config.logo}
          className="w-3.5 h-3.5 shrink-0"
          size={14}
        />
      ) : null}
      <span className={TEXT_SECONDARY}>{providerLabel}</span>
    </span>
  );

  if (!hasTooltip) return inline;

  return (
    <Tooltip
      content={
        <div className="space-y-0.5">
          {fullModelLabel ? <div>{fullModelLabel}</div> : null}
          {paramsText ? <div className="text-faint whitespace-pre-wrap">{paramsText}</div> : null}
        </div>
      }
      wrap
      placement="top"
    >
      {inline}
    </Tooltip>
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
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-page p-3 text-sm text-secondary">
            {loop.prompt?.trim() || 'No prompt'}
          </pre>
          <p className={`mb-1 mt-3 text-xs font-medium ${TEXT_FAINT}`}>Provider</p>
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
