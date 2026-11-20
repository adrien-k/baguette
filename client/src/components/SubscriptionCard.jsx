import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { sessionsService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import { CARD_MUTED_CLASS } from '../utils/ui.js';
import { formatRelativeTime } from '../utils/dates.js';
import {
  accountParts,
  limitBarClass,
  limitDetail,
  limitValueLabel,
} from '../utils/subscriptionLimits.js';
import { useSubscriptionLimits } from '../hooks/useSubscriptionLimits.js';
import AgentConfigLogo from './AgentConfigLogo.jsx';
import UsageLimitActionSelect from './UsageLimitActionSelect.jsx';
import UsageLimitInput from './UsageLimitInput.jsx';
import {
  parseUsageLimit,
  usageLimitActionLabel,
  usageLimitInputText,
} from '../utils/usageLimitActions.jsx';

function LimitRow({ limit }) {
  const detail = limitDetail(limit);
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-secondary">{limit.label}</span>
        <span className="text-secondary tabular-nums">{limitValueLabel(limit)}</span>
      </div>
      {limit.percent != null ? (
        <div
          className="h-1.5 rounded-full bg-strong overflow-hidden"
          role="progressbar"
          aria-label={limit.label}
          aria-valuenow={limit.percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={`h-full rounded-full ${limitBarClass(limit.percent)}`}
            style={{ width: `${limit.percent}%` }}
          />
        </div>
      ) : null}
      {detail ? <p className="text-xs text-faint">{detail}</p> : null}
    </div>
  );
}

function LimitsBody({ loading, error, providers }) {
  if (loading) return <p className="text-sm text-faint">Loading limits…</p>;
  if (error) {
    return (
      <p className="text-xs text-red-500">
        Could not load usage limits: {error.message || 'unknown error'}
      </p>
    );
  }
  return providers.map((provider) => <ProviderSection key={provider.sdk} provider={provider} />);
}

/** Dollar cap for credits spent under Continue; empty = unlimited. Saved on blur. */
function UsageLimitRow({ limit, locked, onCommit }) {
  const [text, setText] = useState(usageLimitInputText(limit));
  useEffect(() => setText(usageLimitInputText(limit)), [limit]);

  const commit = () => {
    const next = parseUsageLimit(text);
    if (next === undefined) {
      setText(usageLimitInputText(limit));
      return;
    }
    if (next !== limit) onCommit(next);
  };

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-sm text-secondary">Overage Usage limit</span>
      {locked ? (
        <span className="text-sm text-fg">{limit == null ? 'Unlimited' : `$${limit}`}</span>
      ) : (
        <div className="min-w-0 flex-1 max-w-sm">
          <UsageLimitInput value={text} onChange={setText} onBlur={commit} />
        </div>
      )}
    </div>
  );
}

function ProviderSection({ provider }) {
  const account = accountParts(provider.account);
  return (
    <section className="space-y-3 border-t border-line/60 pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex shrink-0 items-center gap-2 text-sm font-medium text-heading">
          <AgentConfigLogo sdk={provider.sdk} className="w-4 h-4 shrink-0" />
          {provider.label}
        </h3>
        {account.length ? (
          <p className="min-w-0 truncate text-xs text-secondary" title={account.join(' · ')}>
            {account.join(' · ')}
          </p>
        ) : null}
      </div>
      {provider.account?.note ? (
        <p className="-mt-1 text-xs text-faint">{provider.account.note}</p>
      ) : null}
      {provider.status === 'ok' ? (
        provider.limits.map((limit) => <LimitRow key={limit.id} limit={limit} />)
      ) : (
        <p className="text-xs text-faint">{provider.message || 'Limits unavailable.'}</p>
      )}
    </section>
  );
}

/**
 * Session details "Subscription" card: plan limits per provider (Claude session / weekly /
 * spend, Cursor included usage) plus this session's overage policy.
 */
export default function SubscriptionCard({ session, locked, onSessionUpdate }) {
  const { providers, loading, error, syncing, sync } = useSubscriptionLimits(
    session?.id,
    session?.agent_sdk,
    session?.agent_config_id
  );
  // An SDK without plan limits (e.g. Pi) reports no provider: nothing to show or configure.
  if (!loading && !error && providers.length === 0) return null;

  const action = session?.usage_limit_action ?? 'stop';
  // The oldest provider refresh: the card is only as fresh as its stalest data.
  const refreshedAt = providers
    .map((p) => p.refreshed_at)
    .filter(Boolean)
    .sort()[0];

  const update = async (patch) => {
    if (!session?.id) return;
    try {
      onSessionUpdate?.(await sessionsService.patch(session.id, patch));
    } catch (err) {
      toastError('Failed to update subscription settings', err);
    }
  };

  return (
    <div className={`${CARD_MUTED_CLASS} p-4 sm:p-6 space-y-3`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-faint">Usage limits</h2>
        <div className="flex items-center gap-3">
          {refreshedAt ? (
            <span className="text-xs text-faint">
              Last refreshed {formatRelativeTime(refreshedAt)}
            </span>
          ) : null}
          <button
            type="button"
            onClick={sync}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 rounded-md border border-strong bg-control px-2.5 py-1 text-xs text-fg-muted hover:text-heading hover:border-faint transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} aria-hidden />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="shrink-0 text-sm text-secondary">When a usage limit is reached</span>
        {locked ? (
          <span className="text-sm text-fg">{usageLimitActionLabel(action)}</span>
        ) : (
          <div className="min-w-0 flex-1 max-w-sm">
            <UsageLimitActionSelect
              value={action}
              onChange={(next) => update({ usage_limit_action: next })}
            />
          </div>
        )}
      </div>

      {action === 'continue' ? (
        <UsageLimitRow
          limit={session?.usage_limit ?? null}
          locked={locked}
          onCommit={(next) => update({ usage_limit: next })}
        />
      ) : null}

      <div className="border-t border-line/60 pt-4 space-y-4">
        <LimitsBody loading={loading} error={error} providers={providers} />
      </div>
    </div>
  );
}
